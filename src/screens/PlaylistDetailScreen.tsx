import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, FlatList, StyleSheet, ActivityIndicator, TouchableOpacity, Alert } from 'react-native';
import { colors } from '../theme/colors';
import { getPool, getPoolPosts, getMyPoolIds, removePostFromPool, destroyPool, Pool, Post } from '../api/sakugabooru';
import { useAuth } from '../hooks/useAuth';
import PostCard from '../components/PostCard';
import { Ionicons } from '@expo/vector-icons';

const PAGE_SIZE = 24;

export default function PlaylistDetailScreen({ route, navigation }: any) {
  const { poolId } = route.params as { poolId: number };
  const { credentials } = useAuth();

  const [pool, setPool] = useState<Pool | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);

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

  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [poolData, myIds, firstPage] = await Promise.all([
        getPool(poolId),
        getMyPoolIds(),
        getPoolPosts(poolId, 'date', PAGE_SIZE, 1),
      ]);
      setPool(poolData);
      setIsOwner(myIds.includes(poolId));
      setPosts(firstPage);
      setHasMore(firstPage.length === PAGE_SIZE);
      navigation.setOptions({ title: poolData?.name || 'Playlist' });
    } catch (e: any) {
      setError(e.message || 'failed to load playlist');
    } finally {
      setLoading(false);
    }
  }, [poolId, navigation]);

  useEffect(() => {
    load();
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

  const doRemoveSelected = useCallback(async () => {
    if (!selectedPost || !credentials) return;
    setRemoving(true);
    setRemoveError(null);
    try {
      await removePostFromPool(poolId, selectedPost.id, credentials.username, credentials.passwordHash);
      setPosts((prev) => (prev ? prev.filter((p) => p.id !== selectedPost.id) : prev));
      setSelectedId(null);
    } catch (e: any) {
      setRemoveError(e.message || 'failed to remove');
    } finally {
      setRemoving(false);
    }
  }, [selectedPost, credentials, poolId]);

  const doDeletePlaylist = useCallback(() => {
    if (!credentials) return;
    Alert.alert('Delete Playlist', `Delete "${pool?.name}"? This can't be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await destroyPool(poolId, credentials.username, credentials.passwordHash);
            navigation.goBack();
          } catch (e: any) {
            Alert.alert('Failed to delete', e.message || 'unknown error');
          }
        },
      },
    ]);
  }, [credentials, poolId, pool, navigation]);

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
            <Text style={styles.badge}>{pool.is_public ? 'Public' : 'Private'}</Text>
            <Text style={styles.postCount}>
              {pool.post_count} clip{pool.post_count === 1 ? '' : 's'}
            </Text>
            {isOwner && (
              <TouchableOpacity onPress={doDeletePlaylist} style={styles.deleteBtn}>
                <Ionicons name="trash-outline" size={16} color={colors.red} />
              </TouchableOpacity>
            )}
          </View>
          {!!pool.description && <Text style={styles.description}>{pool.description}</Text>}
        </View>
      )}

      {selectedPost && (
        <View style={styles.selectedStrip}>
          <View style={{ flex: 1 }}>
            <Text style={styles.selectedStripText} numberOfLines={2}>
              {selectedPost.tags}
            </Text>
            {removeError && <Text style={styles.removeError}>{removeError}</Text>}
          </View>
          {isOwner && (
            <TouchableOpacity onPress={doRemoveSelected} style={styles.removeBtn} disabled={removing}>
              {removing ? (
                <ActivityIndicator color={colors.red} size="small" />
              ) : (
                <Ionicons name="remove-circle-outline" size={20} color={colors.red} />
              )}
            </TouchableOpacity>
          )}
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
          ListEmptyComponent={<Text style={styles.empty}>No clips in this playlist yet.</Text>}
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator color={colors.amber} style={{ marginVertical: 16 }} />
            ) : !hasMore && posts.length > 0 ? (
              <Text style={styles.endNote}>— end of playlist —</Text>
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
  deleteBtn: { marginLeft: 'auto', padding: 4 },
  description: { color: colors.text, fontSize: 12, marginTop: 8, lineHeight: 17 },
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
  removeError: { color: colors.red, fontSize: 10, marginTop: 3 },
  removeBtn: { padding: 4 },
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
