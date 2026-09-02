import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';
import { Post, isVideoFile } from '../api/sakugabooru';

export default function PostCard({ post, onPress }: { post: Post; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.card} onPress={onPress}>
      <Image source={{ uri: post.preview_url || post.jpeg_url || post.sample_url }} style={styles.thumb} />
      {isVideoFile(post.file_url) && (
        <View style={styles.vidmark}>
          <Text style={styles.vidmarkText}>▶</Text>
        </View>
      )}
      <View style={styles.score}>
        <Text style={styles.scoreText}>▲ {post.score}</Text>
      </View>
    </TouchableOpacity>
  );
}

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
  thumb: { width: '100%', height: '100%' },
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
});
