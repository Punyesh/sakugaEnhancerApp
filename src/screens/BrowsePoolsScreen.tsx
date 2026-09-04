import React, { useState, useCallback, useEffect, useRef, memo } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Image, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';
import { searchPools, listPools, getPoolPreviewThumb, Pool } from '../api/sakugabooru';
import { Ionicons } from '@expo/vector-icons';

function PoolRow({ pool, onPress }: { pool: Pool; onPress: (pool: Pool) => void }) {
  const [thumb, setThumb] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    getPoolPreviewThumb(pool.id)
      .then((url) => {
        if (!cancelled) setThumb(url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [pool.id]);

  return (
    <TouchableOpacity style={styles.poolRow} onPress={() => onPress(pool)}>
      <View style={styles.poolThumbWrap}>
        {thumb ? <Image source={{ uri: thumb }} style={styles.poolThumb} /> : <View style={styles.poolThumbEmpty} />}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.poolName}>{pool.name}</Text>
        {!!pool.description && (
          <Text style={styles.poolDescription} numberOfLines={1}>
            {pool.description}
          </Text>
        )}
        <Text style={styles.poolMeta}>{pool.post_count} clips</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.dim} />
    </TouchableOpacity>
  );
}
const MemoPoolRow = memo(PoolRow);

export default function BrowsePoolsScreen({ navigation }: any) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Pool[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Defensive: only ever show pools genuinely marked public, regardless of
  // what the server's own search/listing actually returns.
  const onlyPublic = (pools: Pool[]) => pools.filter((p) => p.is_public);

  const runBrowse = useCallback(async (q: string) => {
    setLoading(true);
    setError(null);
    try {
      const found = q.trim() ? await searchPools(q.trim()) : await listPools(1);
      setResults(onlyPublic(found));
    } catch (e: any) {
      setError(e.message || 'failed to load pools');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runBrowse(query), query ? 300 : 0);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const openPool = useCallback((pool: Pool) => navigation.push('PlaylistDetail', { poolId: pool.id }), [navigation]);

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <View style={styles.searchRow}>
          <TextInput
            style={styles.searchInput}
            placeholder="search by name, or leave blank to browse all"
            placeholderTextColor={colors.dim}
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
          />
          {loading && <ActivityIndicator color={colors.amber} size="small" style={styles.inlineSpinner} />}
        </View>
        {error && <Text style={styles.error}>{error}</Text>}
        {results && !loading && results.length === 0 && (
          <Text style={styles.emptyText}>{query.trim() ? 'No pools matched that.' : 'No public pools yet.'}</Text>
        )}
        {results?.map((p) => (
          <MemoPoolRow key={p.id} pool={p} onPress={openPool} />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  emptyText: { color: colors.dim, fontSize: 12 },
  error: { color: colors.red, fontSize: 12, marginTop: 6 },
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
  poolThumbEmpty: { width: '100%', height: '100%' },
  poolName: { color: colors.text, fontSize: 14 },
  poolDescription: { color: colors.dim, fontSize: 11, marginTop: 2 },
  poolMeta: { color: colors.dim, fontSize: 10, fontFamily: 'monospace', marginTop: 3 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  searchInput: {
    flex: 1,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    color: colors.text,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
  },
  inlineSpinner: { marginLeft: -4 },
});
