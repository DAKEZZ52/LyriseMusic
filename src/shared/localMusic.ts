export interface LocalAudioMetadata {
  title?: string;
  artist?: string;
  album?: string;
  duration?: number;
  year?: number;
  track?: number;
  disk?: number;
  genre?: string[];
}

export interface LocalAudioFile {
  name: string;
  path: string;
  size: number;
  modifiedAt: number;
  extension: string;
  relativePath: string;
  title: string;
  artist?: string;
  album?: string;
  duration?: number;
}

export interface LocalAudioScanOptions {
  recursive?: boolean;
  includeHidden?: boolean;
  limit?: number;
  maxDepth?: number;
  maxFileSize?: number;
}

export interface LocalAudioScanResult {
  root: string;
  files: LocalAudioFile[];
  errors?: string[];
  limitReached: boolean;
}

/** 本地音乐库：一个被用户添加并扫描的本地文件夹及其曲目缓存。 */
export interface LocalMusicLibrary {
  /** 稳定库 ID（基于规范化根路径生成；单曲库为固定 LOCAL_SINGLES_LIBRARY_ID）。 */
  id: string;
  /** 库根目录绝对路径（单曲库为空字符串）。 */
  root: string;
  /** 库显示名（默认取根目录名；单曲库为「我的单曲」）。 */
  name: string;
  /** 库类型：folder=文件夹库；files=单曲库（由「添加单曲」维护）。 */
  kind: 'folder' | 'files';
  /** 首次添加时间（毫秒时间戳）。 */
  addedAt: number;
  /** 最近一次成功扫描时间（毫秒时间戳）。 */
  scannedAt: number;
  /** 曲目缓存（含元数据）；重新扫描时整体替换。 */
  files: LocalAudioFile[];
}

/** 单曲库固定 ID：「添加单曲」导入的音频文件统一挂载到该库。 */
export const LOCAL_SINGLES_LIBRARY_ID = 'local-singles';

/** 「添加单曲」选择文件后的结果。 */
export interface LocalMusicAddFilesResult {
  /** 用户取消选择时为 true（library 为 null）。 */
  canceled: boolean;
  /** 添加后的单曲库（含最新 files）；未取消时必定返回。 */
  library: LocalMusicLibrary | null;
  /** 成功导入的文件数。 */
  addedCount: number;
  /** 跳过文件数（重复路径/解析失败）。 */
  skippedCount: number;
}

// 该清单 = 本地可播放格式 = FFmpeg 引擎
// native/lyrise-audio-player/vendor/ffmpeg-audio/scripts/generate_config.ts
// decoder/demuxer 白名单支持集，作为唯一事实源。
// amr 虽在 FFmpeg 白名单中，但当前仅作为云盘上传业务格式保留，不纳入本地播放清单。
export const LOCAL_AUDIO_EXTENSIONS = [
  'aac',
  'aif',
  'aiff',
  'alac',
  'ape',
  'caf',
  'dff',
  'dsf',
  'flac',
  'm4a',
  'mp3',
  'oga',
  'ogg',
  'opus',
  'wav',
  'wave',
  'webm',
  'wma',
  'wv',
];

/* ───────────── 标签编辑 ───────────── */

/** 本地文件的标签快照，供编辑界面回填。 */
export interface LocalTagSnapshot {
  filePath: string;
  title: string;
  artist: string;
  album: string;
  year?: number;
  track?: number;
  genre: string;
  duration?: number;
  /** 封面 dataURL，用于界面预览；没有封面时为空。 */
  coverDataUrl?: string;
}

/** 一次标签修改。字段为 undefined 表示保持原值，不是清空。 */
export interface LocalTagUpdate {
  filePath: string;
  title?: string;
  artist?: string;
  album?: string;
  year?: number;
  track?: number;
  genre?: string;
  /** 本地图片的绝对路径，指定则替换封面。 */
  coverPath?: string;
  /** 传 true 表示移除内嵌封面。 */
  clearCover?: boolean;
}

/** 单文件写入结果。批量时逐个返回，个别失败不影响其它。 */
export interface LocalTagWriteResult {
  filePath: string;
  ok: boolean;
  error?: string;
}

/* ───────────── 重复文件 ───────────── */

/** 重复组里的一个文件。 */
export interface DuplicateFile {
  path: string;
  libraryId: string;
  libraryName: string;
  name: string;
  size: number;
  extension: string;
  duration?: number;
  title: string;
  artist: string;
}

/** 一组重复曲目。 */
export interface DuplicateGroup {
  /** 组展示名。 */
  label: string;
  /** identical = 字节级相同；same-track = 同曲不同码率。 */
  reason: 'identical' | 'same-track';
  /** 建议保留的路径（无损优先，其次体积大的）。 */
  keepPath: string;
  files: DuplicateFile[];
}

/** 删除重复文件的结果。 */
export interface DuplicateRemoveResult {
  removed: number;
  failed: number;
  failedPaths: string[];
}
