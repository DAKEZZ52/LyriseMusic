/**
 * LyriseMusic 扒谱缓存
 * 文件：cache.ts
 * 描述：把扒谱结果按「歌曲 / 本地文件」落盘，配合 fs.watch 做热更新——
 *      用户手动改缓存里的 score json，界面立刻反映，不用重启或重跑引擎。
 * 版权：Copyright © 2026 Koason. All Rights Reserved.
 */
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import log from '../logger';
import type { ScoreCacheEntry, ScoreDoc } from '../../shared/scoreflow';

/** 缓存键只允许保守字符，避免拼路径时逃逸。 */
export function normalizeCacheKey(raw: string): string {
  const key = String(raw || '').trim();
  if (!key) throw new Error('缓存键为空');
  const safe = key.replace(/[^\w.:-]/g, '_').slice(0, 120);
  if (!safe) throw new Error('缓存键不合法');
  return safe;
}

/**
 * 缓存目录：优先环境变量 DAKE_SCORE_CACHE_DIR，其次 userData/score-cache。
 * 开发模式下 userData 被指到项目内的 .dev-userdata/（见 src/main/index.ts），
 * 所以开发时缓存天然落在 E 盘项目目录里，打包版默认在 %AppData%。
 */
export function scoreCacheDir(): string {
  const override = process.env.DAKE_SCORE_CACHE_DIR?.trim();
  const dir = override || path.join(app.getPath('userData'), 'score-cache');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const cacheFile = (key: string) => path.join(scoreCacheDir(), `${normalizeCacheKey(key)}.json`);

export function readScoreCache(key: string): ScoreCacheEntry | null {
  const file = cacheFile(key);
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const entry = JSON.parse(raw) as ScoreCacheEntry;
    if (!entry || !entry.doc || !Array.isArray(entry.doc.measures)) return null;
    return entry;
  } catch (error) {
    // 文件不存在是常态；解析失败说明用户改坏了，抛给调用方显示
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error(`缓存读取失败：${(error as Error).message}`);
  }
}

export function writeScoreCache(payload: {
  key: string;
  label: string;
  doc: ScoreDoc;
  engineVersion?: string;
}): string {
  const key = normalizeCacheKey(payload.key);
  const entry: ScoreCacheEntry = {
    key,
    label: String(payload.label || '').slice(0, 120),
    savedAt: Date.now(),
    engineVersion: payload.engineVersion,
    doc: payload.doc,
  };
  const file = path.join(scoreCacheDir(), `${key}.json`);
  // 带缩进落盘：这份 json 是给人改的，压缩成一行没法读
  fs.writeFileSync(file, JSON.stringify(entry, null, 2), 'utf8');
  return file;
}

export function listScoreCache(): {
  dir: string;
  entries: { key: string; label: string; savedAt: number }[];
} {
  const dir = scoreCacheDir();
  const entries: { key: string; label: string; savedAt: number }[] = [];
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return { dir, entries };
  }
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      const entry = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) as ScoreCacheEntry;
      if (!entry?.doc) continue;
      entries.push({
        key: entry.key ?? name.slice(0, -5),
        label: entry.label ?? '',
        savedAt: entry.savedAt ?? 0,
      });
    } catch {
      /* 用户正在编辑时可能读到半截文件，跳过即可 */
    }
  }
  entries.sort((a, b) => b.savedAt - a.savedAt);
  return { dir, entries };
}

let watcher: fs.FSWatcher | null = null;
let watcherDir = '';
let pending = new Map<string, NodeJS.Timeout>();

/**
 * 监听缓存目录：文件写入后通知渲染层，实现「改完立刻生效」。
 * 编辑器保存往往触发多次事件，这里按 150ms 去抖，并等文件写完再发。
 */
export function startScoreCacheWatcher(
  onChange: (change: { key: string; savedAt: number }) => void,
): void {
  const dir = scoreCacheDir();
  if (watcher && watcherDir === dir) return;
  stopScoreCacheWatcher();

  try {
    watcher = fs.watch(dir, { persistent: false }, (_event, filename) => {
      if (!filename || !String(filename).endsWith('.json')) return;
      const key = String(filename).slice(0, -5);
      const existing = pending.get(key);
      if (existing) clearTimeout(existing);
      pending.set(
        key,
        setTimeout(() => {
          pending.delete(key);
          // 重新读一遍确认文件可解析，避免推送半截内容
          try {
            const entry = readScoreCache(key);
            if (entry) onChange({ key: entry.key, savedAt: entry.savedAt });
          } catch {
            /* 正在写或已删除，忽略这一轮 */
          }
        }, 150),
      );
    });
    watcher.on('error', (error) => {
      log.warn('[ScoreCache] 监听失败', { error: String(error) });
    });
    watcherDir = dir;
    log.info('[ScoreCache] 已监听缓存目录', { dir });
  } catch (error) {
    log.warn('[ScoreCache] 无法监听缓存目录', { dir, error: String(error) });
  }
}

export function stopScoreCacheWatcher(): void {
  for (const timer of pending.values()) clearTimeout(timer);
  pending = new Map();
  if (watcher) {
    try {
      watcher.close();
    } catch {
      /* 忽略关闭失败 */
    }
    watcher = null;
    watcherDir = '';
  }
}
