import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, ActivityIndicator, TouchableOpacity, Alert } from 'react-native';
import { colors } from '../theme/colors';
import { getLocalPool, deleteLocalPool, removePostFromLocalPool, LocalPool } from '../api/localPools';
import { Post } from '../api/sakugabooru';
import PostCard from '../components/PostCard';
import { Ionicons } from '@expo/vector-icons';

export default function LocalPoolDetailScreen({ route, navigation }: any) {
  const { poolId } = route.params as { poolId: string };

  const [pool, setPool] = useState<LocalPool | null>(null);
  const [loading, setLoading] = useState(true);
  const [descriptionOpen, setDescriptionOpen] = useState(false);

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
  const selectedPost = selectedId !== null ? pool?.posts.find((p) => p.id === selectedId) || null : null;

  const load = useCallback(async () => {
    setLoading(true);
    const data = await getLocalPool(poolId);
    setPool(data);
    navigation.setOptions({ title: data?.name || 'Pool' });
    setLoading(false);
  }, [poolId, navigation]);

  useEffect(() => {
    load();
  }, [load]);

  const doRemoveSelected = useCallback(async () => {
    if (!selectedPost) return;
    await removePostFromLocalPool(poolId, selectedPost.id);
    setPool((prev) => (prev ? { ...prev, posts: prev.posts.filter((p) => p.id !== selectedPost.id) } : prev));
    setSelectedId(null);
  }, [selectedPost, poolId]);

  const doDeletePool = useCallback(() => {
    Alert.alert('Delete Pool', `Delete "${pool?.name}"? This can't be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteLocalPool(poolId);
          navigation.goBack();
        },
      },
    ]);
  }, [poolId, pool, navigation]);

  return (
    <View style={styles.container}>
      {loading && (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.amber} />
        </View>
      )}

      {pool && !loading && (
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <Text style={styles.postCount}>
              {pool.posts.length} clip{pool.posts.length === 1 ? '' : 's'}
            </Text>
            <TouchableOpacity onPress={doDeletePool} style={styles.deleteBtn}>
              <Ionicons name="trash-outline" size={16} color={colors.red} />
            </TouchableOpacity>
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
          <TouchableOpacity onPress={doRemoveSelected} style={styles.removeBtn}>
            <Ionicons name="remove-circle-outline" size={20} color={colors.red} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setSelectedId(null)}
            style={styles.selectedStripClose}
            hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
          >
            <Ionicons name="close" size={18} color={colors.text} />
          </TouchableOpacity>
        </View>
      )}

      {pool && !loading && (
        <FlatList
          data={pool.posts}
          keyExtractor={(p) => String(p.id)}
          numColumns={3}
          columnWrapperStyle={{ gap: 6 }}
          contentContainerStyle={{ gap: 6, padding: 12 }}
          initialNumToRender={12}
          maxToRenderPerBatch={9}
          windowSize={5}
          updateCellsBatchingPeriod={50}
          ListEmptyComponent={<Text style={styles.empty}>No clips in this pool yet.</Text>}
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
  header: { padding: 12, borderBottomWidth: 1, borderBottomColor: colors.line },
  headerTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  postCount: { color: colors.dim, fontSize: 11 },
  deleteBtn: { marginLeft: 'auto', padding: 4 },
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
});
