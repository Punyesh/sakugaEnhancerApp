import React, { useState, useRef, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity, ScrollView, ActivityIndicator, Linking } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { colors } from '../theme/colors';
import { isVideoFile, getTagTypeMap, fetchComments, formatCommentDate, getPostById, Comment } from '../api/sakugabooru';
import { Ionicons } from '@expo/vector-icons';

// Same fps assumption as the bookmarklet: sakugabooru's post data doesn't
// expose a real frame rate, so this defaults to 24fps (standard for anime).
// Frame stepping is only as accurate as the player's own seek precision —
// same honest limitation as any browser-based approach, not something a
// native app magically fixes.
const DEFAULT_FPS = 24;
const MED_STEP = 10;

function formatTime(t: number) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  const sStr = s.toFixed(1).padStart(4, '0');
  return `${m}:${sStr}`;
}

// Comments here can include forum-style [quote]...[/quote] markup (a real
// example: someone quoting another comment's per-cut timestamp breakdown) —
// rendered raw, that shows up as literal bracket text, which is what
// prompted this. This splits quoted vs normal text so each can get distinct
// styling instead of showing the brackets themselves.
function splitQuotes(raw: string): { quoted: boolean; text: string }[] {
  const segments: { quoted: boolean; text: string }[] = [];
  const regex = /\[quote\]([\s\S]*?)\[\/quote\]/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(raw)) !== null) {
    if (match.index > lastIndex) segments.push({ quoted: false, text: raw.slice(lastIndex, match.index) });
    segments.push({ quoted: true, text: match[1].trim() });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < raw.length) segments.push({ quoted: false, text: raw.slice(lastIndex) });
  return segments.length ? segments : [{ quoted: false, text: raw }];
}

// Comments frequently reference specific moments in the clip ("00:41",
// "1:15") and sometimes link to other posts — this renders both as tappable
// spans within the same text (a single combined regex pass, so overlapping
// text like "check 0:41 https://...link" splits correctly either way)
// instead of leaving everything as inert plain text.
const SAKUGA_POST_URL = /^https?:\/\/(?:www\.)?sakugabooru\.com\/post\/show\/(\d+)/i;

function renderRichText(
  text: string,
  handlers: { onSeek: ((seconds: number) => void) | null; onPostLink: (id: number) => void; onExternalLink: (url: string) => void },
  keyPrefix: string
) {
  const regex = /(https?:\/\/\S+)|(\b\d{1,2}:\d{2}\b)/g;
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    if (match[1]) {
      // A URL — trim trailing punctuation that's likely sentence
      // punctuation, not part of the link itself (e.g. a period ending
      // the sentence right after the URL).
      let url = match[1];
      const trailing = url.match(/[.,!?;:)\]}'"]+$/);
      if (trailing) url = url.slice(0, -trailing[0].length);
      const postMatch = url.match(SAKUGA_POST_URL);
      nodes.push(
        <Text
          key={`${keyPrefix}-url-${i++}`}
          style={styles.link}
          onPress={() => (postMatch ? handlers.onPostLink(Number(postMatch[1])) : handlers.onExternalLink(url))}
        >
          {url}
        </Text>
      );
      lastIndex = match.index + match[1].length; // not match[0].length — trailing punctuation stays as plain text
    } else if (match[2] && handlers.onSeek) {
      const [mm, ss] = match[2].split(':');
      const seconds = parseInt(mm, 10) * 60 + parseInt(ss, 10);
      const onSeek = handlers.onSeek;
      nodes.push(
        <Text key={`${keyPrefix}-ts-${i++}`} style={styles.timestampLink} onPress={() => onSeek(seconds)}>
          {match[2]}
        </Text>
      );
      lastIndex = match.index + match[0].length;
    } else {
      nodes.push(match[0]);
      lastIndex = match.index + match[0].length;
    }
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

