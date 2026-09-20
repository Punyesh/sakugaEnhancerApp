import { File, Paths } from 'expo-file-system';
import { isValidFile, exportGrid as nativeExportGrid } from 'react-native-video-trim';
import { Post, isVideoFile, getTagTypeMap } from './sakugabooru';

export type GridOrientation = 'landscape' | 'portrait';
export type GridMode = 'center' | 'stretch';
export type GridFormat = 'grid' | 'serial';
export type LoopMode = 'replay' | 'stop';
export type LabelMode = 'off' | 'left' | 'right';
export type LabelStyle = 'outline' | 'box';

// Capitalizes each word of an auto-detected animator name (tag names are
// plain lowercase with underscores, e.g. "yutaka_nakamura" — there's no
// real capitalization in the source to preserve). Never applied to a
// person's own custom label text, which is used verbatim — that's
// hand-authored, and forcing a casing convention on it would be
// presumptuous, unlike a raw tag name that never had any intentional
// casing to begin with. Ported 1:1 from the bookmarklet.
export function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

export const MAX_GRID_CLIPS = 9;
const GRID_CELL_W = 480;
const GRID_CELL_H = 270;
// Serial export shows one clip at a time, not a grid of small cells, so it
// can afford a noticeably bigger single frame for the same encode budget —
// double the grid cell's own linear size, still 16:9. Matches the
// bookmarklet's SERIAL_LONG/SERIAL_SHORT exactly.
const SERIAL_LONG = 960;
const SERIAL_SHORT = 540;

interface GridLayout {
  cols: number;
  rows: number;
}

