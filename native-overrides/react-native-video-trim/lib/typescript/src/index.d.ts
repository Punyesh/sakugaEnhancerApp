import type { CompressOptions, CompressResult, EditorConfig, ExportGridOptions, ExportGridResult, ExtractAudioOptions, ExtractAudioResult, FileValidationResult, FrameExtractionOptions, FrameResult, GifOptions, GifResult, GridClipInput, MergeOptions, MergeResult, MixAudioOptions, MixAudioResult, SaveToDocumentsResult, SaveToPhotoResult, ShareResult, TrimOptions, TrimResult } from './NativeVideoTrim';
declare const VideoTrim: any;
/**
 * Show video editor
 *
 * @param {string} filePath: absolute non-empty file path to edit
 * @param {EditorConfig} config: editor configuration
 * @param {Function} onEvent: event callback
 * @returns {void}
 */
export declare function showEditor(filePath: string, config: Partial<Omit<EditorConfig, 'headerTextColor' | 'trimmerColor' | 'handleIconColor' | 'waveformColor' | 'waveformBackgroundColor'>> & {
    headerTextColor?: string;
    trimmerColor?: string;
    handleIconColor?: string;
    waveformColor?: string;
    waveformBackgroundColor?: string;
}): void;
/**
 * List output files generated at all time
 *
 * @returns {Promise<string[]>} A **Promise** which resolves to array of files
 */
export declare function listFiles(): Promise<string[]>;
/**
 * Clean output files generated at all time
 *
 * @returns {Promise<number>} A **Promise** which resolves to number of deleted files
 */
export declare function cleanFiles(): Promise<number>;
/**
 * Delete a file
 *
 * @param {string} filePath: absolute non-empty file path to delete
 * @returns {Promise<boolean>} A **Promise** which resolves `true` if successful
 */
export declare function deleteFile(filePath: string): Promise<boolean>;
/**
 * Close editor
 */
export declare function closeEditor(): void;
/**
 * Check if a file is valid audio or video file
 *
 * @param {string} url: file path to validate
 * @returns {Promise<FileValidationResult>} A **Promise** which resolves file info if successful
 */
export declare function isValidFile(url: string): Promise<FileValidationResult>;
/**
 * Trim a video file
 *
 * @param {string} url: absolute non-empty file path to edit
 * @param {TrimOptions} options: trim options
 * @returns {Promise<TrimResult>} A **Promise** which resolves to the TrimResult interface
 */
export declare function trim(url: string, options: Partial<TrimOptions>): Promise<TrimResult>;
/**
 * Extract a single frame from a video at a given timestamp
 *
 * @param {string} url: absolute non-empty file path
 * @param {Partial<FrameExtractionOptions>} options: extraction options
 * @returns {Promise<FrameResult>} A **Promise** which resolves to the FrameResult
 */
export declare function getFrameAt(url: string, options?: Partial<FrameExtractionOptions>): Promise<FrameResult>;
/**
 * Extract the audio track from a video file
 *
 * @param {string} url: absolute non-empty file path
 * @param {Partial<ExtractAudioOptions>} options: extraction options
 * @returns {Promise<ExtractAudioResult>} A **Promise** which resolves to the result
 */
export declare function extractAudio(url: string, options?: Partial<ExtractAudioOptions>): Promise<ExtractAudioResult>;
/**
 * Compress a video file to reduce its size
 *
 * @param {string} url: absolute non-empty file path
 * @param {Partial<CompressOptions>} options: compression options
 * @returns {Promise<CompressResult>} A **Promise** which resolves to the result
 */
export declare function compress(url: string, options?: Partial<CompressOptions>): Promise<CompressResult>;
/**
 * Convert a video segment to an animated GIF
 *
 * @param {string} url: absolute non-empty file path
 * @param {Partial<GifOptions>} options: GIF conversion options
 * @returns {Promise<GifResult>} A **Promise** which resolves to the result
 */
export declare function toGif(url: string, options?: Partial<GifOptions>): Promise<GifResult>;
/**
 * Merge multiple media files into a single file (headless, no UI)
 *
 * @param {string[]} urls: array of file paths to merge in order
 * @param {Partial<MergeOptions>} options: merge options
 * @returns {Promise<MergeResult>} A **Promise** which resolves to the result
 */
export declare function merge(urls: string[], options?: Partial<MergeOptions>): Promise<MergeResult>;
/**
 * Composite multiple clips into a single grid video (headless, no UI).
 *
 * @param {GridClipInput[]} clips: already-positioned clips, local file paths only
 * @param {Partial<ExportGridOptions>} options: canvas size and target duration
 * @returns {Promise<ExportGridResult>} A **Promise** which resolves to the result
 */
export declare function exportGrid(clips: GridClipInput[], options?: Partial<ExportGridOptions>): Promise<ExportGridResult>;
/**
 * Mix (or replace) an external audio track, such as background music or a
 * voice-over, into a video (headless, no UI). The video stream is copied
 * unchanged, so only the audio is re-encoded.
 *
 * @param {string} videoPath: absolute non-empty path to the source video
 * @param {string} audioPath: absolute non-empty path to the audio to mix in
 * @param {Partial<MixAudioOptions>} options: mixing options
 * @returns {Promise<MixAudioResult>} A **Promise** which resolves to the result
 */
export declare function mixAudio(videoPath: string, audioPath: string, options?: Partial<MixAudioOptions>): Promise<MixAudioResult>;
/**
 * Save a file to the device's photo library
 *
 * @param {string} filePath: absolute path to the file
 * @returns {Promise<SaveToPhotoResult>} A **Promise** which resolves to the result
 */
export declare function saveToPhoto(filePath: string): Promise<SaveToPhotoResult>;
/**
 * Present the system document picker to save a file
 *
 * @param {string} filePath: absolute path to the file
 * @returns {Promise<SaveToDocumentsResult>} A **Promise** which resolves to the result
 */
export declare function saveToDocuments(filePath: string): Promise<SaveToDocumentsResult>;
/**
 * Open the system share sheet for a file
 *
 * @param {string} filePath: absolute path to the file
 * @returns {Promise<ShareResult>} A **Promise** which resolves to the result
 */
export declare function share(filePath: string): Promise<ShareResult>;
export * from './NativeVideoTrim';
export default VideoTrim;
//# sourceMappingURL=index.d.ts.map