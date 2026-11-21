/**
 * LyriseMusic 本地音乐标签编辑
 * 文件：tagEditor.ts
 * 描述：读写本地音频文件的元数据，供「批量标签编辑」使用。
 *
 *      与 download/MetadataWriter 的分工：
 *        · MetadataWriter 在下载完成后自动写标签，封面来自远程 URL；
 *        · 这里服务用户手动编辑，封面来自本地图片，且未填写的字段保持原值。
 *
 *      写回按格式分两条：mp3 走 node-id3，其余容器走 taglib-wasm（与下载侧一致）。
 * 版权：Copyright © 2026 Koason. All Rights Reserved.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseFile } from 'music-metadata';
import * as NodeID3 from 'node-id3';
import type { Tags } from 'node-id3';
import log from '../logger';
import type {
  LocalTagSnapshot,
  LocalTagUpdate,
  LocalTagWriteResult,
} from '../../shared/localMusic';

const MP3_EXT = 'mp3';
const TAGLIB_EXTS = new Set(['flac', 'm4a', 'mp4', 'ogg', 'opus', 'wma', 'ape', 'wav']);

const extOf = (filePath: string) => path.extname(filePath).slice(1).toLowerCase();

/** 按扩展名猜封面 MIME，猜不出按 jpeg。 */
function coverMime(filePath: string): string {
  const ext = extOf(filePath);
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  return 'image/jpeg';
}

/** 读单个文件的标签快照。封面转成 dataURL 供界面预览。 */
export async function readTagSnapshot(filePath: string): Promise<LocalTagSnapshot> {
  const parsed = await parseFile(filePath, { duration: true, skipCovers: false });
  const picture = parsed.common.picture?.[0];
  return {
    filePath,
    title: parsed.common.title ?? '',
    artist: parsed.common.artist ?? '',
    album: parsed.common.album ?? '',
    year: parsed.common.year ?? undefined,
    track: parsed.common.track.no ?? undefined,
    genre: (parsed.common.genre ?? []).join('/'),
    duration: parsed.format.duration ?? undefined,
    coverDataUrl: picture
      ? `data:${picture.format};base64,${Buffer.from(picture.data).toString('base64')}`
      : undefined,
  };
}

/** 批量读；单个失败不抛，记进 error 字段。 */
export async function readTagSnapshots(
  filePaths: string[],
): Promise<{ snapshots: LocalTagSnapshot[]; errors: LocalTagWriteResult[] }> {
  const snapshots: LocalTagSnapshot[] = [];
  const errors: LocalTagWriteResult[] = [];
  for (const filePath of filePaths) {
    try {
      snapshots.push(await readTagSnapshot(filePath));
    } catch (error) {
      errors.push({ filePath, ok: false, error: (error as Error).message });
    }
  }
  return { snapshots, errors };
}

interface CoverPayload {
  buffer: Buffer;
  mime: string;
}

/** 读出要写入的封面：本地图片路径优先，clearCover 则返回 null。 */
function resolveCover(update: LocalTagUpdate): CoverPayload | null {
  if (update.clearCover) return null;
  if (!update.coverPath) return null;
  const buffer = fs.readFileSync(update.coverPath);
  return { buffer, mime: coverMime(update.coverPath) };
}

/** MP3：先读出原有标签再合并，避免只改一个字段就把其它字段清空。 */
async function writeMp3(update: LocalTagUpdate, cover: CoverPayload | null): Promise<void> {
  const existing = (NodeID3.read(update.filePath) ?? {}) as Tags;
  const tags: Tags = { ...existing };

  if (update.title !== undefined) tags.title = update.title;
  if (update.artist !== undefined) tags.artist = update.artist;
  if (update.album !== undefined) tags.album = update.album;
  if (update.year !== undefined) tags.year = String(update.year);
  if (update.track !== undefined) tags.trackNumber = String(update.track);
  if (update.genre !== undefined) tags.genre = update.genre;

  if (update.clearCover) {
    delete tags.image;
  } else if (cover) {
    tags.image = {
      mime: cover.mime,
      type: { id: 3, name: 'front cover' },
      description: 'cover',
      imageBuffer: cover.buffer,
    };
  }

  const result = await NodeID3.Promise.write(tags, update.filePath);
  if (result !== true) throw new Error('node-id3 写入返回失败');
}

/** 非 MP3：taglib-wasm 的 tag 对象是链式 setter，只对填了的字段赋值。 */
async function writeWithTaglib(update: LocalTagUpdate, cover: CoverPayload | null): Promise<void> {
  const { TagLib } = await import('taglib-wasm');
  const taglib = await TagLib.initialize();

  // 与下载侧一致：Windows 实时保护可能短暂锁定文件，open 失败重试三次
  let file: Awaited<ReturnType<typeof taglib.open>> | null = null;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      file = await taglib.open(update.filePath);
      break;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  if (!file) throw lastError instanceof Error ? lastError : new Error(String(lastError));

  try {
    const tag = file.tag();
    if (update.title !== undefined) tag.setTitle(update.title);
    if (update.artist !== undefined) tag.setArtist(update.artist);
    if (update.album !== undefined) tag.setAlbum(update.album);
    if (update.year !== undefined) tag.setYear(update.year);
    if (update.track !== undefined) tag.setTrack(update.track);
    if (update.genre !== undefined) tag.setGenre(update.genre);

    if (update.clearCover) {
      file.setPictures([]);
    } else if (cover) {
      file.setPictures([
        {
          mimeType: cover.mime,
          data: new Uint8Array(cover.buffer),
          type: 'FrontCover',
          description: 'cover',
        },
      ]);
    }

    file.save();
    await file.saveToFile(update.filePath);
  } finally {
    file.dispose();
  }
}

/** 写单个文件。格式不支持时抛错，由批量入口收集。 */
export async function writeTagUpdate(update: LocalTagUpdate): Promise<void> {
  const ext = extOf(update.filePath);
  const cover = resolveCover(update);

  if (ext === MP3_EXT) {
    await writeMp3(update, cover);
    return;
  }
  if (TAGLIB_EXTS.has(ext)) {
    await writeWithTaglib(update, cover);
    return;
  }
  throw new Error(`该格式不支持写入标签：${ext || '未知'}`);
}

/** 批量写：逐个执行，单个失败不影响其它，最后汇总。 */
export async function writeTagUpdates(updates: LocalTagUpdate[]): Promise<LocalTagWriteResult[]> {
  const results: LocalTagWriteResult[] = [];
  for (const update of updates) {
    try {
      await writeTagUpdate(update);
      results.push({ filePath: update.filePath, ok: true });
    } catch (error) {
      const message = (error as Error).message || '写入失败';
      log.warn('[TagEditor] 写入失败', { filePath: update.filePath, error: message });
      results.push({ filePath: update.filePath, ok: false, error: message });
    }
  }
  return results;
}