interface CellPosition {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Ported 1:1 from the bookmarklet version of this feature, where this exact
// scoring was verified directly (every clip count 2-9 checked by hand, plus
// the degenerate-strip bug it was written to avoid — a prime clip count like
// 5 or 7 technically fits a 1xN "grid" with zero empty cells, but that's a
// strip, not a grid, so single-row/column layouts are excluded once there
// are enough clips to actually form one.
export function computeGridLayout(n: number, orientation: GridOrientation): GridLayout {
  const targetAspect = orientation === 'portrait' ? 9 / 16 : 16 / 9;
  let best: { cols: number; rows: number; score: number } | null = null;
  for (let rows = 1; rows <= n; rows++) {
    const cols = Math.ceil(n / rows);
    if (n > 3 && (cols === 1 || rows === 1)) continue;
    const aspect = cols / rows;
    const aspectDiff = Math.abs(aspect - targetAspect);
    const lastRowCount = n - cols * (rows - 1);
    const sparseness = (cols - lastRowCount) / cols; // 0 = last row full, near 1 = last row nearly empty
    const score = aspectDiff + sparseness * 2;
    if (!best || score < best.score) best = { cols, rows, score };
  }
  if (!best) best = orientation === 'portrait' ? { cols: 1, rows: n, score: 0 } : { cols: n, rows: 1, score: 0 };
  return { cols: best.cols, rows: best.rows };
}

// Also ported 1:1 from the bookmarklet — verified there against real ffmpeg
// output (pixel-sampled and visually inspected) for both modes, including
// the recursive 'stretch' case where the leftover n-1 clips can themselves
// need centering (e.g. 6 clips: featured clip above a 5-clip grid, and
// those 5 correctly self-center their own short row).
export function computeCellPositions(n: number, orientation: GridOrientation, mode: GridMode): CellPosition[] {
  if (mode === 'stretch' && n >= 3) {
    const restN = n - 1;
    const restLayout = computeGridLayout(restN, orientation);
    const restPositions = computeCellPositions(restN, orientation, 'center');
    const heroW = restLayout.cols * GRID_CELL_W;
    const heroH = Math.round((heroW * 9) / 16);
    const positions: CellPosition[] = new Array(n);
    positions[0] = { x: 0, y: 0, w: heroW, h: heroH };
    for (let i = 0; i < restPositions.length; i++) {
      positions[i + 1] = { x: restPositions[i].x, y: restPositions[i].y + heroH, w: restPositions[i].w, h: restPositions[i].h };
    }
    return positions;
  }

  const layout = computeGridLayout(n, orientation);
  const { cols, rows } = layout;
  const out: CellPosition[] = new Array(n);
  let idx = 0;
  for (let row = 0; row < rows; row++) {
    const itemsInRow = Math.min(cols, n - idx);
    const rowOffset = Math.floor(((cols - itemsInRow) * GRID_CELL_W) / 2);
    for (let col = 0; col < itemsInRow; col++) {
      out[idx] = { x: rowOffset + col * GRID_CELL_W, y: row * GRID_CELL_H, w: GRID_CELL_W, h: GRID_CELL_H };
      idx++;
    }
  }
  return out;
}

export interface GridPreview {
  clipCount: number;
  layoutLabel: string; // e.g. "3 × 2 grid" or "featured clip above a 2 × 2 grid"
}

export function previewGridLayout(clipCount: number, orientation: GridOrientation, mode: GridMode, format: GridFormat = 'grid'): GridPreview {
  if (format === 'serial') {
    return { clipCount, layoutLabel: 'played back-to-back, one after another' };
  }
  if (mode === 'stretch' && clipCount >= 3) {
    const restLayout = computeGridLayout(clipCount - 1, orientation);
    return { clipCount, layoutLabel: `featured clip above a ${restLayout.cols} × ${restLayout.rows} grid` };
  }
  const layout = computeGridLayout(clipCount, orientation);
  return { clipCount, layoutLabel: `${layout.cols} × ${layout.rows} grid` };
}

export interface TrimRange {
  start: number; // seconds
  end: number; // seconds
}

// Accepts either plain seconds ("7.5") or MM:SS ("1:23") for the advanced
// per-clip trim inputs — same flexible parsing as the bookmarklet's version.
export function parseTimeInput(str: string): number | null {
  const s = (str || '').trim();
  if (!s) return null;
  if (s.indexOf(':') !== -1) {
    const parts = s.split(':');
    const mins = parseInt(parts[0], 10);
    const secs = parseFloat(parts[1]);
    if (isNaN(mins) || isNaN(secs)) return null;
    return mins * 60 + secs;
  }
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

export function formatTimeInput(seconds: number | null | undefined): string {
  if (seconds == null || isNaN(seconds)) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export interface GridExportResult {
  uri: string;
  filename: string;
  seconds: number;
}

/**
 * Downloads each clip locally (exportGrid, like trim, only accepts local
 * paths — this FFmpegKit build has no OpenSSL, so remote URLs don't work),
 * probes durations via the existing isValidFile() native method (headless,
 * no React hook needed — expo-video's duration reading is hook-based and
 * can't be called in a loop outside a component), computes positions, and
 * calls the native exportGrid.
 *
 * `trims` (keyed by post id) mirrors the bookmarklet's advanced per-clip
 * trim: a clip's sub-range becomes what actually gets used for both the
 * composited box AND the auto target-duration/looping calculation — a
 * trimmed-down clip loops its own trimmed length, not its full natural one.
 * The native side does the actual extraction (see the react-native-video-trim
 * patch's exportGrid: extract the sub-range to its own file first, then loop
 * that file — combining a loop with input-side seeking on the same source
 * doesn't repeat just the selected segment, confirmed directly against real
 * ffmpeg in the bookmarklet version of this feature).
 *
 * NOTE: exportGrid itself is new native code (see the react-native-video-trim
 * patch) that could not be built/run in the environment this was written in
 * — no Android build tooling was available to test against, including the
 * newer per-clip trim extraction path added here. Everything in this file
 * above the native call is portable TypeScript, exercised the same way the
 * bookmarklet's already-verified version was; the native side needs a real
 * device/emulator test before relying on it.
 */
export async function exportPoolAsGrid(
  posts: Post[],
  orientation: GridOrientation,
  mode: GridMode,
  trims: Record<number, TrimRange> = {},
  onStatus?: (status: string) => void,
  format: GridFormat = 'grid',
  loopMode: LoopMode = 'replay',
  labelMode: LabelMode = 'off',
  labelStyle: LabelStyle = 'outline',
  labelOverrides: Record<number, string> = {}
): Promise<GridExportResult> {
  const startedAt = Date.now();
  const clips = posts.filter((p) => isVideoFile(p.file_url)).slice(0, MAX_GRID_CLIPS);
  if (clips.length < 2) throw new Error('need at least 2 video clips in this pool');

  // Only fetched when actually needed — every other clip in this file skips
  // this entirely if labels are off.
  const tagTypes = labelMode !== 'off' ? await getTagTypeMap() : {};

  // Serial mode has no grid to subdivide — every clip gets the same single,
  // larger frame instead of a computed cell position within a shared canvas.
  let positions: CellPosition[];
  if (format === 'serial') {
    const w = orientation === 'portrait' ? SERIAL_SHORT : SERIAL_LONG;
    const h = orientation === 'portrait' ? SERIAL_LONG : SERIAL_SHORT;
    positions = clips.map(() => ({ x: 0, y: 0, w, h }));
  } else {
    positions = computeCellPositions(clips.length, orientation, mode);
  }

  // Downloaded in parallel — unlike the bookmarklet's ffmpeg.wasm version,
  // there's no shared memory-constrained heap forcing these one-at-a-time
  // here; each download writes straight to disk, so sequential fetching was
  // just adding up N clips' worth of network latency for no real benefit.
  let completed = 0;
  onStatus?.(`downloading 0 of ${clips.length} clips…`);
  const downloadResults = await Promise.all(
    clips.map(async (post, i) => {
      const ext = post.file_url.split('.').pop()?.split('?')[0] || 'mp4';
      const file = new File(Paths.cache, `sakuga_grid_${post.id}_${i}.${ext}`);
      try {
        file.delete();
      } catch {
        // Fine if there was nothing to delete.
      }
      const downloaded = await File.downloadFileAsync(post.file_url, file, { idempotent: true });
      const info = await isValidFile(downloaded.uri);
      completed++;
      onStatus?.(`downloading ${completed} of ${clips.length} clips…`);
      return { path: downloaded.uri, durationMs: info.isValid ? info.duration : 0 };
    })
  );
  const localPaths = downloadResults.map((r) => r.path);
  const naturalDurationsMs = downloadResults.map((r) => r.durationMs);

  // Effective duration is the trimmed range's length when a clip has one,
  // not the full clip's natural length. For grid mode this feeds the
  // target-duration/looping decision; for serial mode there's no target to
  // loop toward — each clip just plays once, for however long its own
  // (possibly trimmed) length is — but the number is still needed there
  // too, just for the trim-extraction step, not for any duration decision.
  const effectiveDurationsMs = clips.map((post, i) => {
    const trim = trims[post.id];
    if (!trim) return naturalDurationsMs[i];
    const naturalSec = naturalDurationsMs[i] > 0 ? naturalDurationsMs[i] / 1000 : trim.end;
    const end = Math.min(trim.end, naturalSec);
    return Math.max(100, (end - trim.start) * 1000);
  });

  let targetDurationMs = 0;
  for (const d of effectiveDurationsMs) if (d > targetDurationMs) targetDurationMs = d;
  if (targetDurationMs <= 0) targetDurationMs = 1000; // guard against every probe failing

  const gridClips = localPaths.map((path, i) => {
    const post = clips[i];
    const trim = trims[post.id];
    // Serial mode never loops — every clip in a sequence just plays through
    // once for its own length, so needsLoop stays false there regardless.
    const needsLoop = format === 'grid' && effectiveDurationsMs[i] > 0 && effectiveDurationsMs[i] < targetDurationMs - 100;
    const clip: any = {
      path,
      needsLoop,
      x: positions[i].x,
      y: positions[i].y,
      w: positions[i].w,
      h: positions[i].h,
    };
    if (trim) {
      clip.trimStartSec = trim.start;
      clip.trimDurationSec = trim.end - trim.start;
    }
    if (needsLoop && loopMode === 'stop') {
      clip.stopExtendSec = (targetDurationMs - effectiveDurationsMs[i]) / 1000;
    }
    if (labelMode !== 'off') {
      const override = labelOverrides[post.id];
      if (override && override.trim()) {
        // A custom label replaces the auto-detected staff names entirely
        // for this clip — wrapped at its own natural word breaks like
        // ordinary text on the native side, not treated as a single atomic
        // name the way a real animator name is.
        clip.labelTokens = override.trim().split(/\s+/).filter(Boolean);
        clip.labelJoiner = ' ';
      } else {
        // Only this clip's own animator tags — not the show, not other
        // general tags — since the point is identifying who's credited on
        // THIS specific cut, matching the community request this came from.
        const animatorNames = (post.tags || '')
          .split(/\s+/)
          .filter((t) => t && tagTypes[t] === 1)
          .map((t) => titleCase(t.replace(/_/g, ' ')));
        // Only beyond 9 credited animators (rare) does the list itself get
        // truncated with a "+N more" — short lists never pay this cost.
        if (animatorNames.length > 9) {
          const extra = animatorNames.length - 9;
          clip.labelTokens = [...animatorNames.slice(0, 9), `+${extra} more`];
          clip.labelJoiner = ', ';
        } else if (animatorNames.length) {
          clip.labelTokens = animatorNames;
          clip.labelJoiner = ', ';
        }
      }
      if (clip.labelTokens?.length) {
        clip.labelPosition = labelMode; // 'left' | 'right'
        clip.labelStyle = labelStyle;
      }
    }
    return clip;
  });

  let canvasWidth = 0;
  let canvasHeight = 0;
  for (const pos of positions) {
    if (pos.x + pos.w > canvasWidth) canvasWidth = pos.x + pos.w;
    if (pos.y + pos.h > canvasHeight) canvasHeight = pos.y + pos.h;
  }

  // Visible directly in the Metro/`expo start` terminal — no adb/logcat
  // needed. Prints exactly what's about to be sent to the native side, so a
  // "no text" or "wrong clip count" report can be checked against real data
  // instead of guessed at blind: does every clip actually have labelTokens
  // when labels are on, does the clip count/order match what was picked,
  // are x/y/w/h sane for the chosen format.
  console.log(
    `[gridExport] format=${format} loopMode=${loopMode} labelMode=${labelMode} labelStyle=${labelStyle} ` +
      `canvas=${canvasWidth}x${canvasHeight} targetDurationMs=${targetDurationMs}`
  );
  gridClips.forEach((c, i) => {
    console.log(
      `[gridExport] clip[${i}] path=${c.path} x=${c.x} y=${c.y} w=${c.w} h=${c.h} needsLoop=${c.needsLoop} ` +
        `stopExtendSec=${c.stopExtendSec ?? '-'} trim=${c.trimStartSec != null ? `${c.trimStartSec}+${c.trimDurationSec}` : '-'} ` +
        `labelTokens=${c.labelTokens ? JSON.stringify(c.labelTokens) : '-'} labelJoiner=${c.labelJoiner ?? '-'} ` +
        `labelPosition=${c.labelPosition ?? '-'} labelStyle=${c.labelStyle ?? '-'}`
    );
  });

  onStatus?.(format === 'serial' ? 'joining clips (this can take a while)…' : 'compositing grid (this can take a while)…');
  // If exportGrid genuinely isn't present on the native module — most
  // likely because the installed build predates the react-native-video-trim
  // patch, or a stale build wasn't rebuilt after it was added — fail with a
  // message that says so directly instead of a bare "undefined is not a
  // function", which gives no hint that a rebuild (not a code fix) is needed.
  if (typeof nativeExportGrid !== 'function') {
    throw new Error(
      'exportGrid is not available on the native module — the installed build likely predates the react-native-video-trim patch. Try a clean rebuild (expo prebuild --clean, then a fresh eas build) after confirming patches/react-native-video-trim+8.2.2.patch is present.'
    );
  }
  const result = await nativeExportGrid(gridClips, {
    canvasWidth,
    canvasHeight,
    targetDurationMs,
    outputExt: 'mp4',
    format,
  });

  // Same temporary diagnostics as the input log above, just for what
  // actually ran natively — the export "succeeds" with no error, so this
  // is the only way to see the real command without adb/logcat.
  console.log(`[gridExport] native result: debugLabelCount=${result.debugLabelCount}`);
  console.log(`[gridExport] native inputArgs: ${result.debugInputArgs}`);
  console.log(`[gridExport] native filterComplex: ${result.debugFilterComplex}`);

  // Best-effort cleanup of the downloaded inputs — the composited output
  // stays (that's the actual result being returned).
  for (const path of localPaths) {
    try {
      new File(path).delete();
    } catch {
      // Non-fatal.
    }
  }

  const filename = result.outputPath.split('/').pop() || `sakuga_grid_${Date.now()}.mp4`;
  return { uri: result.outputPath, filename, seconds: (Date.now() - startedAt) / 1000 };
}
