import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { colors } from '../theme/colors';
import { getShowEntry, buildEpisodeCandidates, ShowEntry, EpisodeGroup } from '../api/sakugabooru';

export default function ShowDetailScreen({ route, navigation }: any) {
  const { showTag } = route.params as { showTag: string };
  const [entry, setEntry] = useState<ShowEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [relatedOpen, setRelatedOpen] = useState(false);
  const [jumpValue, setJumpValue] = useState('');

  useEffect(() => {
    navigation.setOptions({ title: showTag });
  }, [showTag]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getShowEntry(showTag)
      .then((e) => {
        if (!cancelled) setEntry(e);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'failed to load show');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [showTag]);

  const openEpisode = useCallback(
    (ep: EpisodeGroup) => {
      if (ep.token && ep.sortNum < 1e6) {
        // A numbered episode — try the exact text actually observed in the
        // sample first, then fall back through realistic alternate formats.
        navigation.navigate('EpisodeResults', {
          showTag,
          label: ep.label,
          mode: 'search',
          candidates: buildEpisodeCandidates(ep.sortNum, ep.token),
        });
      } else if (ep.token) {
        // OP/ED/Movie/OVA/PV — a fixed word, not a number, no fallback needed.
        navigation.navigate('EpisodeResults', {
          showTag,
          label: ep.label,
          mode: 'search',
          candidates: [ep.token],
        });
      } else {
        // No source text to search by at all — show whatever was already
        // sampled directly rather than attempting an impossible search.
        navigation.navigate('EpisodeResults', {
          showTag,
          label: ep.label,
          mode: 'sampled',
          posts: ep.posts,
        });
      }
    },
    [showTag, navigation]
  );

  const jumpToEpisode = useCallback(() => {
    const num = parseInt(jumpValue, 10);
    if (!num || num < 1) return;
    navigation.navigate('EpisodeResults', {
      showTag,
      label: `Episode ${num}`,
      mode: 'search',
      candidates: buildEpisodeCandidates(num),
    });
  }, [jumpValue, showTag, navigation]);

  const scanDeeper = useCallback(async () => {
    if (!entry) return;
    setScanning(true);
    try {
      const deeper = await getShowEntry(showTag, (entry.pagesFetched || 3) + 3);
      setEntry(deeper);
    } catch (err: any) {
      setError(err.message || 'failed to scan further');
    } finally {
      setScanning(false);
    }
  }, [entry, showTag]);

  if (loading) {
    return (
      <View style={styles.centerFill}>
        <ActivityIndicator color={colors.amber} />
      </View>
    );
  }
  if (error) {
    return (
      <View style={styles.centerFill}>
        <Text style={styles.error}>error: {error}</Text>
      </View>
    );
  }
  if (!entry || entry.totalSampled === 0) {
    return (
      <View style={styles.centerFill}>
        <Text style={styles.empty}>no posts sampled for "{showTag}"</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.headRow}>
        {entry.related.length > 0 && (
          <TouchableOpacity style={styles.miniToggle} onPress={() => setRelatedOpen((o) => !o)}>
            <Text style={styles.miniToggleText}>
              related ({entry.related.length}) {relatedOpen ? '▴' : '▾'}
            </Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.miniToggle} onPress={() => setInfoOpen((o) => !o)}>
          <Text style={styles.miniToggleText}>ⓘ how this works</Text>
        </TouchableOpacity>
      </View>

      {relatedOpen && entry.related.length > 0 && (
        <View style={styles.chipRow}>
          {entry.related.map((r) => (
            <TouchableOpacity
              key={r.name}
              style={styles.relatedChip}
              onPress={() => navigation.push('ShowDetail', { showTag: r.name })}
            >
              <Text style={styles.relatedChipText}>
                {r.name} ({r.count})
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {infoOpen && (
        <Text style={styles.info}>
          Episode grouping below is parsed from each post's source text (the "Title #12" convention),
          sampled from the {entry.totalSampled} most <Text style={styles.bold}>recently tagged</Text>{' '}
          posts — not chronological by episode, so which numbers show up is down to tagging activity,
          not air order. Anything that isn't a recognizable episode/OP/ED/movie marker gets grouped into
          one "Other" bucket. For a specific known episode, use the jump box below — it searches directly
          rather than relying on this sample.
        </Text>
      )}

      <View style={styles.jumpRow}>
        <TextInput
          style={styles.input}
          placeholder="know the episode number? jump to it, e.g. 1000"
          placeholderTextColor={colors.dim}
          value={jumpValue}
          onChangeText={setJumpValue}
          onSubmitEditing={jumpToEpisode}
          keyboardType="number-pad"
          returnKeyType="go"
        />
        <TouchableOpacity style={styles.goBtn} onPress={jumpToEpisode}>
          <Text style={styles.goBtnText}>Go</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.epGrid}>
        {entry.episodes.map((ep) => (
          <TouchableOpacity key={ep.key} style={styles.epCard} onPress={() => openEpisode(ep)}>
            <Text style={styles.epLabel}>{ep.label}</Text>
            <Text style={styles.epCount}>{ep.count} sampled</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.scanWrap}>
        {entry.exhausted ? (
          <Text style={styles.info}>sampled this show's entire post history — nothing more to scan</Text>
        ) : (
          <TouchableOpacity style={styles.scanBtn} onPress={scanDeeper} disabled={scanning}>
            {scanning ? (
              <ActivityIndicator color={colors.amber} />
            ) : (
              <Text style={styles.scanBtnText}>scan further back (+300 more posts, currently {entry.totalSampled})</Text>
            )}
          </TouchableOpacity>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: 12 },
  centerFill: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  error: { color: colors.red, textAlign: 'center', paddingHorizontal: 24 },
  empty: { color: colors.dim, textAlign: 'center', paddingHorizontal: 24 },
  headRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
    marginBottom: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  miniToggle: {
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  miniToggleText: { color: colors.dim, fontSize: 11 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  relatedChip: {
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  relatedChipText: { color: colors.text, fontSize: 11 },
  info: { color: colors.dim, fontSize: 12, lineHeight: 18, marginBottom: 12 },
  bold: { color: colors.text, fontWeight: 'bold' },
  jumpRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
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
  goBtn: {
    backgroundColor: colors.amberDim,
    borderWidth: 1,
    borderColor: colors.amber,
    borderRadius: 6,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  goBtnText: { color: colors.amber, fontWeight: 'bold', fontSize: 12 },
  epGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  epCard: {
    width: '31%',
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 6,
    paddingVertical: 12,
    alignItems: 'center',
  },
  epLabel: { color: colors.amber, fontWeight: 'bold', fontSize: 12, textAlign: 'center' },
  epCount: { color: colors.dim, fontSize: 10, marginTop: 3 },
  scanWrap: { marginTop: 18, marginBottom: 24, alignItems: 'center' },
  scanBtn: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 6,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  scanBtnText: { color: colors.dim, fontSize: 11, textAlign: 'center' },
});
