/**
 * LyriseMusic 本地音乐去重
 * 文件：duplicateFinder.ts
 * 描述：找出本地曲库里重复的曲目，分两级判定：
 *        1. identical —— 字节级相同（文件大小一致后再比首尾片段的哈希）
 *        2. same-track —— 同一首歌的不同版本（标题/歌手规范化后一致，且时长相差 2 秒内）
 *
 *      只做只读扫描，不删除任何文件；删除动作由调用方走系统回收站。
 * 版权：Copyright © 2026 Koason. All Rights Reserved.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import type {
  DuplicateFile,
  DuplicateGroup,
  LocalAudioFile,
  LocalMusicLibrary,
} from '../../shared/localMusic';

/** 同曲不同版本判定的时长容差（秒）。 */
const DURATION_TOLERANCE = 2;

/** 无损格式：同组里优先保留。 */
const LOSSLESS = new Set(['flac', 'wav', 'ape', 'alac', 'aiff', 'aif', 'wv', 'dsf', 'dff']);

/** 规范化标题：小写、去括号内容、去常见修饰词与标点。 */
function normalizeTitle(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[（(\[【].*?[)）\]】]/g, '')
    .replace(/\b(feat\.?|ft\.?|remaster(ed)?|live|acoustic|inst(rumental)?)\b/g, '')
    .replace(/[\s\-_.,!?·、，。！？]+/g, '')
    .trim();
}

function normalizeArtist(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[\s\-_.,!?·、，。！？&/]+/g, '')
    .trim();
}

/** 同组里挑一个建议保留的：无损优先，其次体积大。 */
function pickKeep(files: DuplicateFile[]): string {
  const best = [...files].sort((a, b) => {
    const losslessA = LOSSLESS.has(a.extension) ? 1 : 0;
    const losslessB = LOSSLESS.has(b.extension) ? 1 : 0;
    if (losslessA !== losslessB) return losslessB - losslessA;
    return b.size - a.size;
  })[0];
  return best?.path ?? files[0]?.path ?? '';
}

/** 抽样哈希：读首尾各 256KB，够区分绝大多数文件，又不必整个读一遍。 */
async function sampleHash(filePath: string, size: number): Promise<string | null> {
  const sampleSize = 256 * 1024;
  try {
    const handle = await fsp.open(filePath, 'r');
    try {
      const hash = crypto.createHash('sha1');
      const headLength = Math.min(sampleSize, size);
      const head = Buffer.alloc(headLength);
      await handle.read(head, 0, headLength, 0);
      hash.update(head);

      if (size > sampleSize * 2) {
        const tail = Buffer.alloc(sampleSize);
        await handle.read(tail, 0, sampleSize, size - sampleSize);
        hash.update(tail);
      }
      hash.update(String(size));
      return hash.digest('hex');
    } finally {
      await handle.close();
    }
  } catch {
    // 文件读不到（被移走/占用）就跳过，不阻断整体扫描
    return null;
  }
}

function toDuplicateFile(file: LocalAudioFile, library: LocalMusicLibrary): DuplicateFile {
  return {
    path: file.path,
    libraryId: library.id,
    libraryName: library.name,
    name: file.name,
    size: file.size,
    extension: file.extension,
    duration: file.duration,
    title: file.title || path.basename(file.name, path.extname(file.name)),
    artist: file.artist ?? '',
  };
}

/**
 * 扫描重复曲目。
 * @param libraries 曲库列表（含文件缓存）。
 * @param onProgress 进度回调（已处理数 / 总数）。
 */
export async function findDuplicates(
  libraries: LocalMusicLibrary[],
  onProgress?: (done: number, total: number) => void,
): Promise<DuplicateGroup[]> {
  const entries: { file: DuplicateFile; size: number }[] = [];
  for (const library of libraries) {
    for (const file of library.files) {
      if (!fs.existsSync(file.path)) continue;
      entries.push({ file: toDuplicateFile(file, library), size: file.size });
    }
  }

  const groups: DuplicateGroup[] = [];
  const consumed = new Set<string>();

  // 第一轮：同大小再比哈希，抓「同一文件存了多份」
  const bySize = new Map<number, typeof entries>();
  for (const entry of entries) {
    const bucket = bySize.get(entry.size) ?? [];
    bucket.push(entry);
    bySize.set(entry.size, bucket);
  }

  let done = 0;
  const total = entries.length;
  for (const [size, bucket] of bySize) {
    if (bucket.length < 2) {
      done += bucket.length;
      onProgress?.(done, total);
      continue;
    }
    const byHash = new Map<string, typeof bucket>();
    for (const entry of bucket) {
      const hash = await sampleHash(entry.file.path, size);
      if (!hash) continue;
      const list = byHash.get(hash) ?? [];
      list.push(entry);
      byHash.set(hash, list);
    }
    for (const list of byHash.values()) {
      if (list.length < 2) continue;
      const files = list.map((item) => item.file);
      files.forEach((item) => consumed.add(item.path));
      groups.push({
        label: files[0].title,
        reason: 'identical',
        keepPath: pickKeep(files),
        files,
      });
    }
    done += bucket.length;
    onProgress?.(done, total);
  }

  // 第二轮：标题+歌手+时长，抓「同曲不同码率」
  const byTrack = new Map<string, DuplicateFile[]>();
  for (const entry of entries) {
    if (consumed.has(entry.file.path)) continue;
    const title = normalizeTitle(entry.file.title);
    if (!title) continue;
    const artist = normalizeArtist(entry.file.artist);
    // 别对时长先取整：300.5 取整成 301 会让它和 300 落进相邻的两个桶
    const seconds = entry.file.duration ?? 0;
    if (!Number.isFinite(seconds) || seconds <= 0) continue;
    const bucketKey = `${artist}|${title}|${Math.round(seconds / DURATION_TOLERANCE)}`;
    const list = byTrack.get(bucketKey) ?? [];
    list.push(entry.file);
    byTrack.set(bucketKey, list);
  }

  for (const list of byTrack.values()) {
    if (list.length < 2) continue;
    groups.push({
      label: list[0].artist ? `${list[0].artist} · ${list[0].title}` : list[0].title,
      reason: 'same-track',
      keepPath: pickKeep(list),
      files: list,
    });
  }

  // 文件多的组排前面，方便先处理最占空间的
  groups.sort((a, b) => b.files.length - a.files.length);
  return groups;
}
