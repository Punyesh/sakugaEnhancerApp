import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, FlatList, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { colors } from '../theme/colors';
import { getPool, getPoolPosts, Pool, Post } from '../api/sakugabooru';
import { onScoreChanged } from '../api/voteEvents';
import PostCard from '../components/PostCard';
import { Ionicons } from '@expo/vector-icons';

const PAGE_SIZE = 24;

// Purely read-only — this screen is specifically for browsing someone
// else's public pool. Your own pools are always local (see
// LocalPoolDetailScreen), so there's never an "owner" case to handle here.
export default function PlaylistDetailScreen({ route, navigation }: any) {
  const { poolId } = route.params as { poolId: number };

  const [pool, setPool] = useState<Pool | null>(null);
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);

  // A vote cast in ViewerScreen doesn't touch this list on its own — without
  // this, backing out of a clip you just rated kept showing its old score
  // until the pool was reopened.
  useEffect(() => {
    return onScoreChanged((postId, newScore) => {
      setPosts((prev) => (prev ? prev.map((p) => (p.id === postId ? { ...p, score: newScore } : p)) : prev));
    });
  }, []);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const handleSelectCard = useCallback((id: number) => setSelectedId(id), []);
  const handleOpenCard = useCallback(
    (post: Post) => {
      setSelectedId(null);
      navigation.navigate('Viewer', { post });
    },
    [navigation]
  );
  useEffect(() => {
    const unsubscribe = navigation.addListener('blur', () => setSelectedId(null));
    return unsubscribe;
  }, [navigation]);
  const selectedPost = selectedId !== null ? posts?.find((p) => p.id === selectedId) || null : null;

  const load = useCallback(
    async (isCancelled: () => boolean) => {
      setLoading(true);
      setError(null);
      try {
        const [poolData, firstPage] = await Promise.all([getPool(poolId), getPoolPosts(poolId, 'date', PAGE_SIZE, 1)]);
        if (isCancelled()) return;
        setPool(poolData);
        setPosts(firstPage);
        setHasMore(firstPage.length === PAGE_SIZE);
        navigation.setOptions({ title: poolData?.name || 'Pool' });
      } catch (e: any) {
        if (!isCancelled()) setError(e.message || 'failed to load pool');
      } finally {
        if (!isCancelled()) setLoading(false);
      }
    },
    [poolId, navigation]
  );

  useEffect(() => {
    let cancelled = false;
    load(() => cancelled);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poolId]);

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !hasMore) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const nextPage = page + 1;
      const more = await getPoolPosts(poolId, 'date', PAGE_SIZE, nextPage);
      setPosts((prev) => {
        if (!prev) return more;
        const existingIds = new Set(prev.map((p) => p.id));
        return [...prev, ...more.filter((p) => !existingIds.has(p.id))];
      });
      setPage(nextPage);
      setHasMore(more.length === PAGE_SIZE);
    } catch {
      // Quiet failure, matching Search/Shows' own loadMore behavior.
    } finally {
      setLoadingMore(false);
      loadingMoreRef.current = false;
    }
  }, [hasMore, page, poolId]);

  return (
    <View style={styles.container}>
      {loading && (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.amber} />
        </View>
      )}
      {error && <Text style={styles.error}>error: {error}</Text>}

      {pool && !loading && (
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <Text style={styles.badge}>Public</Text>
            <Text style={styles.postCount}>
              {pool.post_count} clip{pool.post_count === 1 ? '' : 's'}
            </Text>
          </View>
          {!!pool.description && (
            <TouchableOpacity style={styles.descriptionToggle} onPress={() => setDescriptionOpen((o) => !o)}>
              <Ionicons name={descriptionOpen ? 'chevron-up' : 'chevron-down'} size={13} color={colors.dim} />
              <Text style={styles.descriptionToggleText}> description</Text>
            </TouchableOpacity>
          )}
          {!!pool.description && descriptionOpen && <Text style={styles.description}>{pool.description}</Text>}
        </View>
      )}

      {selectedPost && (
        <View style={styles.selectedStrip}>
          <View style={{ flex: 1 }}>
            <Text style={styles.selectedStripText} numberOfLines={2}>
              {selectedPost.tags}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => setSelectedId(null)}
            style={styles.selectedStripClose}
            hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
          >
            <Ionicons name="close" size={18} color={colors.text} />
          </TouchableOpacity>
        </View>
      )}

      {posts && !loading && (
        <FlatList
          data={posts}
          keyExtractor={(p) => String(p.id)}
          numColumns={3}
          columnWrapperStyle={{ gap: 6 }}
          contentContainerStyle={{ gap: 6, padding: 12 }}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          initialNumToRender={12}
          maxToRenderPerBatch={9}
          windowSize={5}
          updateCellsBatchingPeriod={50}
          ListEmptyComponent={<Text style={styles.empty}>No clips in this pool yet.</Text>}
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator color={colors.amber} style={{ marginVertical: 16 }} />
            ) : !hasMore && posts.length > 0 ? (
              <Text style={styles.endNote}>— end of pool —</Text>
            ) : null
          }
          renderItem={({ item }) => (
            <PostCard post={item} selected={selectedId === item.id} onSelect={handleSelectCard} onOpen={handleOpenCard} />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  loadingWrap: { marginTop: 40, alignItems: 'center' },
  error: { color: colors.red, marginTop: 16, textAlign: 'center' },
  header: { padding: 12, borderBottomWidth: 1, borderBottomColor: colors.line },
  headerTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  badge: {
    backgroundColor: colors.panel2,
    color: colors.dim,
    fontSize: 10,
    fontWeight: '600',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    overflow: 'hidden',
  },
  postCount: { color: colors.dim, fontSize: 11 },
  description: { color: colors.text, fontSize: 12, marginTop: 8, lineHeight: 17 },
  descriptionToggle: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  descriptionToggleText: { color: colors.dim, fontSize: 11 },
  selectedStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.panel,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginHorizontal: 12,
    marginTop: 8,
    gap: 8,
  },
  selectedStripText: { color: colors.dim, fontSize: 11, lineHeight: 15 },
  selectedStripClose: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.panel2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: { color: colors.dim, textAlign: 'center', marginTop: 24, paddingHorizontal: 24 },
  endNote: { color: colors.dim, textAlign: 'center', fontSize: 11, marginVertical: 16 },
});
