import React, { useState, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Pressable,
} from 'react-native';
import { colors } from '../theme/colors';
import { Ionicons } from '@expo/vector-icons';
import { searchPosts, Post, getTagTypeMap } from '../api/sakugabooru';
import ArtistStatsView from './ArtistStatsView';
import PostCard from '../components/PostCard';
import EmptyState from '../components/EmptyState';

type Order = 'score' | 'date' | 'random';
type Mode = 'results' | 'stats';

export default function SearchScreen({ navigation }: any) {
  const [mode, setMode] = useState<Mode>('results');
  const [tags, setTags] = useState<string[]>([]);
  const [pending, setPending] = useState('');
  const [order, setOrder] = useState<Order>('score');
  const [results, setResults] = useState<Post[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Whichever artist tag the current query is "about", if any — shown in the
  // Stats tab's label so the two feel connected. Kept separate from
  // statsSeedTag below since these two need different remount behavior.
  const [syncedArtist, setSyncedArtist] = useState<string | null>(null);
  // Only set when a *Results* search finds an artist tag — this is what
  // actually remounts/auto-triggers ArtistStatsView. Deliberately NOT updated
  // when the sync originates from Stats itself, since that view already just
  // fetched its own fresh data and remounting it would trigger a pointless
  // duplicate fetch of the same thing it already has.
  const [statsSeedTag, setStatsSeedTag] = useState<string | null>(null);
  // Pagination state for the results grid — a fresh search always starts back
  // at page 1; loadMore() fetches the next page and appends rather than
  // replacing. activeQuery pins down exactly which tags/order the current
  // results actually belong to, so scrolling to load more can't accidentally
  // mix in whatever's currently sitting in the (possibly since-edited) inputs.
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [activeQuery, setActiveQuery] = useState<{ tags: string[]; order: Order } | null>(null);
  const PAGE_SIZE = 24;
  // Filter: which co-occurring tags in the current results are excluded.
  // Purely a client-side narrowing of the already-fetched batch, no refetch.
  const [excludedTags, setExcludedTags] = useState<Record<string, boolean>>({});
  const [filterOpen, setFilterOpen] = useState(false);

  const facetTags = useMemo(() => {
    if (!results || !activeQuery) return [];
    const freq: Record<string, number> = {};
    for (const p of results) {
      for (const t of (p.tags || '').split(/\s+/)) {
        if (!t || activeQuery.tags.includes(t)) continue;
        freq[t] = (freq[t] || 0) + 1;
      }
    }
    return Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 24)
      .map(([tag, count]) => ({ tag, count }));
  }, [results, activeQuery]);

  const visibleResults = useMemo(() => {
    if (!results) return results;
    const activeExclusions = Object.keys(excludedTags).filter((t) => excludedTags[t]);
    if (activeExclusions.length === 0) return results;
    return results.filter((p) => {
      const postTags = (p.tags || '').split(/\s+/);
      return !activeExclusions.some((t) => postTags.includes(t));
    });
  }, [results, excludedTags]);

  const activeExclusionCount = Object.values(excludedTags).filter(Boolean).length;

  const commitTag = useCallback(() => {
    const v = pending.trim().toLowerCase().replace(/\s+/g, '_');
    if (v) {
      setTags((t) => [...t, v]);
      setPending('');
    }
  }, [pending]);

  const removeTag = (i: number) => setTags((t) => t.filter((_, idx) => idx !== i));

  const performSearch = useCallback(
    async (tagsToUse: string[], syncToStats = true) => {
      setLoading(true);
      setError(null);
      setPage(1);
      setHasMore(true);
      setExcludedTags({});
      try {
        const posts = await searchPosts(tagsToUse, order, PAGE_SIZE, 1);
        setResults(posts);
        setActiveQuery({ tags: tagsToUse, order });
        setHasMore(posts.length === PAGE_SIZE);
      } catch (e: any) {
        setError(e.message || 'search failed');
        setLoading(false);
        return; // search itself failed — no point running the sync detection below
      }
      setLoading(false); // results are visible now — nothing below should keep the spinner up

      // Detecting whether this query is "about" an artist (for the Stats sync
      // label) needs the full tag dictionary, which can take a few seconds on
      // a cold cache. That's a real cost, but it's a background nice-to-have —
      // it must never delay showing the results themselves, which is why this
      // runs as a separate operation after setLoading(false) above, not
      // chained into the same try block.
      try {
        const typeMap = await getTagTypeMap();
        const artistTag = tagsToUse.find((t) => typeMap[t] === 1) || null;
        setSyncedArtist(artistTag);
        if (syncToStats) setStatsSeedTag(artistTag);
      } catch {
        // Sync is a nice-to-have; a failure here shouldn't disrupt anything visible.
      }
    },
    [order]
  );

  const loadingMoreRef = useRef(false); // synchronous guard — React state alone
  // isn't enough here, since onEndReached can fire multiple times before a
  // state update from the previous call has actually propagated, causing the
  // same page to be fetched twice and duplicate posts to sneak into the list
  // (which then confuses FlatList's key-based rendering, since it keys by
  // post id — this was very likely the actual cause of filters "resetting").

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !hasMore || !activeQuery) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const nextPage = page + 1;
      const more = await searchPosts(activeQuery.tags, activeQuery.order, PAGE_SIZE, nextPage);
      setResults((prev) => {
        if (!prev) return more;
        const existingIds = new Set(prev.map((p) => p.id));
        const deduped = more.filter((p) => !existingIds.has(p.id));
        return [...prev, ...deduped];
      });
      setPage(nextPage);
      setHasMore(more.length === PAGE_SIZE);
    } catch (e: any) {
      // A failed "load more" isn't worth blowing away already-visible results
      // over — surface it quietly and let scrolling back down retry naturally.
      setError(e.message || 'failed to load more');
    } finally {
      setLoadingMore(false);
      loadingMoreRef.current = false;
    }
  }, [hasMore, activeQuery, page]);

  const runSearch = useCallback(() => {
    const finalTags = pending.trim() ? [...tags, pending.trim().toLowerCase().replace(/\s+/g, '_')] : tags;
    if (pending.trim()) {
      setTags(finalTags);
      setPending('');
    }
    performSearch(finalTags);
  }, [tags, pending, performSearch]);

  // A direct Stats lookup syncs back to Results: pre-fills the tag and re-runs
  // the search so switching tabs shows matching results without extra taps.
  // syncToStats=false here — Stats already has fresh data from its own
  // lookup, no need to remount/refetch it right back.
  const onStatsLookup = useCallback(
    (tag: string) => {
      setSyncedArtist(tag);
      setTags([tag]);
      performSearch([tag], false);
    },
    [performSearch]
  );

  return (
    <View style={styles.container}>
      <View style={styles.modeRow}>
        <TouchableOpacity
          style={[styles.modeBtn, mode === 'results' && styles.modeBtnActive]}
          onPress={() => setMode('results')}
        >
          <Ionicons name="grid-outline" size={14} color={mode === 'results' ? colors.amber : colors.dim} />
          <Text style={[styles.modeBtnText, mode === 'results' && styles.modeBtnTextActive]}> Results</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.modeBtn, mode === 'stats' && styles.modeBtnActive]}
          onPress={() => setMode('stats')}
        >
          <Ionicons name="bar-chart-outline" size={14} color={mode === 'stats' ? colors.amber : colors.dim} />
          <Text style={[styles.modeBtnText, mode === 'stats' && styles.modeBtnTextActive]}>
            {syncedArtist ? ` Stats: ${syncedArtist}` : ' Animator Stats'}
          </Text>
        </TouchableOpacity>
      </View>

      {mode === 'stats' ? (
        <ArtistStatsView key={statsSeedTag || 'none'} initialTag={statsSeedTag || undefined} onLookupSuccess={onStatsLookup} />
      ) : (
        <>
          <View style={styles.row}>
            <TextInput
              style={styles.input}
              placeholder="add tag, then Search"
              placeholderTextColor={colors.dim}
              value={pending}
              onChangeText={setPending}
              onSubmitEditing={commitTag}
              returnKeyType="done"
            />
          </View>

          <View style={styles.orderRow}>
            {(['score', 'date', 'random'] as Order[]).map((o) => (
              <TouchableOpacity
                key={o}
                style={[styles.orderBtn, order === o && styles.orderBtnActive]}
                onPress={() => setOrder(o)}
              >
                <Text style={[styles.orderBtnText, order === o && styles.orderBtnTextActive]}>
                  {o === 'score' ? 'top score' : o === 'date' ? 'newest' : 'random'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {tags.length > 0 && (
            <View style={styles.chips}>
              {tags.map((t, i) => (
                <Pressable key={i} style={styles.chip} onPress={() => removeTag(i)}>
                  <Text style={styles.chipText}>{t} ×</Text>
                </Pressable>
              ))}
              <Pressable style={styles.clearChip} onPress={() => setTags([])}>
                <Text style={styles.clearChipText}>clear all</Text>
              </Pressable>
            </View>
          )}

          <TouchableOpacity style={styles.searchBtn} onPress={runSearch}>
            <Text style={styles.searchBtnText}>Search</Text>
          </TouchableOpacity>

          {loading && <ActivityIndicator color={colors.amber} style={{ marginTop: 20 }} />}
          {error && <Text style={styles.error}>error: {error}</Text>}
          {!results && !loading && !error && (
            <EmptyState icon="film-outline" text="Add a tag above and hit Search to browse clips." />
          )}

          {results && !loading && facetTags.length > 0 && (
            <View style={styles.filterSection}>
              <TouchableOpacity style={styles.filterToggle} onPress={() => setFilterOpen((o) => !o)}>
                <Text style={styles.filterToggleText}>
                  Exclude tags {activeExclusionCount > 0 ? `(${activeExclusionCount})` : ''} {filterOpen ? '▴' : '▾'}
                </Text>
              </TouchableOpacity>
              {filterOpen && (
                <View style={styles.facetGrid}>
                  {facetTags.map(({ tag, count }) => {
                    const active = !!excludedTags[tag];
                    return (
                      <Pressable
                        key={tag}
                        style={[styles.facetChip, active && styles.facetChipActive]}
                        onPress={() => setExcludedTags((prev) => ({ ...prev, [tag]: !prev[tag] }))}
                      >
                        <Text style={[styles.facetChipText, active && styles.facetChipTextActive]}>
                          {active ? '✕ ' : ''}
                          {tag} ({count})
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </View>
          )}

          {visibleResults && !loading && (
            <FlatList
              style={{ marginTop: 12 }}
              data={visibleResults}
              keyExtractor={(p) => String(p.id)}
              numColumns={3}
              columnWrapperStyle={{ gap: 6 }}
              contentContainerStyle={{ gap: 6 }}
              onEndReached={loadMore}
              onEndReachedThreshold={0.5}
              ListEmptyComponent={
                <Text style={styles.empty}>
                  {activeExclusionCount > 0 ? 'no posts left after excluding those tags' : 'no posts matched those tags'}
                </Text>
              }
              ListFooterComponent={
                loadingMore ? (
                  <ActivityIndicator color={colors.amber} style={{ marginVertical: 16 }} />
                ) : !hasMore && visibleResults.length > 0 ? (
                  <Text style={styles.endOfResults}>— end of results —</Text>
                ) : null
              }
              renderItem={({ item }) => (
                <PostCard post={item} onPress={() => navigation.navigate('Viewer', { post: item })} />
              )}
            />
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: 12 },
  modeRow: { flexDirection: 'row', gap: 6, marginBottom: 10 },
  modeBtn: {
    flex: 1,
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 6,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeBtnActive: { borderColor: colors.amber, backgroundColor: colors.amberDim },
  modeBtnText: { color: colors.dim, fontSize: 12, fontWeight: 'bold' },
  modeBtnTextActive: { color: colors.amber },
  row: { flexDirection: 'row', gap: 8, marginBottom: 8 },
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
  orderRow: { flexDirection: 'row', gap: 6, marginBottom: 8 },
  orderBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    paddingVertical: 6,
    alignItems: 'center',
  },
  orderBtnActive: { borderColor: colors.amber, backgroundColor: colors.amberDim },
  orderBtnText: { color: colors.dim, fontSize: 12 },
  orderBtnTextActive: { color: colors.amber, fontWeight: 'bold' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  chip: {
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  chipText: { color: colors.text, fontSize: 12 },
  clearChip: {
    borderWidth: 1,
    borderColor: colors.red,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  clearChipText: { color: colors.red, fontSize: 12 },
  searchBtn: {
    backgroundColor: colors.amberDim,
    borderWidth: 1,
    borderColor: colors.amber,
    borderRadius: 6,
    paddingVertical: 10,
    alignItems: 'center',
  },
  searchBtnText: { color: colors.amber, fontWeight: 'bold' },
  error: { color: colors.red, marginTop: 12, textAlign: 'center' },
  empty: { color: colors.dim, textAlign: 'center', marginTop: 20 },
  endOfResults: { color: colors.dim, textAlign: 'center', fontSize: 11, marginVertical: 16 },
  filterSection: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  filterToggle: {
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 6,
    paddingVertical: 7,
    paddingHorizontal: 12,
    alignSelf: 'flex-start',
  },
  filterToggleText: { color: colors.dim, fontSize: 12, fontWeight: '600' },
  facetGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  facetChip: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  facetChipActive: { borderColor: colors.red, backgroundColor: 'rgba(217,99,74,0.15)' },
  facetChipText: { color: colors.dim, fontSize: 11 },
  facetChipTextActive: { color: colors.red },
});
