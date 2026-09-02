import { File, Paths } from 'expo-file-system';
import { trim as nativeTrim, share as nativeShare, saveToPhoto as nativeSaveToPhoto } from 'react-native-video-trim';

export interface TrimResult {
  uri: string;
  filename: string;
  seconds: number;
}

/** Trims a clip to [inTime, outTime] (seconds). `accurate` maps to this
 * library's `enablePreciseTrimming` — hardware-encoder re-encode for real
 * frame accuracy vs a fast stream-copy that can only cut on the nearest
 * keyframe. Same fast/accurate tradeoff we built with raw ffmpeg before,
 * just using the platform's hardware encoder instead of software libx264. */
export async function performTrim(
  sourceUrl: string,
  postId: number,
  inTime: number,
  outTime: number,
  accurate: boolean,
  onStatus?: (status: string) => void
): Promise<TrimResult> {
  const startedAt = Date.now();
  onStatus?.('downloading clip…');

  // trim() takes a local file path, not a remote URL, so the source still
  // needs downloading first — same as the ffmpeg-kit approach before it.
  const sourceExt = sourceUrl.split('.').pop()?.split('?')[0] || 'mp4';
  const inputFile = new File(Paths.cache, `sakuga_${postId}_input.${sourceExt}`);
  try {
    inputFile.delete();
  } catch {
    // Fine if there was nothing to delete (no stale file from a prior attempt).
  }
  const downloaded = await File.downloadFileAsync(sourceUrl, inputFile, { idempotent: true });

  onStatus?.(accurate ? 'trimming (hardware re-encode for frame accuracy)…' : 'trimming (fast mode)…');

  const result = await nativeTrim(downloaded.uri, {
    startTime: Math.round(inTime * 1000),
    endTime: Math.round(outTime * 1000),
    enablePreciseTrimming: accurate,
    outputExt: 'mp4',
  });

  const filename = result.outputPath.split('/').pop() || `sakuga_${postId}_trim.mp4`;
  return { uri: result.outputPath, filename, seconds: (Date.now() - startedAt) / 1000 };
}

/** Downloads the original clip, effectively unmodified. Routes through the
 * same nativeTrim() path as a real trim (full range, fast stream-copy)
 * rather than handing the raw expo-file-system download straight to
 * share()/saveToPhoto() — those didn't recognize that file the same way
 * they recognize this library's own trim output, and this sidesteps that
 * without needing a different file-handling mechanism (and the extra native
 * rebuild that would require). */
export async function downloadFull(
  sourceUrl: string,
  postId: number,
  durationSeconds: number,
  onStatus?: (status: string) => void
): Promise<TrimResult> {
  const startedAt = Date.now();
  onStatus?.('downloading clip…');
  const sourceExt = sourceUrl.split('.').pop()?.split('?')[0] || 'mp4';
  const file = new File(Paths.cache, `sakuga_${postId}_full.${sourceExt}`);
  try {
    file.delete();
  } catch {
    // Fine if there was nothing to delete.
  }
  const downloaded = await File.downloadFileAsync(sourceUrl, file, { idempotent: true });

  onStatus?.('preparing…');
  const result = await nativeTrim(downloaded.uri, {
    startTime: 0,
    endTime: Math.round(durationSeconds * 1000) + 500, // small buffer so nothing gets clipped off the very end
    enablePreciseTrimming: false, // fast stream-copy — this is the whole clip, no need to re-encode
    outputExt: 'mp4',
  });
  const filename = result.outputPath.split('/').pop() || `sakuga_${postId}_full.mp4`;
  return { uri: result.outputPath, filename, seconds: (Date.now() - startedAt) / 1000 };
}

export async function shareResult(uri: string) {
  await nativeShare(uri);
}

/** Saves directly to the phone's photo/video gallery — the standard mobile
 * equivalent of a browser's "Download" (shows up in the Photos/Gallery app,
 * not a generic Downloads folder), as a genuine alternative to the share
 * sheet rather than requiring a share-to-somewhere-else step every time. */
export async function saveToGallery(uri: string) {
  const result = await nativeSaveToPhoto(uri);
  if (!result.success) throw new Error('failed to save to gallery');
}

