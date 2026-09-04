import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, Modal, FlatList, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { getMyPoolIds, getPool, addPostToPool, Pool } from '../api/sakugabooru';
import { StoredCredentials } from '../api/auth';
import CreatePlaylistModal from './CreatePlaylistModal';

export default function AddToPlaylistModal({
  visible,
  postId,
  credentials,
  onClose,
}: {
  visible: boolean;
  postId: number;
  credentials: StoredCredentials;
  onClose: () => void;
}) {
  const [pools, setPools] = useState<Pool[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [addingId, setAddingId] = useState<number | null>(null);
  const [addedIds, setAddedIds] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const loadPools = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const ids = await getMyPoolIds();
      const results = await Promise.all(ids.map((id) => getPool(id).catch(() => null)));
      setPools(results.filter((p): p is Pool => p !== null));
    } catch (e: any) {
      setError(e.message || 'failed to load pools');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) {
      loadPools();
      setAddedIds(new Set());
    }
  }, [visible, loadPools]);

  const doAdd = useCallback(
    async (pool: Pool) => {
      setAddingId(pool.id);
      setError(null);
      try {
        await addPostToPool(pool.id, postId, credentials.username, credentials.passwordHash);
        setAddedIds((prev) => new Set(prev).add(pool.id));
      } catch (e: any) {
        setError(e.message || 'failed to add to pool');
      } finally {
        setAddingId(null);
      }
    },
    [postId, credentials]
  );

  return (
    <>
      <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Add to Pool</Text>
            {loading && <ActivityIndicator color={colors.amber} style={{ marginVertical: 12 }} />}
            {!loading && pools && pools.length === 0 && (
              <Text style={styles.emptyText}>No pools yet — create one below.</Text>
            )}
            {!loading && pools && pools.length > 0 && (
              <FlatList
                data={pools}
                keyExtractor={(p) => String(p.id)}
                style={{ maxHeight: 260 }}
                renderItem={({ item }) => {
                  const added = addedIds.has(item.id);
                  return (
                    <TouchableOpacity
                      style={styles.poolRow}
                      disabled={added || addingId === item.id}
                      onPress={() => doAdd(item)}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.poolName}>{item.name}</Text>
                        <Text style={styles.poolMeta}>
                          {item.is_public ? 'Public' : 'Private'} · {item.post_count} clip
                          {item.post_count === 1 ? '' : 's'}
                        </Text>
                      </View>
                      {addingId === item.id ? (
                        <ActivityIndicator color={colors.amber} size="small" />
                      ) : added ? (
                        <Ionicons name="checkmark-circle" size={20} color={colors.amber} />
                      ) : (
                        <Ionicons name="add-circle-outline" size={20} color={colors.dim} />
                      )}
                    </TouchableOpacity>
                  );
                }}
              />
            )}
            {error && <Text style={styles.error}>{error}</Text>}
            <TouchableOpacity style={styles.newPlaylistBtn} onPress={() => setCreateOpen(true)}>
              <Ionicons name="add" size={16} color={colors.amber} />
              <Text style={styles.newPlaylistText}> New Pool</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancel} onPress={onClose}>
              <Text style={styles.cancelText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      <CreatePlaylistModal
        visible={createOpen}
        credentials={credentials}
        onClose={() => setCreateOpen(false)}
        onCreated={async (pool) => {
          setCreateOpen(false);
          setPools((prev) => (prev ? [...prev, pool] : [pool]));
          await doAdd(pool); // add the current post immediately, since that's why this was opened in the first place
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  modalCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    padding: 18,
  },
  modalTitle: { color: colors.text, fontSize: 16, fontWeight: 'bold', marginBottom: 14 },
  emptyText: { color: colors.dim, fontSize: 12, textAlign: 'center', marginVertical: 12 },
  poolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  poolName: { color: colors.text, fontSize: 14 },
  poolMeta: { color: colors.dim, fontSize: 11, marginTop: 2 },
  error: { color: colors.red, fontSize: 12, textAlign: 'center', marginVertical: 8 },
  newPlaylistBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.amberDim,
    borderRadius: 6,
    paddingVertical: 8,
    marginTop: 12,
  },
  newPlaylistText: { color: colors.amber, fontWeight: '600', fontSize: 13 },
  cancel: { alignItems: 'center', marginTop: 10 },
  cancelText: { color: colors.dim, fontSize: 12 },
});
