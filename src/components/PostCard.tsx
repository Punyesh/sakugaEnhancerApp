import React, { useEffect, memo } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { colors } from '../theme/colors';
import { Post, isVideoFile } from '../api/sakugabooru';
import { Ionicons } from '@expo/vector-icons';

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

  useEffect(() => {
    if (!playable) return;
    if (selected) {
      player.replaceAsync(post.file_url).then(() => player.play()).catch(() => {});
    } else {
      player.replaceAsync(null).catch(() => {});
    }
  }, [selected, playable, player, post.file_url]);

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
      <View style={styles.score}>
        <Text style={styles.scoreText}>▲ {post.score}</Text>
      </View>
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
  expandHint: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 10,
    padding: 4,
  },
});
