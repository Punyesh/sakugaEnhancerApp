import React, { useEffect, useState, memo } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { colors } from '../theme/colors';
import { Post, isVideoFile } from '../api/sakugabooru';
import { Ionicons } from '@expo/vector-icons';

// sakugabooru's own API doesn't expose clip length at all (confirmed
// directly on their forum) — but the video file itself has its duration
// embedded, readable once the player actually loads it. Only feasible for
// the one selected/playing card, not every card in the grid, since reading
// this would mean loading every single video just to find out how long it
// is — exactly the cost the two-tap select pattern exists to avoid.
function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds - m * 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Two-tap pattern in place of hover, which has no touch equivalent: first
// tap selects the card, which plays a muted preview right there — only the
// ONE selected card ever plays, not every visible video at once, keeping
// this to the same resource cost as opening one video normally. A second
// tap on an already-selected card opens the full Viewer.
//
// Wrapped in memo() because selecting a card changes `selectedId` in the
// parent grid, which without this would re-render every visible card, not
// just the one that changed — and each card runs useVideoPlayer() as part
// of its own render, so that cost multiplied across ~20 unrelated cards on
// every single tap was very likely the real cause of the whole grid feeling
// sluggish to select/deselect. onSelect/onOpen take the post/id as an
// argument specifically so the parent can pass one stable function shared
// by every card instead of a fresh inline closure per card per render —
// memo() only helps if the props it's comparing actually stay the same
// reference when unrelated state changes.
function PostCard({
  post,
  selected,
  onSelect,
  onOpen,
}: {
  post: Post;
  selected: boolean;
  onSelect: (id: number) => void;
  onOpen: (post: Post) => void;
}) {
  const playable = isVideoFile(post.file_url);

  // Player starts empty — source is only loaded via the explicit
  // replaceAsync() below once this specific card is selected, not the
  // moment it renders, so cards that aren't selected never buffer video.
  const player = useVideoPlayer(null, (p) => {
    p.loop = true;
    p.muted = true;
  });

  // The video source loading is a network fetch, not something we can make
  // instant — but showing real feedback during that gap (rather than a
  // static thumbnail with no indication anything is happening) makes the
  // wait feel much shorter even though it isn't actually shorter.
  const [buffering, setBuffering] = useState(false);
  const [duration, setDuration] = useState<number | null>(null);

  useEffect(() => {
    if (!playable) return;
    if (selected) {
      setBuffering(true);
      setDuration(null);
      player.replaceAsync(post.file_url).then(() => player.play()).catch(() => setBuffering(false));
    } else {
      setBuffering(false);
      setDuration(null);
      player.replaceAsync(null).catch(() => {});
    }
  }, [selected, playable, player, post.file_url]);

  useEffect(() => {
    const sub = player.addListener('playingChange', (e) => {
      if (e.isPlaying) setBuffering(false);
    });
    return () => sub.remove();
  }, [player]);

  useEffect(() => {
    const sub = player.addListener('sourceLoad', (e) => {
      if (e.duration > 0) setDuration(e.duration);
    });
    return () => sub.remove();
  }, [player]);

  return (
    <TouchableOpacity
      style={[styles.card, selected && styles.cardSelected]}
      onPress={() => (selected ? onOpen(post) : onSelect(post.id))}
      activeOpacity={0.85}
    >
      {/* Thumbnail is always rendered as the base layer — the video, when
          selected, sits on top of it. This means the still thumbnail stays
          visible during the load/buffer gap instead of flashing black. */}
      <Image source={{ uri: post.preview_url || post.jpeg_url || post.sample_url }} style={styles.thumb} />
      {playable && selected && (
        <VideoView
          player={player}
          style={styles.videoOverlay}
          nativeControls={false}
          contentFit="cover"
          surfaceType="textureView"
        />
      )}
      {playable && !selected && (
        <View style={styles.vidmark}>
          <Text style={styles.vidmarkText}>▶</Text>
        </View>
      )}
      {selected && buffering && (
        <View style={styles.bufferOverlay}>
          <ActivityIndicator color={colors.amber} size="small" />
        </View>
      )}
      <View style={styles.score}>
        <Text style={styles.scoreText}>▲ {post.score}</Text>
      </View>
      {selected && duration !== null && (
        <View style={styles.durationBadge}>
          <Text style={styles.durationBadgeText}>{formatDuration(duration)}</Text>
        </View>
      )}
      {selected && (
        <View style={styles.expandHint}>
          <Ionicons name="expand-outline" size={13} color={colors.text} />
        </View>
      )}
    </TouchableOpacity>
  );
}

export default memo(PostCard);

const styles = StyleSheet.create({
  card: {
    flex: 1 / 3,
    aspectRatio: 1,
    backgroundColor: '#000',
    borderRadius: 4,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.line,
  },
  cardSelected: { borderColor: colors.amber, borderWidth: 2 },
  thumb: { width: '100%', height: '100%' },
  videoOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  bufferOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  vidmark: {
    position: 'absolute',
    top: 3,
    left: 4,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 8,
    paddingHorizontal: 4,
  },
  vidmarkText: { color: colors.text, fontSize: 9 },
  score: {
    position: 'absolute',
    top: 3,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 8,
    paddingHorizontal: 5,
  },
  scoreText: { color: colors.amber, fontSize: 10, fontFamily: 'monospace' },
  durationBadge: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 8,
    paddingHorizontal: 5,
  },
  durationBadgeText: { color: colors.text, fontSize: 9, fontFamily: 'monospace' },
  expandHint: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 10,
    padding: 4,
  },
});
