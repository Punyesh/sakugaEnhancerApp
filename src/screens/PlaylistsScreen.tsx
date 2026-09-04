import React, { useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Image, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';
import { getMyPoolIds, getPool, searchPools, listPools, getPoolPreviewThumb, Pool } from '../api/sakugabooru';
import { useAuth } from '../hooks/useAuth';
import LoginModal from '../components/LoginModal';
import CreatePlaylistModal from '../components/CreatePlaylistModal';
import { Ionicons } from '@expo/vector-icons';

function PoolRow({ pool, onPress }: { pool: Pool; onPress: () => void }) {
  // Each row fetches its own preview independently (rather than the parent
  // list blocking on every pool's thumbnail before showing anything), and
  // just quietly shows a blank placeholder if a pool has no posts yet or
  // the fetch fails — not worth an error state for a decorative thumbnail.
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
    <TouchableOpacity style={styles.poolRow} onPress={onPress}>
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
        <Text style={styles.poolMeta}>
          {pool.is_public ? 'Public' : 'Private'} · {pool.post_count} clip{pool.post_count === 1 ? '' : 's'}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.dim} />
    </TouchableOpacity>
  );
}

export default function PlaylistsScreen({ navigation }: any) {
  const { credentials, setCredentials } = useAuth();
  const [loginOpen, setLoginOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const [myPools, setMyPools] = useState<Pool[] | null>(null);
  const [myPoolsLoading, setMyPoolsLoading] = useState(false);

  const loadMyPools = useCallback(async () => {
    setMyPoolsLoading(true);
    try {
      const ids = await getMyPoolIds();
      const results = await Promise.all(ids.map((id) => getPool(id).catch(() => null)));
      setMyPools(results.filter((p): p is Pool => p !== null).reverse()); // newest-created first
    } finally {
      setMyPoolsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (credentials) loadMyPools();
  }, [credentials, loadMyPools]);

  // Refresh whenever this tab regains focus — a playlist created or deleted
  // from elsewhere (e.g. the Viewer's Add to Playlist flow) should show up
  // here without needing a manual pull-to-refresh.
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      if (credentials) loadMyPools();
    });
    return unsubscribe;
  }, [navigation, credentials, loadMyPools]);

  const [query, setQuery] = useState('');
  const [browseResults, setBrowseResults] = useState<Pool[] | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Defensive: only ever show pools genuinely marked public in this section,
  // regardless of what the server's own search/listing actually returns —
  // this section is specifically "other people's public playlists," so a
  // private one showing up here would be a real problem even if it's the
  // server's filtering that's imperfect, not just our own bug.
  const onlyPublic = (pools: Pool[]) => pools.filter((p) => p.is_public);

  const runBrowse = useCallback(async (q: string) => {
    setBrowsing(true);
    setBrowseError(null);
    try {
      const results = q.trim() ? await searchPools(q.trim()) : await listPools(1);
      setBrowseResults(onlyPublic(results));
    } catch (e: any) {
      setBrowseError(e.message || 'failed to load playlists');
    } finally {
      setBrowsing(false);
    }
  }, []);

  // Live, debounced — browse-all runs immediately on mount (empty query),
  // then re-runs (debounced) as the user types, matching the same pattern
  // as the Search tab's tag suggestions.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runBrowse(query), query ? 300 : 0);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const openPool = (pool: Pool) => navigation.push('PlaylistDetail', { poolId: pool.id });

  return (
    <View style={styles.container}>
      <ScrollView>
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>My Playlists</Text>
            {credentials && (
              <TouchableOpacity onPress={() => setCreateOpen(true)} style={styles.newBtn}>
                <Ionicons name="add" size={16} color={colors.amber} />
                <Text style={styles.newBtnText}> New</Text>
              </TouchableOpacity>
            )}
          </View>

          {!credentials ? (
            <TouchableOpacity onPress={() => setLoginOpen(true)}>
              <Text style={styles.loginLink}>Log in to see your playlists</Text>
            </TouchableOpacity>
          ) : myPoolsLoading ? (
            <ActivityIndicator color={colors.amber} style={{ marginVertical: 12 }} />
          ) : myPools && myPools.length === 0 ? (
            <Text style={styles.emptyText}>No playlists yet — tap New to create one.</Text>
          ) : (
            myPools?.map((p) => <PoolRow key={p.id} pool={p} onPress={() => openPool(p)} />)
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Browse Public Playlists</Text>
          <View style={styles.searchRow}>
            <TextInput
              style={styles.searchInput}
              placeholder="search by name, or leave blank to browse all"
              placeholderTextColor={colors.dim}
              value={query}
              onChangeText={setQuery}
              autoCapitalize="none"
            />
            {browsing && <ActivityIndicator color={colors.amber} size="small" style={styles.inlineSpinner} />}
          </View>
          {browseError && <Text style={styles.error}>{browseError}</Text>}
          {browseResults && !browsing && browseResults.length === 0 && (
            <Text style={styles.emptyText}>
              {query.trim() ? 'No public playlists matched that.' : 'No public playlists yet.'}
            </Text>
          )}
          {browseResults?.map((p) => <PoolRow key={p.id} pool={p} onPress={() => openPool(p)} />)}
        </View>
      </ScrollView>

      <LoginModal
        visible={loginOpen}
        onClose={() => setLoginOpen(false)}
        onSuccess={(creds) => {
          setCredentials(creds);
          setLoginOpen(false);
        }}
      />
      {credentials && (
        <CreatePlaylistModal
          visible={createOpen}
          credentials={credentials}
          onClose={() => setCreateOpen(false)}
          onCreated={(pool) => {
            setCreateOpen(false);
            setMyPools((prev) => [pool, ...(prev || [])]);
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  section: { padding: 16, borderBottomWidth: 1, borderBottomColor: colors.line },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  sectionTitle: { color: colors.text, fontSize: 14, fontWeight: 'bold', marginBottom: 10 },
  newBtn: { flexDirection: 'row', alignItems: 'center' },
  newBtnText: { color: colors.amber, fontWeight: '600', fontSize: 13 },
  loginLink: { color: colors.amber, fontSize: 13, fontWeight: '600' },
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
