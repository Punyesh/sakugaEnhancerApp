import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import { colors } from '../theme/colors';
import { fetchArtistPosts, computeArtistStats, ArtistStats } from '../api/sakugabooru';
import EmptyState from '../components/EmptyState';

interface Props {
  initialTag?: string;
  onLookupSuccess?: (tag: string) => void;
}

export default function ArtistStatsView({ initialTag, onLookupSuccess }: Props) {
  const [name, setName] = useState(initialTag || '');
  const [stats, setStats] = useState<ArtistStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lookup = useCallback(
    async (overrideName?: string) => {
      const tag = (overrideName ?? name).trim().toLowerCase().replace(/\s+/g, '_');
      if (!tag) return;
      setLoading(true);
      setError(null);
      setStats(null);
      try {
        const posts = await fetchArtistPosts(tag);
        setStats(computeArtistStats(tag, posts));
        onLookupSuccess?.(tag);
      } catch (e: any) {
        setError(e.message || 'lookup failed');
      } finally {
        setLoading(false);
      }
    },
    [name, onLookupSuccess]
  );

  // Arriving here because Results found an artist tag in the search — run the
  // lookup automatically instead of making the person retype/re-tap it.
  useEffect(() => {
    if (initialTag) lookup(initialTag);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const years = stats ? Object.keys(stats.yearCounts).sort() : [];
  const maxYearCount = years.length ? Math.max(...years.map((y) => stats!.yearCounts[y])) : 0;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ flexGrow: 1 }}>
      <View style={styles.row}>
        <TextInput
          style={styles.input}
          placeholder="animator name, e.g. yutaka_nakamura"
          placeholderTextColor={colors.dim}
          value={name}
          onChangeText={setName}
          onSubmitEditing={() => lookup()}
          returnKeyType="search"
          autoCapitalize="none"
        />
        <TouchableOpacity style={styles.lookupBtn} onPress={() => lookup()}>
          <Text style={styles.lookupBtnText}>Look up</Text>
        </TouchableOpacity>
      </View>

      {loading && (
        <View style={{ marginTop: 24, alignItems: 'center' }}>
          <ActivityIndicator color={colors.amber} />
          <Text style={styles.loadingNote}>fetching posts (paginated, may take a few seconds)…</Text>
        </View>
      )}
      {error && <Text style={styles.error}>error: {error}</Text>}
      {!stats && !loading && !error && (
        <EmptyState icon="bar-chart-outline" text="Look up an animator to see their cut count, average score, and activity over time." />
      )}

      {stats && !loading && (
        <View style={{ marginTop: 16 }}>
          {stats.total === 0 ? (
            <Text style={styles.empty}>no posts found for that tag</Text>
          ) : (
            <>
              <View style={styles.summaryRow}>
                <View style={styles.summaryBox}>
                  <Text style={styles.summaryNum}>{stats.total}</Text>
                  <Text style={styles.summaryLabel}>cuts sampled</Text>
                </View>
                <View style={styles.summaryBox}>
                  <Text style={styles.summaryNum}>{stats.avgScore.toFixed(1)}</Text>
                  <Text style={styles.summaryLabel}>avg score</Text>
                </View>
              </View>

              <Text style={styles.sectionTitle}>
                activity by upload year{' '}
                <Text style={styles.sectionHint}>(when tagged on sakugabooru, not broadcast year)</Text>
              </Text>
              <View style={styles.chart}>
                {years.map((y) => (
                  <View key={y} style={styles.chartCol}>
                    <View
                      style={[
                        styles.chartBar,
                        { height: Math.max(4, (stats.yearCounts[y] / maxYearCount) * 80) },
                      ]}
                    />
                    <Text style={styles.chartCount}>{stats.yearCounts[y]}</Text>
                    <Text style={styles.chartYear}>{y.slice(2)}</Text>
                  </View>
                ))}
              </View>

              <Text style={styles.sectionTitle}>top co-tags</Text>
              <View style={styles.tagWrap}>
                {stats.topTags.map((t) => (
                  <View key={t.tag} style={styles.tagChip}>
                    <Text style={styles.tagChipText}>
                      {t.tag} <Text style={styles.tagChipCount}>{t.count}</Text>
                    </Text>
                  </View>
                ))}
              </View>
            </>
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  row: { flexDirection: 'row', gap: 8 },
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
  lookupBtn: {
    backgroundColor: colors.amberDim,
    borderWidth: 1,
    borderColor: colors.amber,
    borderRadius: 6,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  lookupBtnText: { color: colors.amber, fontWeight: 'bold', fontSize: 12 },
  loadingNote: { color: colors.dim, fontSize: 11, marginTop: 8, textAlign: 'center' },
  error: { color: colors.red, marginTop: 16, textAlign: 'center' },
  empty: { color: colors.dim, textAlign: 'center', marginTop: 8 },
  summaryRow: { flexDirection: 'row', gap: 10 },
  summaryBox: {
    flex: 1,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 6,
    paddingVertical: 12,
    alignItems: 'center',
  },
  summaryNum: { color: colors.amber, fontSize: 22, fontWeight: 'bold', fontFamily: 'monospace' },
  summaryLabel: { color: colors.dim, fontSize: 11, marginTop: 2 },
  sectionTitle: { color: colors.text, fontSize: 13, fontWeight: 'bold', marginTop: 20, marginBottom: 10 },
  sectionHint: { color: colors.dim, fontSize: 11, fontWeight: 'normal' },
  chart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
    height: 110,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    paddingBottom: 4,
  },
  chartCol: { alignItems: 'center', flex: 1 },
  chartBar: { width: '70%', backgroundColor: colors.amberDim, borderRadius: 2 },
  chartCount: { color: colors.dim, fontSize: 9, marginTop: 3 },
  chartYear: { color: colors.dim, fontSize: 10, fontFamily: 'monospace', marginTop: 1 },
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tagChip: {
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  tagChipText: { color: colors.text, fontSize: 11 },
  tagChipCount: { color: colors.amber },
});
