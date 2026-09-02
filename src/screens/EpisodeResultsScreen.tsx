import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, FlatList, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { colors } from '../theme/colors';
import { searchPosts, Post } from '../api/sakugabooru';
import PostCard from '../components/PostCard';
import { Ionicons } from '@expo/vector-icons';

const PAGE_SIZE = 24;

export default function EpisodeResultsScreen({ route, navigation }: any) {
  const { showTag, label, mode, candidates, posts: sampledPosts } = route.params as {
    showTag: string;
    label: string;
    mode: 'search' | 'sampled';
    candidates?: string[];
    posts?: Post[];
  };

  const [posts, setPosts] = useState<Post[] | null>(mode === 'sampled' ? sampledPosts || [] : null);
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
  // Synchronous, no fetch — just the post's plain tag string already in
  // memory, matching the bookmarklet's own minimal design.
  const selectedPost = selectedId !== null ? posts?.find((p) => p.id === selectedId) || null : null;

  const [loading, setLoading] = useState(mode === 'search');
  const [error, setError] = useState<string | null>(null);
  const [attempting, setAttempting] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);
  const winningTagRef = useRef<string | null>(null);

  useEffect(() => {
    navigation.setOptions({ title: label });
  }, [label]);

  // Different shows' taggers write source text differently ("#357" vs "#0357"
  // zero-padded vs bare "357"), and there's no way to know which in advance —
  // so this tries each realistic candidate in order and stops at the first
  // one that actually returns something, same fallback logic the bookmarklet
  // needed after discovering a real "#0357" case that matched neither "#357"
  // nor bare "357".
  useEffect(() => {
    if (mode !== 'search' || !candidates) return;
    let cancelled = false;

    async function run() {
      setLoading(true);
      setError(null);
      for (const candidate of candidates!) {
        if (cancelled) return;
        setAttempting(candidate);
        try {
          const results = await searchPosts([showTag, `source:${candidate}`], 'date', PAGE_SIZE, 1);
          if (cancelled) return;
          if (results.length > 0) {
            winningTagRef.current = candidate;
            setPosts(results);
            setHasMore(results.length === PAGE_SIZE);
            setLoading(false);
            return;
          }
        } catch (e: any) {
          if (!cancelled) {
            setError(e.message || 'search failed');
            setLoading(false);
          }
          return;
        }
      }
      if (!cancelled) {
        setPosts([]);
        setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !hasMore || !winningTagRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const nextPage = page + 1;
      const more = await searchPosts([showTag, `source:${winningTagRef.current}`], 'date', PAGE_SIZE, nextPage);
      setPosts((prev) => {
        if (!prev) return more;
        const existingIds = new Set(prev.map((p) => p.id));
        return [...prev, ...more.filter((p) => !existingIds.has(p.id))];
      });
      setPage(nextPage);
      setHasMore(more.length === PAGE_SIZE);
    } catch {
      // Quiet failure — same reasoning as Search's loadMore, not worth
      // disrupting already-visible results over a failed "load more".
    } finally {
      setLoadingMore(false);
      loadingMoreRef.current = false;
    }
  }, [hasMore, page, showTag]);

  return (
    <View style={styles.container}>
      {loading && (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.amber} />
          {attempting && candidates && candidates.length > 1 && (
            <Text style={styles.loadingNote}>trying "{attempting}"…</Text>
          )}
        </View>
      )}
      {error && <Text style={styles.error}>error: {error}</Text>}

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
          onEndReached={mode === 'search' ? loadMore : undefined}
          onEndReachedThreshold={0.5}
          initialNumToRender={12}
          maxToRenderPerBatch={9}
          windowSize={5}
          updateCellsBatchingPeriod={50}
          ListEmptyComponent={
            <Text style={styles.empty}>
              {mode === 'search'
                ? "couldn't find posts for this episode — the show's tagger may use a format not tried here"
                : 'nothing sampled for this category yet'}
            </Text>
          }
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator color={colors.amber} style={{ marginVertical: 16 }} />
            ) : mode === 'sampled' && posts.length > 0 ? (
              <Text style={styles.endNote}>sampled only, not a live search — see the show page for why</Text>
            ) : mode === 'search' && !hasMore && posts.length > 0 ? (
              <Text style={styles.endNote}>— end of results —</Text>
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
  container: { flex: 1, backgroundColor: colors.bg },
  loadingWrap: { marginTop: 40, alignItems: 'center' },
  loadingNote: { color: colors.dim, fontSize: 11, marginTop: 8 },
  error: { color: colors.red, marginTop: 16, textAlign: 'center' },
  empty: { color: colors.dim, textAlign: 'center', marginTop: 24, paddingHorizontal: 24 },
  endNote: { color: colors.dim, textAlign: 'center', fontSize: 11, marginVertical: 16 },
});
