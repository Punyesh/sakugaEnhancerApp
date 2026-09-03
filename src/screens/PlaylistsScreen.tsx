import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';
import { getMyPoolIds, getPool, searchPools, Pool } from '../api/sakugabooru';
import { useAuth } from '../hooks/useAuth';
import LoginModal from '../components/LoginModal';
import CreatePlaylistModal from '../components/CreatePlaylistModal';
import { Ionicons } from '@expo/vector-icons';

function PoolRow({ pool, onPress }: { pool: Pool; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.poolRow} onPress={onPress}>
      <View style={{ flex: 1 }}>
        <Text style={styles.poolName}>{pool.name}</Text>
        {!!pool.description && (
          <Text style={styles.poolDescription} numberOfLines={1}>
            {pool.description}
          </Text>
        )}
      </View>
      <Text style={styles.poolMeta}>
        {pool.is_public ? 'Public' : 'Private'} · {pool.post_count}
      </Text>
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
  const [searchResults, setSearchResults] = useState<Pool[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const runSearch = useCallback(async () => {
    if (!query.trim()) return;
    setSearching(true);
    setSearchError(null);
    try {
      const results = await searchPools(query.trim());
      setSearchResults(results);
    } catch (e: any) {
      setSearchError(e.message || 'search failed');
    } finally {
      setSearching(false);
    }
  }, [query]);

  const openPool = (pool: Pool) => navigation.navigate('PlaylistDetail', { poolId: pool.id });

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
              placeholder="search playlists by name"
              placeholderTextColor={colors.dim}
              value={query}
              onChangeText={setQuery}
              onSubmitEditing={runSearch}
              returnKeyType="search"
              autoCapitalize="none"
            />
            <TouchableOpacity style={styles.searchBtn} onPress={runSearch} disabled={!query.trim()}>
              <Ionicons name="search" size={16} color={colors.amber} />
            </TouchableOpacity>
          </View>
          {searching && <ActivityIndicator color={colors.amber} style={{ marginVertical: 12 }} />}
          {searchError && <Text style={styles.error}>{searchError}</Text>}
          {searchResults && !searching && searchResults.length === 0 && (
            <Text style={styles.emptyText}>No public playlists matched that.</Text>
          )}
          {searchResults?.map((p) => <PoolRow key={p.id} pool={p} onPress={() => openPool(p)} />)}
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
    gap: 8,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  poolName: { color: colors.text, fontSize: 14 },
  poolDescription: { color: colors.dim, fontSize: 11, marginTop: 2 },
  poolMeta: { color: colors.dim, fontSize: 11, fontFamily: 'monospace' },
  searchRow: { flexDirection: 'row', gap: 8, marginBottom: 4 },
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
  searchBtn: {
    width: 40,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
  },
});
