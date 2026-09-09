import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
  Modal,
  Image,
  ScrollView,
  TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { getLocalPool, deleteLocalPool, removePostFromLocalPool, LocalPool } from '../api/localPools';
import { Post, isVideoFile } from '../api/sakugabooru';
import { onScoreChanged } from '../api/voteEvents';
import {
  exportPoolAsGrid,
  previewGridLayout,
  parseTimeInput,
  formatTimeInput,
  MAX_GRID_CLIPS,
  GridOrientation,
  GridMode,
  TrimRange,
} from '../api/gridExport';
import { onGridRangePicked } from '../api/gridTrimEvents';
import { useVideoPlayer, VideoView } from 'expo-video';
import { shareResult, saveToGallery, trimLocalFile } from '../api/trim';
import PostCard from '../components/PostCard';
import { Ionicons } from '@expo/vector-icons';

export default function LocalPoolDetailScreen({ route, navigation }: any) {
  const { poolId } = route.params as { poolId: string };
  const insets = useSafeAreaInsets();

  const [pool, setPool] = useState<LocalPool | null>(null);
  const [loading, setLoading] = useState(true);
  const [descriptionOpen, setDescriptionOpen] = useState(false);

  // A vote cast in ViewerScreen doesn't touch this list on its own — without
  // this, backing out of a clip you just rated kept showing its old score
  // until the pool was reopened. Local pools are documented as frozen
  // snapshots in storage (score etc. won't stay live-updated there by
  // design), so this only refreshes the in-memory display for this session,
  // not the stored pool itself.
  useEffect(() => {
    return onScoreChanged((postId, newScore) => {
      setPool((prev) =>
        prev ? { ...prev, posts: prev.posts.map((p) => (p.id === postId ? { ...p, score: newScore } : p)) } : prev
      );
    });
  }, []);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const handleSelectCard = useCallback((id: number) => setSelectedId(id), []);
  const handleOpenCard = useCallback(
    (post: Post) => {
      setSelectedId(null);
      navigation.navigate('Viewer', { post });
    },
    [navigation]
  );
  useEffect(() => {
    const unsubscribe = navigation.addListener('blur', () => setSelectedId(null));
    return unsubscribe;
  }, [navigation]);
  const selectedPost = selectedId !== null ? pool?.posts.find((p) => p.id === selectedId) || null : null;

  const load = useCallback(async () => {
    setLoading(true);
    const data = await getLocalPool(poolId);
    setPool(data);
    navigation.setOptions({ title: data?.name || 'Pool' });
    setLoading(false);
  }, [poolId, navigation]);

  useEffect(() => {
    load();
  }, [load]);

  const doRemoveSelected = useCallback(async () => {
    if (!selectedPost) return;
    await removePostFromLocalPool(poolId, selectedPost.id);
    setPool((prev) => (prev ? { ...prev, posts: prev.posts.filter((p) => p.id !== selectedPost.id) } : prev));
    setSelectedId(null);
  }, [selectedPost, poolId]);

  const doDeletePool = useCallback(() => {
    Alert.alert('Delete Pool', `Delete "${pool?.name}"? This can't be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteLocalPool(poolId);
          navigation.goBack();
        },
      },
    ]);
  }, [poolId, pool, navigation]);

  // ---------- grid export ----------
  const [exportModalVisible, setExportModalVisible] = useState(false);
  const [exportOrientation, setExportOrientation] = useState<GridOrientation>('landscape');
  const [customGrid, setCustomGrid] = useState(false);
  const [exportMode, setExportMode] = useState<GridMode>('center');
  const [exportClipOrder, setExportClipOrder] = useState<Post[]>([]);
  const [advancedOptions, setAdvancedOptions] = useState(false);
  const [exportTrims, setExportTrims] = useState<Record<number, TrimRange>>({});
  const [trimInputs, setTrimInputs] = useState<Record<number, { start: string; end: string }>>({});
  const [exporting, setExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState('');
  const [exportResult, setExportResult] = useState<{ uri: string; filename: string } | null>(null);

  // ---------- preview + optional trim of the generated grid itself ----------
  // Lets the person watch the actual result and decide how much of it to
  // keep, rather than guessing a target length before ever seeing it.
  const resultPlayer = useVideoPlayer(exportResult?.uri || null, (p) => {
    p.loop = true;
  });
  const [resultCurrentTime, setResultCurrentTime] = useState(0);
  const [resultDuration, setResultDuration] = useState(0);
  const [resultMarkIn, setResultMarkIn] = useState<number | null>(null);
  const [resultMarkOut, setResultMarkOut] = useState<number | null>(null);
  const [resultAccurateTrim, setResultAccurateTrim] = useState(false);
  const [trimmingResult, setTrimmingResult] = useState(false);
  const [resultTrimStatus, setResultTrimStatus] = useState<string | null>(null);
  const [trimmedResult, setTrimmedResult] = useState<{ uri: string; filename: string } | null>(null);
  const hasResultTrimRange = resultMarkIn !== null && resultMarkOut !== null && resultMarkOut > resultMarkIn;

  useEffect(() => {
    // Fresh marks/trimmed-result state for each new export — not leftover
    // from a previous run's preview.
    setResultMarkIn(null);
    setResultMarkOut(null);
    setTrimmedResult(null);
    setResultTrimStatus(null);
  }, [exportResult?.uri]);

  // Same polling approach as ViewerScreen's own player — expo-video doesn't
  // guarantee a fine-grained timeupdate event across platforms.
  useEffect(() => {
    if (!exportResult) return;
    const interval = setInterval(() => {
      setResultCurrentTime(resultPlayer.currentTime || 0);
      setResultDuration(resultPlayer.duration || 0);
    }, 100);
    return () => clearInterval(interval);
  }, [exportResult, resultPlayer]);

  const trimResult = useCallback(async () => {
    if (!exportResult || !hasResultTrimRange || resultMarkIn === null || resultMarkOut === null) return;
    setTrimmingResult(true);
    setResultTrimStatus(null);
    try {
      const result = await trimLocalFile(
        exportResult.uri,
        pool?.name || 'sakuga_grid',
        resultMarkIn,
        resultMarkOut,
        resultAccurateTrim,
        setResultTrimStatus
      );
      setTrimmedResult({ uri: result.uri, filename: result.filename });
      setResultTrimStatus(`done in ${result.seconds.toFixed(1)}s`);
    } catch (e: any) {
      Alert.alert('Trim failed', e?.message || 'unknown error');
      setResultTrimStatus(null);
    } finally {
      setTrimmingResult(false);
    }
  }, [exportResult, hasResultTrimRange, resultMarkIn, resultMarkOut, resultAccurateTrim, pool]);


  // Only meaningful while the export modal is actually open — ViewerScreen
  // emits this after "Use This Range" regardless of who's listening, so this
  // effect is scoped to exportModalVisible to avoid updating trims for a
  // clip picked before the modal was even reopened for a new session.
  useEffect(() => {
    if (!exportModalVisible) return;
    return onGridRangePicked((postId, start, end) => {
      setExportTrims((prev) => ({ ...prev, [postId]: { start, end } }));
      setTrimInputs((prev) => ({ ...prev, [postId]: { start: formatTimeInput(start), end: formatTimeInput(end) } }));
    });
  }, [exportModalVisible]);

  const openExportModal = useCallback(() => {
    const videoPosts = (pool?.posts || []).filter((p) => isVideoFile(p.file_url));
    if (videoPosts.length < 2) {
      Alert.alert('Not enough clips', 'Need at least 2 video clips in this pool to export a grid.');
      return;
    }
    setExportClipOrder(videoPosts.slice(0, MAX_GRID_CLIPS));
    setExportOrientation('landscape');
    setCustomGrid(false);
    setExportMode('center');
    setAdvancedOptions(false);
    setExportTrims({});
    setTrimInputs({});
    setExportResult(null);
    setExportStatus('');
    setExportModalVisible(true);
  }, [pool]);

  const toggleCustomGrid = useCallback((on: boolean) => {
    setCustomGrid(on);
    if (!on) {
      // Back to the plain default — not whatever was left over from
      // fiddling with custom settings a moment ago.
      setExportMode('center');
    }
  }, []);

  const toggleAdvancedOptions = useCallback((on: boolean) => {
    setAdvancedOptions(on);
    if (!on) {
      setExportTrims({});
      setTrimInputs({});
    }
  }, []);

  const setRangeForClip = useCallback((post: Post) => {
    navigation.navigate('Viewer', { post, forGridTrim: true });
  }, [navigation]);

  const commitManualTrim = useCallback((postId: number, startStr: string, endStr: string) => {
    const start = parseTimeInput(startStr);
    const end = parseTimeInput(endStr);
    if (start == null && end == null) {
      setExportTrims((prev) => {
        const next = { ...prev };
        delete next[postId];
        return next;
      });
      return;
    }
    const realStart = start || 0;
    if (end == null || end <= realStart) {
      setExportTrims((prev) => {
        const next = { ...prev };
        delete next[postId];
        return next;
      });
      return;
    }
    setExportTrims((prev) => ({ ...prev, [postId]: { start: realStart, end } }));
  }, []);

  const clearTrim = useCallback((postId: number) => {
    setExportTrims((prev) => {
      const next = { ...prev };
      delete next[postId];
      return next;
    });
    setTrimInputs((prev) => {
      const next = { ...prev };
      delete next[postId];
      return next;
    });
  }, []);

  const moveClip = useCallback((index: number, direction: -1 | 1) => {
    setExportClipOrder((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = prev.slice();
      const tmp = next[index];
      next[index] = next[target];
      next[target] = tmp;
      return next;
    });
  }, []);

  const preview = useMemo(
    () => previewGridLayout(exportClipOrder.length, exportOrientation, exportMode),
    [exportClipOrder.length, exportOrientation, exportMode]
  );

  const startExport = useCallback(async () => {
    setExporting(true);
    setExportResult(null);
    try {
      const result = await exportPoolAsGrid(exportClipOrder, exportOrientation, exportMode, exportTrims, setExportStatus);
      setExportResult({ uri: result.uri, filename: result.filename });
      setExportStatus(`done in ${result.seconds.toFixed(1)}s`);
    } catch (e: any) {
      Alert.alert('Export failed', e?.message || 'unknown error');
      setExportStatus('');
    } finally {
      setExporting(false);
    }
  }, [exportClipOrder, exportOrientation, exportMode, exportTrims]);

  return (
    <View style={styles.container}>
      {loading && (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.amber} />
        </View>
      )}

      {pool && !loading && (
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <Text style={styles.postCount}>
              {pool.posts.length} clip{pool.posts.length === 1 ? '' : 's'}
            </Text>
            <TouchableOpacity onPress={openExportModal} style={styles.exportBtn}>
              <Ionicons name="grid-outline" size={14} color={colors.amber} />
              <Text style={styles.exportBtnText}>Export as Grid</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={doDeletePool} style={styles.deleteBtn}>
              <Ionicons name="trash-outline" size={16} color={colors.red} />
            </TouchableOpacity>
          </View>
          {!!pool.description && (
            <TouchableOpacity style={styles.descriptionToggle} onPress={() => setDescriptionOpen((o) => !o)}>
              <Ionicons name={descriptionOpen ? 'chevron-up' : 'chevron-down'} size={13} color={colors.dim} />
              <Text style={styles.descriptionToggleText}> description</Text>
            </TouchableOpacity>
          )}
          {!!pool.description && descriptionOpen && <Text style={styles.description}>{pool.description}</Text>}
        </View>
      )}

      {selectedPost && (
        <View style={styles.selectedStrip}>
          <View style={{ flex: 1 }}>
            <Text style={styles.selectedStripText} numberOfLines={2}>
              {selectedPost.tags}
            </Text>
          </View>
          <TouchableOpacity onPress={doRemoveSelected} style={styles.removeBtn}>
            <Ionicons name="remove-circle-outline" size={20} color={colors.red} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setSelectedId(null)}
            style={styles.selectedStripClose}
            hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
          >
            <Ionicons name="close" size={18} color={colors.text} />
          </TouchableOpacity>
        </View>
      )}

      {pool && !loading && (
        <FlatList
          data={pool.posts}
          keyExtractor={(p) => String(p.id)}
          numColumns={3}
          columnWrapperStyle={{ gap: 6 }}
          contentContainerStyle={{ gap: 6, padding: 12 }}
          initialNumToRender={12}
          maxToRenderPerBatch={9}
          windowSize={5}
          updateCellsBatchingPeriod={50}
          ListEmptyComponent={<Text style={styles.empty}>No clips in this pool yet.</Text>}
          renderItem={({ item }) => (
            <PostCard post={item} selected={selectedId === item.id} onSelect={handleSelectCard} onOpen={handleOpenCard} />
          )}
        />
      )}

      <Modal visible={exportModalVisible} animationType="slide" transparent onRequestClose={() => setExportModalVisible(false)}>
        <View style={modalStyles.backdrop}>
          <View style={modalStyles.sheet}>
            <ScrollView contentContainerStyle={{ paddingBottom: 8 + insets.bottom }}>
              <Text style={modalStyles.title}>Export as Grid Video</Text>

              <Text style={modalStyles.label}>Orientation</Text>
              <View style={modalStyles.toggleRow}>
                <TouchableOpacity
                  style={[modalStyles.toggleBtn, exportOrientation === 'landscape' && modalStyles.toggleBtnActive]}
                  onPress={() => setExportOrientation('landscape')}
                >
                  <Text style={[modalStyles.toggleText, exportOrientation === 'landscape' && modalStyles.toggleTextActive]}>
                    Landscape
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[modalStyles.toggleBtn, exportOrientation === 'portrait' && modalStyles.toggleBtnActive]}
                  onPress={() => setExportOrientation('portrait')}
                >
                  <Text style={[modalStyles.toggleText, exportOrientation === 'portrait' && modalStyles.toggleTextActive]}>
                    Portrait
                  </Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity style={modalStyles.checkboxRow} onPress={() => toggleCustomGrid(!customGrid)}>
                <Ionicons
                  name={customGrid ? 'checkbox' : 'square-outline'}
                  size={18}
                  color={customGrid ? colors.amber : colors.dim}
                />
                <Text style={modalStyles.checkboxLabel}>Custom grid</Text>
              </TouchableOpacity>
              <TouchableOpacity style={modalStyles.checkboxRow} onPress={() => toggleAdvancedOptions(!advancedOptions)}>
                <Ionicons
                  name={advancedOptions ? 'checkbox' : 'square-outline'}
                  size={18}
                  color={advancedOptions ? colors.amber : colors.dim}
                />
                <Text style={modalStyles.checkboxLabel}>Advanced options</Text>
              </TouchableOpacity>

              {customGrid && (
                <>
                  <Text style={modalStyles.label}>Mode</Text>
                  <View style={modalStyles.toggleRow}>
                    <TouchableOpacity
                      style={[modalStyles.toggleBtn, exportMode === 'center' && modalStyles.toggleBtnActive]}
                      onPress={() => setExportMode('center')}
                    >
                      <Text style={[modalStyles.toggleText, exportMode === 'center' && modalStyles.toggleTextActive]}>
                        Center leftover
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[modalStyles.toggleBtn, exportMode === 'stretch' && modalStyles.toggleBtnActive]}
                      onPress={() => setExportMode('stretch')}
                    >
                      <Text style={[modalStyles.toggleText, exportMode === 'stretch' && modalStyles.toggleTextActive]}>
                        Featured clip
                      </Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}

              {advancedOptions && (
                <Text style={modalStyles.hintText}>
                  each trimmed clip costs an extra encode pass before compositing — slower with more of them.
                </Text>
              )}

              {(customGrid || advancedOptions) && (
                <>
                  <Text style={modalStyles.label}>
                    {customGrid
                      ? 'Order — first clip is featured above the rest if that mode is on:'
                      : 'Per-clip trim range:'}
                  </Text>
                  {exportClipOrder.map((p, i) => {
                    const trim = exportTrims[p.id];
                    const inputs = trimInputs[p.id] || { start: '', end: '' };
                    return (
                      <View key={p.id} style={modalStyles.orderRow}>
                        <Image source={{ uri: p.preview_url }} style={modalStyles.orderThumb} />
                        <Text style={modalStyles.orderLabel} numberOfLines={1}>
                          {i + 1}. {p.tags.split(/\s+/).slice(0, 3).join(' ')}
                        </Text>
                        {advancedOptions && (
                          <>
                            <TouchableOpacity onPress={() => setRangeForClip(p)}>
                              <Text style={modalStyles.setRangeText}>set range</Text>
                            </TouchableOpacity>
                            <TextInput
                              style={modalStyles.trimInput}
                              placeholder="start"
                              placeholderTextColor={colors.dim}
                              value={inputs.start}
                              onChangeText={(v) => setTrimInputs((prev) => ({ ...prev, [p.id]: { start: v, end: prev[p.id]?.end || '' } }))}
                              onEndEditing={() => commitManualTrim(p.id, inputs.start, inputs.end)}
                            />
                            <Text style={modalStyles.trimDash}>–</Text>
                            <TextInput
                              style={modalStyles.trimInput}
                              placeholder="end"
                              placeholderTextColor={colors.dim}
                              value={inputs.end}
                              onChangeText={(v) => setTrimInputs((prev) => ({ ...prev, [p.id]: { start: prev[p.id]?.start || '', end: v } }))}
                              onEndEditing={() => commitManualTrim(p.id, inputs.start, inputs.end)}
                            />
                            {trim && (
                              <TouchableOpacity onPress={() => clearTrim(p.id)}>
                                <Ionicons name="close" size={14} color={colors.dim} />
                              </TouchableOpacity>
                            )}
                          </>
                        )}
                        {customGrid && (
                          <>
                            <TouchableOpacity disabled={i === 0} onPress={() => moveClip(i, -1)} style={modalStyles.orderBtn}>
                              <Ionicons name="chevron-up" size={16} color={i === 0 ? colors.line : colors.dim} />
                            </TouchableOpacity>
                            <TouchableOpacity
                              disabled={i === exportClipOrder.length - 1}
                              onPress={() => moveClip(i, 1)}
                              style={modalStyles.orderBtn}
                            >
                              <Ionicons
                                name="chevron-down"
                                size={16}
                                color={i === exportClipOrder.length - 1 ? colors.line : colors.dim}
                              />
                            </TouchableOpacity>
                          </>
                        )}
                      </View>
                    );
                  })}
                </>
              )}

              <Text style={modalStyles.previewText}>
                {preview.clipCount} clips → {preview.layoutLabel}
              </Text>

              {!!exportStatus && (
                <View style={modalStyles.statusRow}>
                  {exporting && <ActivityIndicator size="small" color={colors.amber} style={{ marginRight: 6 }} />}
                  <Text style={modalStyles.statusText}>{exportStatus}</Text>
                </View>
              )}

              {exportResult && !exporting && (
                <View style={modalStyles.previewSection}>
                  <VideoView
                    style={modalStyles.previewVideo}
                    player={resultPlayer}
                    contentFit="contain"
                    nativeControls
                  />
                  <Text style={modalStyles.previewTime}>
                    {formatTimeInput(resultCurrentTime)} / {formatTimeInput(resultDuration)}
                  </Text>

                  <Text style={modalStyles.hintText}>
                    optional: mark a start/end below to trim the exported grid itself before sharing/saving.
                  </Text>
                  <View style={modalStyles.trimMarkRow}>
                    <TouchableOpacity style={modalStyles.smallBtn} onPress={() => setResultMarkIn(resultCurrentTime)}>
                      <Text style={modalStyles.smallBtnText}>Mark In</Text>
                    </TouchableOpacity>
                    <Text style={modalStyles.trimDash}>in: {resultMarkIn !== null ? formatTimeInput(resultMarkIn) : '—'}</Text>
                    <TouchableOpacity style={modalStyles.smallBtn} onPress={() => setResultMarkOut(resultCurrentTime)}>
                      <Text style={modalStyles.smallBtnText}>Mark Out</Text>
                    </TouchableOpacity>
                    <Text style={modalStyles.trimDash}>out: {resultMarkOut !== null ? formatTimeInput(resultMarkOut) : '—'}</Text>
                    {(resultMarkIn !== null || resultMarkOut !== null) && (
                      <TouchableOpacity
                        onPress={() => {
                          setResultMarkIn(null);
                          setResultMarkOut(null);
                        }}
                      >
                        <Ionicons name="close" size={14} color={colors.dim} />
                      </TouchableOpacity>
                    )}
                  </View>

                  <TouchableOpacity style={modalStyles.checkboxRow} onPress={() => setResultAccurateTrim((a) => !a)}>
                    <Ionicons
                      name={resultAccurateTrim ? 'checkbox' : 'square-outline'}
                      size={16}
                      color={resultAccurateTrim ? colors.amber : colors.dim}
                    />
                    <Text style={modalStyles.checkboxLabel}>frame-accurate (slower, more exact)</Text>
                  </TouchableOpacity>

                  <View style={modalStyles.resultRow}>
                    <TouchableOpacity style={modalStyles.resultBtn} onPress={() => shareResult(exportResult.uri)}>
                      <Ionicons name="share-outline" size={16} color={colors.amber} />
                      <Text style={modalStyles.resultBtnText}>Share Full</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={modalStyles.resultBtn}
                      onPress={async () => {
                        try {
                          await saveToGallery(exportResult.uri);
                          Alert.alert('Saved', 'Grid video saved to your gallery.');
                        } catch (e: any) {
                          Alert.alert('Save failed', e?.message || 'unknown error');
                        }
                      }}
                    >
                      <Ionicons name="download-outline" size={16} color={colors.amber} />
                      <Text style={modalStyles.resultBtnText}>Save Full</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[modalStyles.resultBtn, !hasResultTrimRange && modalStyles.resultBtnDisabled]}
                      disabled={!hasResultTrimRange || trimmingResult}
                      onPress={trimResult}
                    >
                      {trimmingResult ? (
                        <ActivityIndicator size="small" color={colors.amber} />
                      ) : (
                        <>
                          <Ionicons name="cut-outline" size={16} color={colors.amber} />
                          <Text style={modalStyles.resultBtnText}>Trim</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                  {!!resultTrimStatus && <Text style={modalStyles.statusText}>{resultTrimStatus}</Text>}

                  {trimmedResult && !trimmingResult && (
                    <View style={modalStyles.resultRow}>
                      <TouchableOpacity style={modalStyles.resultBtn} onPress={() => shareResult(trimmedResult.uri)}>
                        <Ionicons name="share-outline" size={16} color={colors.amber} />
                        <Text style={modalStyles.resultBtnText}>Share Trim</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={modalStyles.resultBtn}
                        onPress={async () => {
                          try {
                            await saveToGallery(trimmedResult.uri);
                            Alert.alert('Saved', 'Trimmed grid video saved to your gallery.');
                          } catch (e: any) {
                            Alert.alert('Save failed', e?.message || 'unknown error');
                          }
                        }}
                      >
                        <Ionicons name="download-outline" size={16} color={colors.amber} />
                        <Text style={modalStyles.resultBtnText}>Save Trim</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              )}

              <View style={modalStyles.actionRow}>
                <TouchableOpacity
                  style={[modalStyles.startBtn, exporting && { opacity: 0.5 }]}
                  disabled={exporting}
                  onPress={startExport}
                >
                  {exporting ? (
                    <ActivityIndicator size="small" color={colors.bg} />
                  ) : (
                    <Text style={modalStyles.startBtnText}>Start Export</Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={modalStyles.cancelBtn}
                  onPress={() => setExportModalVisible(false)}
                  disabled={exporting}
                >
                  <Text style={modalStyles.cancelBtnText}>Close</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  loadingWrap: { marginTop: 40, alignItems: 'center' },
  header: { padding: 12, borderBottomWidth: 1, borderBottomColor: colors.line },
  headerTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  postCount: { color: colors.dim, fontSize: 11 },
  deleteBtn: { marginLeft: 'auto', padding: 4 },
  exportBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: colors.line, borderRadius: 5, paddingHorizontal: 8, paddingVertical: 4 },
  exportBtnText: { color: colors.amber, fontSize: 11 },
  description: { color: colors.text, fontSize: 12, marginTop: 8, lineHeight: 17 },
  descriptionToggle: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  descriptionToggleText: { color: colors.dim, fontSize: 11 },
  selectedStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.panel,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginHorizontal: 12,
    marginTop: 8,
    gap: 8,
  },
  selectedStripText: { color: colors.dim, fontSize: 11, lineHeight: 15 },
  removeBtn: { padding: 4 },
  selectedStripClose: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.panel2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: { color: colors.dim, textAlign: 'center', marginTop: 24, paddingHorizontal: 24 },
});

const modalStyles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.panel, borderTopLeftRadius: 14, borderTopRightRadius: 14, padding: 16, maxHeight: '85%' },
  title: { color: colors.text, fontSize: 15, fontWeight: 'bold', marginBottom: 14 },
  label: { color: colors.dim, fontSize: 11, marginTop: 10, marginBottom: 6 },
  hintText: { color: colors.dim, fontSize: 11, marginTop: 8 },
  setRangeText: { color: colors.amber, fontSize: 11 },
  trimInput: {
    width: 42,
    fontSize: 11,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  trimDash: { color: colors.dim, fontSize: 11 },
  toggleRow: { flexDirection: 'row', gap: 8 },
  toggleBtn: { flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: 6, paddingVertical: 8, alignItems: 'center' },
  toggleBtnActive: { borderColor: colors.amber, backgroundColor: colors.panel2 },
  toggleText: { color: colors.dim, fontSize: 12, fontWeight: '600' },
  toggleTextActive: { color: colors.amber },
  checkboxRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 },
  checkboxLabel: { color: colors.text, fontSize: 12, flexShrink: 1 },
  orderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 5,
    padding: 6,
    marginBottom: 6,
  },
  orderThumb: { width: 40, height: 22, borderRadius: 3, backgroundColor: colors.bg },
  orderLabel: { flex: 1, color: colors.text, fontSize: 11 },
  orderBtn: { padding: 4 },
  previewText: { color: colors.dim, fontSize: 12, marginTop: 12, textAlign: 'center' },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  statusText: { color: colors.amber, fontSize: 12 },
  resultRow: { flexDirection: 'row', gap: 10, marginTop: 12, justifyContent: 'center' },
  resultBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.amber,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  resultBtnText: { color: colors.amber, fontSize: 12, fontWeight: '600' },
  resultBtnDisabled: { borderColor: colors.line, opacity: 0.5 },
  previewSection: { marginTop: 12 },
  previewVideo: { width: '100%', height: 180, backgroundColor: colors.bg, borderRadius: 6 },
  previewTime: { color: colors.dim, fontSize: 11, textAlign: 'center', marginTop: 4 },
  trimMarkRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' },
  smallBtn: { borderWidth: 1, borderColor: colors.line, borderRadius: 5, paddingHorizontal: 8, paddingVertical: 4 },
  smallBtnText: { color: colors.text, fontSize: 11 },
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  startBtn: { flex: 1, backgroundColor: colors.amber, borderRadius: 6, paddingVertical: 12, alignItems: 'center' },
  startBtnText: { color: colors.bg, fontSize: 13, fontWeight: 'bold' },
  cancelBtn: { paddingHorizontal: 16, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  cancelBtnText: { color: colors.dim, fontSize: 13 },
});