export default function ViewerScreen({ route, navigation }: any) {
  const { post } = route.params;
  const playable = isVideoFile(post.file_url);
  const fps = Number(post.frame_rate) || DEFAULT_FPS;
  const bigStep = Math.max(1, Math.round(fps));

  const player = useVideoPlayer(playable ? post.file_url : null, (p) => {
    p.loop = false;
  });

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // expo-video doesn't guarantee a fine-grained timeupdate event across
  // platforms, so this polls the player's own position — simple and reliable
  // rather than depending on an event name I can't verify without testing.
  React.useEffect(() => {
    if (!playable) return;
    const interval = setInterval(() => {
      setCurrentTime(player.currentTime || 0);
      setDuration(player.duration || 0);
    }, 100);
    return () => clearInterval(interval);
  }, [playable, player]);

  const step = useCallback(
    (deltaFrames: number) => {
      player.pause();
      // Scrubbing mode only needs to be on for the instant of this seek —
      // turning it off again shortly after (rather than leaving it on) avoids
      // it interfering with a later native Play press.
      player.scrubbingModeOptions = { scrubbingModeEnabled: true };
      const next = currentTime + deltaFrames / fps;
      player.currentTime = Math.max(0, Math.min(duration || next, next));
      setTimeout(() => {
        player.scrubbingModeOptions = { scrubbingModeEnabled: false };
      }, 150);
    },
    [player, currentTime, duration, fps]
  );

  const frameCount = Math.round(currentTime * fps);
  const totalFrames = Math.round(duration * fps);

  const [artistTags, setArtistTags] = useState<string[]>([]);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [commentsLoading, setCommentsLoading] = useState(true);
  const [commentsError, setCommentsError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  // Loaded eagerly (not on first expand) specifically so the count is known
  // and shown on the toggle before anyone taps it — this is a single small
  // request for one post's comments, not the kind of paginated crawl that
  // made eager-loading a bad idea for the tag dictionary elsewhere.
  useEffect(() => {
    let cancelled = false;
    setCommentsLoading(true);
    fetchComments(post.id)
      .then((c) => {
        if (!cancelled) setComments(c);
      })
      .catch((e) => {
        if (!cancelled) setCommentsError(e.message || 'failed to load comments');
      })
      .finally(() => {
        if (!cancelled) setCommentsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [post.id]);

  // Seeking from a tapped timestamp reuses the same scrubbing-mode approach
  // as frame-stepping, plus scrolls back up so the jump is actually visible
  // instead of leaving the person staring at the comment they just tapped.
  const seekTo = useCallback(
    (seconds: number) => {
      player.pause();
      player.scrubbingModeOptions = { scrubbingModeEnabled: true };
      player.currentTime = Math.max(0, Math.min(duration || seconds, seconds));
      setTimeout(() => {
        player.scrubbingModeOptions = { scrubbingModeEnabled: false };
      }, 150);
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    },
    [player, duration]
  );

  const [linkError, setLinkError] = useState<string | null>(null);

  // A sakugabooru post link opens inside the app itself, pushed as a new
  // screen — real back-navigation (hardware back / swipe) comes for free
  // from the stack navigator, no custom "go back" affordance needed. Any
  // other URL falls back to the device's own browser.
  const openPostLink = useCallback(
    (id: number) => {
      setLinkError(null);
      getPostById(id)
        .then((p) => {
          if (p) {
            navigation.push('Viewer', { post: p });
          } else {
            setLinkError(`post #${id} not found`);
          }
        })
        .catch((e) => setLinkError(e.message || 'failed to open that post'));
    },
    [navigation]
  );

  const openExternalLink = useCallback((url: string) => {
    setLinkError(null);
    Linking.openURL(url).catch(() => setLinkError("couldn't open that link"));
  }, []);

  const [otherTags, setOtherTags] = useState<string[]>((post.tags || '').split(/\s+/).filter(Boolean));

  useEffect(() => {
    let cancelled = false;
    getTagTypeMap()
      .then((map) => {
        if (cancelled) return;
        const all = (post.tags || '').split(/\s+/).filter(Boolean);
        setArtistTags(all.filter((t: string) => map[t] === 1));
        setOtherTags(all.filter((t: string) => map[t] !== 1));
      })
      .catch(() => {
        // Tag-type lookup failing isn't worth showing an error over — the
        // plain, unsplit tag list (already the initial state) is a fine fallback.
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ScrollView style={styles.container} ref={scrollRef}>
      <View style={styles.headRow}>
        <Text style={styles.badge}>▲ {post.score}</Text>
        <Text style={styles.badge}>{post.rating}</Text>
        <Text style={styles.postId}>#{post.id}</Text>
      </View>

      {playable ? (
        <>
          <VideoView player={player} style={styles.video} nativeControls />

          <View style={styles.frameBar}>
            <View style={styles.frameRow}>
              <TouchableOpacity style={styles.frameBtn} onPress={() => step(-bigStep)}>
                <Text style={styles.frameBtnText}>«</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.frameBtn} onPress={() => step(-MED_STEP)}>
                <Text style={styles.frameBtnText}>‹‹</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.frameBtn} onPress={() => step(-1)}>
                <Text style={styles.frameBtnText}>‹</Text>
              </TouchableOpacity>
              <Text style={styles.frameCount}>
                {frameCount} / {totalFrames}
              </Text>
              <TouchableOpacity style={styles.frameBtn} onPress={() => step(1)}>
                <Text style={styles.frameBtnText}>›</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.frameBtn} onPress={() => step(MED_STEP)}>
                <Text style={styles.frameBtnText}>››</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.frameBtn} onPress={() => step(bigStep)}>
                <Text style={styles.frameBtnText}>»</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.frameTime}>
              {formatTime(currentTime)} / {formatTime(duration)}
            </Text>
          </View>
        </>
      ) : (
        <Image
          source={{ uri: post.sample_url || post.file_url }}
          style={styles.image}
          resizeMode="contain"
        />
      )}

      <View style={styles.tagsSection}>
        {artistTags.length > 0 && (
          <>
            <Text style={styles.tagsLabel}>Animator</Text>
            <View style={styles.tagWrap}>
              {artistTags.map((t) => (
                <View key={t} style={styles.artistChip}>
                  <Text style={styles.artistChipText}>{t}</Text>
                </View>
              ))}
            </View>
          </>
        )}
        <Text style={styles.tagsLabel}>Tags</Text>
        <View style={styles.tagWrap}>
          {otherTags.map((t) => (
            <View key={t} style={styles.tagChip}>
              <Text style={styles.tagChipText}>{t}</Text>
            </View>
          ))}
        </View>
      </View>

      <TouchableOpacity style={styles.commentsToggle} onPress={() => setCommentsOpen((o) => !o)}>
        <Ionicons name="chatbubble-outline" size={14} color={colors.dim} />
        <Text style={styles.commentsToggleText}>
          {' '}
          Comments{comments ? ` (${comments.length})` : commentsLoading ? '…' : ''} {commentsOpen ? '▴' : '▾'}
        </Text>
      </TouchableOpacity>

      {commentsOpen && (
        <View style={styles.commentsPanel}>
          {commentsLoading && <ActivityIndicator color={colors.amber} style={{ marginVertical: 10 }} />}
          {commentsError && <Text style={styles.error}>error: {commentsError}</Text>}
          {linkError && <Text style={styles.error}>{linkError}</Text>}
          {comments && comments.length === 0 && !commentsLoading && (
            <Text style={styles.noComments}>no comments yet</Text>
          )}
          {comments &&
            comments.map((c) => {
              const name = c.creator || (c.creator_id ? `user #${c.creator_id}` : 'anonymous');
              const body = c.body || c.comment || '';
              const when = formatCommentDate(c.created_at);
              const richHandlers = {
                onSeek: playable ? seekTo : null,
                onPostLink: openPostLink,
                onExternalLink: openExternalLink,
              };
              return (
                <View key={c.id} style={styles.comment}>
                  <View style={styles.commentHead}>
                    <Text style={styles.commentName}>{name}</Text>
                    {when ? <Text style={styles.commentDate}>{when}</Text> : null}
                  </View>
                  {splitQuotes(body).map((seg, i) =>
                    seg.quoted ? (
                      <View key={i} style={styles.quoteBlock}>
                        <Text style={styles.quoteText}>
                          {renderRichText(seg.text, richHandlers, `c${c.id}-q${i}`)}
                        </Text>
                      </View>
                    ) : (
                      <Text key={i} style={styles.commentBody}>
                        {renderRichText(seg.text, richHandlers, `c${c.id}-t${i}`)}
                      </Text>
                    )
                  )}
                </View>
              );
            })}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    backgroundColor: colors.panel2,
  },
  badge: {
    backgroundColor: colors.bg,
    color: colors.amber,
    fontSize: 11,
    fontFamily: 'monospace',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    overflow: 'hidden',
  },
  postId: { color: colors.dim, fontSize: 11, fontFamily: 'monospace', marginLeft: 'auto' },
  video: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000' },
  image: { width: '100%', height: 300, backgroundColor: '#000' },
  frameBar: { padding: 10, backgroundColor: colors.panel2 },
  frameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  frameBtn: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  frameBtnText: { color: colors.text, fontSize: 14 },
  frameCount: {
    flex: 1,
    textAlign: 'center',
    color: colors.amber,
    fontWeight: 'bold',
    fontFamily: 'monospace',
    fontSize: 13,
  },
  frameTime: {
    textAlign: 'center',
    color: colors.dim,
    fontFamily: 'monospace',
    fontSize: 11,
    marginTop: 6,
  },
  tagsSection: { padding: 16 },
  tagsLabel: { color: colors.text, fontSize: 12, fontWeight: 'bold', marginBottom: 8, marginTop: 6 },
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  artistChip: {
    backgroundColor: colors.amberDim,
    borderWidth: 1,
    borderColor: colors.amber,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  artistChipText: { color: colors.amber, fontSize: 11, fontWeight: 'bold' },
  tagChip: {
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  tagChipText: { color: colors.dim, fontSize: 11 },
  commentsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  commentsToggleText: { color: colors.dim, fontSize: 12, fontWeight: '600' },
  commentsPanel: { paddingHorizontal: 16, paddingBottom: 24 },
  error: { color: colors.red, fontSize: 12, textAlign: 'center', marginVertical: 8 },
  noComments: { color: colors.dim, fontSize: 12, textAlign: 'center', marginVertical: 8 },
  comment: { paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.line },
  commentHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  commentName: { color: colors.amber, fontSize: 12, fontWeight: 'bold' },
  commentDate: { color: colors.dim, fontSize: 11 },
  commentBody: { color: colors.text, fontSize: 13, lineHeight: 19 },
  timestampLink: { color: colors.amber, fontWeight: 'bold', textDecorationLine: 'underline' },
  link: { color: colors.link, textDecorationLine: 'underline' },
  quoteBlock: {
    borderLeftWidth: 2,
    borderLeftColor: colors.line,
    paddingLeft: 10,
    marginVertical: 4,
  },
  quoteText: { color: colors.dim, fontSize: 12, fontStyle: 'italic', lineHeight: 18 },
});

