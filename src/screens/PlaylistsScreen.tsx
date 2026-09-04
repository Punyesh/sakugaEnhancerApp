import React, { useState, useCallback, useEffect, memo } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Image, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';
import { getLocalPools, LocalPool } from '../api/localPools';
import CreatePlaylistModal from '../components/CreatePlaylistModal';
import { Ionicons } from '@expo/vector-icons';

function PoolRow({ pool, onPress }: { pool: LocalPool; onPress: (pool: LocalPool) => void }) {
  const thumb = pool.posts[0]?.preview_url || pool.posts[0]?.jpeg_url || pool.posts[0]?.sample_url;
  return (
    <TouchableOpacity style={styles.poolRow} onPress={() => onPress(pool)}>
      <View style={styles.poolThumbWrap}>
        {thumb ? <Image source={{ uri: thumb }} style={styles.poolThumb} /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.poolName}>{pool.name}</Text>
        {!!pool.description && (
          <Text style={styles.poolDescription} numberOfLines={1}>
            {pool.description}
          </Text>
        )}
        <Text style={styles.poolMeta}>
          {pool.posts.length} clip{pool.posts.length === 1 ? '' : 's'}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.dim} />
    </TouchableOpacity>
  );
}
const MemoPoolRow = memo(PoolRow);

export default function PlaylistsScreen({ navigation }: any) {
  const [createOpen, setCreateOpen] = useState(false);
  const [pools, setPools] = useState<LocalPool[] | null>(null);

  const load = useCallback(async () => {
    setPools(await getLocalPools());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Refresh whenever this tab regains focus — a pool created or edited from
  // elsewhere (e.g. the Viewer's Add to Pool flow) should show up here
  // without needing a manual pull-to-refresh.
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', load);
    return unsubscribe;
  }, [navigation, load]);

  const openPool = useCallback(
    (pool: LocalPool) => navigation.push('LocalPoolDetail', { poolId: pool.id }),
    [navigation]
  );

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <View style={styles.sectionHeader}>
          <View>
            <Text style={styles.sectionTitle}>My Pools</Text>
            <Text style={styles.sectionCaption}>saved on this device</Text>
          </View>
          <TouchableOpacity onPress={() => setCreateOpen(true)} style={styles.newBtn}>
            <Ionicons name="add" size={16} color={colors.amber} />
            <Text style={styles.newBtnText}> New</Text>
          </TouchableOpacity>
        </View>

        {pools === null ? (
          <ActivityIndicator color={colors.amber} style={{ marginVertical: 12 }} />
        ) : pools.length === 0 ? (
          <Text style={styles.emptyText}>No pools yet — tap New to create one.</Text>
        ) : (
          pools.map((p) => <MemoPoolRow key={p.id} pool={p} onPress={openPool} />)
        )}

        <TouchableOpacity style={styles.browseBtn} onPress={() => navigation.push('BrowsePools')}>
          <Ionicons name="globe-outline" size={16} color={colors.dim} />
          <Text style={styles.browseBtnText}> Browse Public Pools</Text>
        </TouchableOpacity>
      </ScrollView>

      <CreatePlaylistModal
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(pool) => {
          setCreateOpen(false);
          setPools((prev) => [pool, ...(prev || [])]);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 },
  sectionTitle: { color: colors.text, fontSize: 14, fontWeight: 'bold' },
  sectionCaption: { color: colors.dim, fontSize: 10, marginTop: 2 },
  newBtn: { flexDirection: 'row', alignItems: 'center', paddingTop: 2 },
  newBtnText: { color: colors.amber, fontWeight: '600', fontSize: 13 },
  emptyText: { color: colors.dim, fontSize: 12 },
  poolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  poolThumbWrap: { width: 48, height: 48, borderRadius: 6, overflow: 'hidden', backgroundColor: colors.panel2 },
  poolThumb: { width: '100%', height: '100%' },
  poolName: { color: colors.text, fontSize: 14 },
  poolDescription: { color: colors.dim, fontSize: 11, marginTop: 2 },
  poolMeta: { color: colors.dim, fontSize: 10, fontFamily: 'monospace', marginTop: 3 },
  browseBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    paddingVertical: 12,
    marginTop: 20,
  },
  browseBtnText: { color: colors.dim, fontSize: 13, fontWeight: '600' },
});
