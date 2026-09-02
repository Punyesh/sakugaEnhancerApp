import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, ActivityIndicator } from 'react-native';
import { colors } from '../theme/colors';
import { searchTags, Tag } from '../api/sakugabooru';
import EmptyState from '../components/EmptyState';

const DEBOUNCE_MS = 150; // short — this is an in-memory filter against an
// already-fetched tag dictionary (especially now it's prefetched on app
// launch), not a network round-trip, so it can afford to feel instant like
// the bookmarklet's live type-ahead did.

export default function ShowSearchScreen({ navigation }: any) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Tag[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!query.trim()) {
      setResults(null);
      setError(null);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const tags = await searchTags(query, 3, 25); // type 3 = copyright/show tags
        if (!cancelled) setResults(tags);
      } catch (e: any) {
        if (!cancelled) setError(e.message || 'search failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query]);

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <TextInput
          style={styles.input}
          placeholder="search a show title"
          placeholderTextColor={colors.dim}
          value={query}
          onChangeText={setQuery}
          returnKeyType="search"
          autoCapitalize="none"
        />
        {loading && <ActivityIndicator color={colors.amber} style={styles.inlineSpinner} />}
      </View>

      {error && <Text style={styles.error}>error: {error}</Text>}
      {!results && !loading && !error && (
        <EmptyState icon="tv-outline" text="Start typing a show title — results appear as you type, tap one to jump right in." />
      )}

      {results && (
        <FlatList
          style={{ marginTop: 12 }}
          data={results}
          keyExtractor={(t) => t.name}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={<Text style={styles.empty}>no matching titles found</Text>}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.row2}
              onPress={() => navigation.navigate('ShowDetail', { showTag: item.name })}
            >
              <Text style={styles.showName}>{item.name}</Text>
              <Text style={styles.showCount}>{item.count}</Text>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: {
    flex: 1,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 6,
    color: colors.text,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  inlineSpinner: { marginLeft: 4 },
  error: { color: colors.red, marginTop: 16, textAlign: 'center' },
  empty: { color: colors.dim, textAlign: 'center', marginTop: 20 },
  row2: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 6,
  },
  showName: { color: colors.text, fontSize: 13 },
  showCount: { color: colors.dim, fontSize: 12, fontFamily: 'monospace' },
});
