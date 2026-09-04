import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Pressable,
  Keyboard,
} from 'react-native';
import { colors } from '../theme/colors';
import { Ionicons } from '@expo/vector-icons';
import { searchPosts, Post, getTagTypeMap, searchTags, Tag } from '../api/sakugabooru';
import ArtistStatsView from './ArtistStatsView';
import PostCard from '../components/PostCard';
import EmptyState from '../components/EmptyState';

type Order = 'score' | 'score_asc' | 'date' | 'id_asc' | 'random';

// Top Score and Newest stay as their own fixed, always-visible buttons —
// everything else lives behind the third "more" button as a dropdown list.
const MORE_SORT_OPTIONS: { value: Order; label: string }[] = [
  { value: 'random', label: 'Random' },
  { value: 'score_asc', label: 'Lowest Score' },
  { value: 'id_asc', label: 'Oldest' },
];
type Mode = 'results' | 'stats';

export default function SearchScreen({ navigation }: any) {
  const [mode, setMode] = useState<Mode>('results');
  const [tags, setTags] = useState<string[]>([]);
  const [pending, setPending] = useState('');
  const [suggestions, setSuggestions] = useState<Tag[] | null>(null);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);

  useEffect(() => {
    if (!pending.trim()) {
      setSuggestions(null);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(async () => {
      setSuggestionsLoading(true);
      try {
        const results = await searchTags(pending, undefined, 8); // any tag type — general/artist/show all suggested here
        if (!cancelled) setSuggestions(results);
      } catch {
        // A failed suggestion lookup isn't worth an error banner — just show none.
        if (!cancelled) setSuggestions(null);
      } finally {
        if (!cancelled) setSuggestionsLoading(false);
      }
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [pending]);

  const [order, setOrder] = useState<Order>('score');
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
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

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [tagTypes, setTagTypes] = useState<Record<string, number>>({});
  const [soloOnly, setSoloOnly] = useState(false);
  // Separate from soloOnly specifically so the checkbox icon can update
  // instantly on press — filtering + the FlatList re-render that follows
  // was blocking that same render pass, making even the tap itself feel
  // laggy. Deferring the actual filter by one tick lets the icon paint
  // first, independent of how long the heavier work takes.
  const [soloOnlyApplied, setSoloOnlyApplied] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setSoloOnlyApplied(soloOnly), 0);
    return () => clearTimeout(timer);
  }, [soloOnly]);

  // True for the brief window between the icon toggling and the actual
  // (heavier) filter catching up — shown as a small spinner instead of the
  // icon, same reasoning as the PostCard buffering indicator: makes a real,
  // if brief, wait feel intentional rather than broken.
  const soloOnlyPending = soloOnly !== soloOnlyApplied;

  // "Solo cuts only" contradicts a search that already requires 2+ animators
  // to all be credited together (every result would necessarily have 2+
  // animator tags, so "exactly 1" could never match anything) — disable
  // rather than let someone hit a silently-empty result.
  const searchedAnimatorCount = activeQuery
    ? activeQuery.tags.filter((t) => tagTypes[t] === 1).length
    : 0;
  const soloOnlyDisabled = searchedAnimatorCount > 1;

  useEffect(() => {
    if (soloOnlyDisabled && soloOnly) setSoloOnly(false);
  }, [soloOnlyDisabled, soloOnly]);

  // Solo cut = exactly one animator-type tag on the post. Same client-side
  // approach as the exclude-tags filter, since there's no server-side tag
  // syntax for "exactly one of type X" — reuses the same tagTypes map
  // already populated after every search.
  const visibleResults = useMemo(() => {
    if (!results) return results;
    let filtered = results;
    const activeExclusions = Object.keys(excludedTags).filter((t) => excludedTags[t]);
    if (activeExclusions.length > 0) {
      filtered = filtered.filter((p) => {
        const postTags = (p.tags || '').split(/\s+/);
        return !activeExclusions.some((t) => postTags.includes(t));
      });
    }
    if (soloOnlyApplied) {
      filtered = filtered.filter((p) => {
        const postTags = (p.tags || '').split(/\s+/).filter(Boolean);
        const animatorCount = postTags.filter((t) => tagTypes[t] === 1).length;
        return animatorCount === 1;
      });
    }
    return filtered;
  }, [results, excludedTags, soloOnlyApplied, tagTypes]);

  // Stable references shared by every card, rather than a fresh inline
  // closure per card per render — required for PostCard's memo() to
  // actually skip re-rendering unrelated cards when selection changes.
  const handleSelectCard = useCallback((id: number) => setSelectedId(id), []);
  const handleOpenCard = useCallback(
    (post: Post) => {
      setSelectedId(null);
      navigation.navigate('Viewer', { post });
    },
    [navigation]
  );

  // A selected clip's info strip shouldn't survive navigating away entirely
  // (e.g. switching to the Shows tab) — this tab stays mounted in the
  // background rather than unmounting, so a plain unmount cleanup wouldn't
  // catch that; the navigation blur event does.
  useEffect(() => {
    const unsubscribe = navigation.addListener('blur', () => setSelectedId(null));
    return unsubscribe;
  }, [navigation]);
  // Synchronous, no fetch at all — post.tags is already in memory from the
  // search results themselves. No need to classify tag types for this, just
  // the plain raw tag string, matching the bookmarklet's own minimal design.
  const selectedPost = selectedId !== null ? visibleResults?.find((p) => p.id === selectedId) || null : null;

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
      Keyboard.dismiss(); // otherwise the first tap on a fresh result just closes the keyboard
      setLoading(true);
      setSelectedId(null); // clear immediately, not just once new results arrive
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
        setTagTypes(typeMap); // also drives chip coloring below, not just the Stats sync
        const artistTag = tagsToUse.find((t) => typeMap[t] === 1) || null;
        setSyncedArtist(artistTag);
        if (syncToStats) setStatsSeedTag(artistTag);
      } catch {
        // Sync is a nice-to-have; a failure here shouldn't disrupt anything visible.
      }
    },
    [order]
  );

  // Selecting a suggestion runs the search immediately with the updated tag
  // list — typing then picking a suggestion is how someone finishes
  // specifying what they're looking for, so there's no reason to also
  // require a separate Search tap afterward. (Manually typing a full tag and
  // pressing Enter via commitTag still just adds a chip without searching,
  // since that path is more often used to string several tags together
  // before searching once.)
  const selectSuggestion = useCallback(
    (tag: Tag) => {
      const finalTags = [...tags, tag.name];
      setTags(finalTags);
      setTagTypes((prev) => ({ ...prev, [tag.name]: tag.type })); // known immediately, no need to wait for search to complete
      setPending('');
      setSuggestions(null);
      performSearch(finalTags);
    },
    [tags, performSearch]
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

  // Changing sort order while a search is already active re-runs it
  // automatically with the same tags — no reason to make the user press
  // Search again just to re-sort results they already have.
  useEffect(() => {
    if (activeQuery) {
      performSearch(activeQuery.tags, false); // already synced to Stats; also clears selection internally now
    }
  }, [order]);

  const runSearch = useCallback(() => {
    const finalTags = pending.trim() ? [...tags, pending.trim().toLowerCase().replace(/\s+/g, '_')] : tags;
    if (pending.trim()) {
      setTags(finalTags);
      setPending('');
    }
    performSearch(finalTags);
  }, [tags, pending, performSearch]);

  // A direct, manual Stats lookup syncs back to Results — pre-fills the tag
  // and re-runs the search, since that's a deliberate new investigation.
  // The automatic sync (isAutoSync=true, when Results already had 2+
  // animator tags and Stats auto-shows the first one as a convenience)
  // must NOT do this — it was overwriting the whole tags array down to
  // just that one animator, silently discarding every other tag in the
  // search the moment you glanced at Stats.
  const onStatsLookup = useCallback(
    (tag: string, isAutoSync: boolean) => {
      setSyncedArtist(tag);
      if (isAutoSync) return;
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
          onPress={() => {
            setMode('stats');
            setSelectedId(null);
          }}
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
              autoCapitalize="none"
            />
            {suggestionsLoading && <ActivityIndicator color={colors.amber} style={styles.inlineSpinner} />}
          </View>

          {suggestions && suggestions.length > 0 && (
            <View style={styles.suggestList}>
              {suggestions.map((t) => (
                <TouchableOpacity key={t.name} style={styles.suggestRow} onPress={() => selectSuggestion(t)}>
                  <Text
                    style={[
                      styles.suggestName,
                      t.type === 1 && styles.suggestNameArtist,
                      t.type === 3 && styles.suggestNameShow,
                    ]}
                    numberOfLines={2}
                  >
                    {t.name}
                  </Text>
                  <View style={styles.suggestRightCol}>
                    {t.type === 1 && <Text style={styles.suggestType}>artist</Text>}
                    {t.type === 3 && <Text style={styles.suggestType}>series</Text>}
                    <Text style={styles.suggestCount}>{t.count}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <View style={styles.sortRow}>
            <TouchableOpacity
              style={[styles.sortBtn, order === 'score' && styles.sortBtnActive]}
              onPress={() => setOrder('score')}
            >
              <Text style={[styles.sortBtnText, order === 'score' && styles.sortBtnTextActive]}>Top Score</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.sortBtn, order === 'date' && styles.sortBtnActive]}
              onPress={() => setOrder('date')}
            >
              <Text style={[styles.sortBtnText, order === 'date' && styles.sortBtnTextActive]}>Newest</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.sortBtn, order !== 'score' && order !== 'date' && styles.sortBtnActive]}
              onPress={() => setSortMenuOpen((o) => !o)}
            >
              <Text
                style={[
                  styles.sortBtnText,
                  order !== 'score' && order !== 'date' && styles.sortBtnTextActive,
                ]}
              >
                {order !== 'score' && order !== 'date'
                  ? MORE_SORT_OPTIONS.find((o) => o.value === order)?.label
                  : 'More'}
              </Text>
              <Ionicons
                name={sortMenuOpen ? 'chevron-up' : 'chevron-down'}
                size={12}
                color={order !== 'score' && order !== 'date' ? colors.amber : colors.dim}
              />
            </TouchableOpacity>
          </View>
          {sortMenuOpen && (
            <View style={styles.sortMenu}>
              {MORE_SORT_OPTIONS.map((o) => (
                <TouchableOpacity
                  key={o.value}
                  style={styles.sortMenuRow}
                  onPress={() => {
                    setOrder(o.value);
                    setSortMenuOpen(false);
                  }}
                >
                  <Text style={[styles.sortMenuRowText, order === o.value && styles.sortMenuRowTextActive]}>
                    {o.label}
                  </Text>
                  {order === o.value && <Ionicons name="checkmark" size={16} color={colors.amber} />}
                </TouchableOpacity>
              ))}
            </View>
          )}

          {tags.length > 0 && (
            <View style={styles.chips}>
              {tags.map((t, i) => (
                <Pressable key={i} style={styles.chip} onPress={() => removeTag(i)}>
                  <Text
                    style={[
                      styles.chipText,
                      tagTypes[t] === 1 && styles.chipTextArtist,
                      tagTypes[t] === 3 && styles.chipTextShow,
                    ]}
                  >
                    {t} ×
                  </Text>
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

          {results && !loading && (
            <TouchableOpacity
              style={[styles.soloToggle, soloOnly && styles.soloToggleActive, soloOnlyDisabled && styles.soloToggleDisabled]}
              onPress={() => setSoloOnly((s) => !s)}
              disabled={soloOnlyDisabled}
            >
              {soloOnlyPending ? (
                <ActivityIndicator color={colors.amber} size="small" />
              ) : (
                <Ionicons name={soloOnly ? 'person' : 'person-outline'} size={18} color={soloOnly ? colors.amber : colors.dim} />
              )}
            </TouchableOpacity>
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
              // Right when 24 fresh results land, all their thumbnails try to
              // decode at once, which can make the UI thread busy enough that
              // the very next tap feels like it doesn't register. Rendering
              // fewer items up front (just enough to fill the screen) and
              // batching the rest spreads that decode cost out instead of
              // dumping it all in a single frame.
              initialNumToRender={12}
              maxToRenderPerBatch={9}
              windowSize={5}
              updateCellsBatchingPeriod={50}
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
                <PostCard
                  post={item}
                  selected={selectedId === item.id}
                  onSelect={handleSelectCard}
                  onOpen={handleOpenCard}
                />
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
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  inlineSpinner: { marginLeft: -4 },
  suggestList: {
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 6,
    marginTop: -4,
    marginBottom: 10,
    overflow: 'hidden',
  },
  suggestRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  suggestRightCol: { alignItems: 'flex-end', flexShrink: 0, marginLeft: 8 },
  suggestName: { color: colors.text, fontSize: 13, flex: 1, flexShrink: 1 },
  suggestNameArtist: { color: colors.amber, fontWeight: '600' },
  suggestNameShow: { color: colors.link },
  suggestType: { color: colors.dim, fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.5 },
  suggestCount: { color: colors.dim, fontSize: 11, fontFamily: 'monospace' },
  selectedStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.panel,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
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
  sortRow: { flexDirection: 'row', gap: 6, marginBottom: 8 },
  sortBtn: {
    flex: 1,
    flexDirection: 'row',
    gap: 4,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sortBtnActive: { borderColor: colors.amber, backgroundColor: colors.amberDim },
  sortBtnText: { color: colors.dim, fontSize: 12 },
  sortBtnTextActive: { color: colors.amber, fontWeight: 'bold' },
  sortMenu: {
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    marginTop: -4,
    marginBottom: 8,
    overflow: 'hidden',
  },
  sortMenuRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  sortMenuRowText: { color: colors.text, fontSize: 13 },
  sortMenuRowTextActive: { color: colors.amber, fontWeight: '600' },
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
  chipTextArtist: { color: colors.amber, fontWeight: '600' },
  chipTextShow: { color: colors.link },
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
  soloToggle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  soloToggleActive: { borderColor: colors.amber },
  soloToggleDisabled: { opacity: 0.4 },
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
