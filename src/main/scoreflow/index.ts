/**
 * LyriseMusic 扒谱 IPC 模块
 * 文件：index.ts
 * 描述：注册扒谱相关 IPC（引擎探测、开始扒谱、取消、导出 JSON），
 *      引擎是本地 Python 侧车，全部离线运行。
 * 版权：Copyright © 2026 Dake（知之Dake）. All Rights Reserved.
 */
import { dialog, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { ipcRegistry } from '../ipc/registry';
import { assertFeatureEnabled } from '../remoteFlags';
import type { IpcContext } from '../ipc/types';
import { cancelTranscribe, probeEngine, transcribe } from './engine';
import {
  listScoreCache,
  readScoreCache,
  scoreCacheDir,
  startScoreCacheWatcher,
  writeScoreCache,
} from './cache';
import {
  SCOREFLOW_IPC_CHANNELS,
  type ScoreDoc,
  type ScoreOptions,
  type ScorePcmInput,
  type ScoreProgress,
} from '../../shared/scoreflow';

/** 校验并规整渲染层传来的 PCM。 */
function normalizeInput(input: ScorePcmInput | undefined): ScorePcmInput {
  if (!input || !input.data) throw new Error('音频数据为空');
  const sampleRate = Number(input.sampleRate);
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000) {
    throw new Error('采样率不合法');
  }
  const mono =
    input.data instanceof Float32Array
      ? input.data
      : Float32Array.from(input.data as unknown as ArrayLike<number>);
  if (!mono.length) throw new Error('音频数据为空');
  return {
    channels: Number(input.channels) || 1,
    sampleRate,
    data: mono,
    baseName: String(input.baseName || 'audio').slice(0, 120),
  };
}

/** 注册扒谱模块全部 IPC 处理器。 */
export const registerScoreflowHandlers = (context: IpcContext): void => {
  /** 引擎是否可用（页面进入时先探一次，不可用就提示去哪配）。 */
  ipcRegistry.registerHandler(SCOREFLOW_IPC_CHANNELS.engineStatus, async () => {
    // 服务端关闭扒谱时直接报错，页面据此显示禁用提示
    await assertFeatureEnabled('scoreflow');
    return probeEngine();
  });

  /** 开始扒谱：结果一次性返回，进度走 progress 事件。 */
  ipcRegistry.registerHandler(
    SCOREFLOW_IPC_CHANNELS.transcribe,
    async (event, payload: { input: ScorePcmInput; options?: ScoreOptions }) => {
      await assertFeatureEnabled('scoreflow');
      const input = normalizeInput(payload?.input);
      const options = payload?.options ?? {};

      const send = (progress: ScoreProgress) => {
        if (event.sender.isDestroyed()) return;
        event.sender.send(SCOREFLOW_IPC_CHANNELS.progress, progress);
      };
      send({ stage: '准备音频', percent: 0.01 });

      return transcribe(input, options, send);
    },
  );

  /** 取消进行中的任务。 */
  ipcRegistry.registerHandler(SCOREFLOW_IPC_CHANNELS.cancel, () => cancelTranscribe());

  /** 导出谱面 JSON 到用户选择的位置。 */
  ipcRegistry.registerHandler(
    SCOREFLOW_IPC_CHANNELS.exportJson,
    async (_event, payload: { doc: ScoreDoc; suggestedName?: string }) => {
      const doc = payload?.doc;
      if (!doc || !Array.isArray(doc.measures)) throw new Error('谱面数据无效');
      const window = context.getMainWindow();
      const safeName = String(payload.suggestedName || doc.meta?.title || 'score')
        .replace(/[\\/:*?"<>|]/g, '_')
        .slice(0, 80);
      const result = await dialog.showSaveDialog(window as Electron.BrowserWindow, {
        title: '导出谱面 JSON',
        defaultPath: `${safeName}.scoreflow.json`,
        filters: [{ name: 'ScoreFlow 谱面', extensions: ['json'] }],
      });
      if (result.canceled || !result.filePath) return null;
      fs.writeFileSync(result.filePath, JSON.stringify(doc, null, 2), 'utf8');
      shell.showItemInFolder(result.filePath);
      return result.filePath;
    },
  );

  /** 导出 MIDI：渲染层生成好字节，这里只负责落盘。 */
  ipcRegistry.registerHandler(
    SCOREFLOW_IPC_CHANNELS.exportMidi,
    async (_event, payload: { data: Uint8Array | number[]; suggestedName?: string }) => {
      const raw = payload?.data;
      if (!raw || !raw.length) throw new Error('MIDI 数据为空');
      const buffer = Buffer.from(raw instanceof Uint8Array ? raw : Uint8Array.from(raw));
      if (buffer.length < 14 || buffer.toString('ascii', 0, 4) !== 'MThd') {
        throw new Error('MIDI 数据无效');
      }
      const window = context.getMainWindow();
      const safeName = String(payload.suggestedName || 'score')
        .replace(/[\\/:*?"<>|]/g, '_')
        .slice(0, 80);
      const result = await dialog.showSaveDialog(window as Electron.BrowserWindow, {
        title: '导出 MIDI',
        defaultPath: `${safeName}.mid`,
        filters: [{ name: 'MIDI 文件', extensions: ['mid'] }],
      });
      if (result.canceled || !result.filePath) return null;
      fs.writeFileSync(result.filePath, buffer);
      shell.showItemInFolder(result.filePath);
      return result.filePath;
    },
  );

  /** 导出 PNG：渲染层把谱面画成 dataURL，这里解出字节落盘。 */
  ipcRegistry.registerHandler(
    SCOREFLOW_IPC_CHANNELS.exportImage,
    async (_event, payload: { dataUrl: string; suggestedName?: string }) => {
      const dataUrl = String(payload?.dataUrl || '');
      const marker = 'base64,';
      const at = dataUrl.indexOf(marker);
      if (!dataUrl.startsWith('data:image/png') || at < 0) throw new Error('图片数据无效');
      const buffer = Buffer.from(dataUrl.slice(at + marker.length), 'base64');
      if (buffer.length < 8) throw new Error('图片数据为空');
      const window = context.getMainWindow();
      const safeName = String(payload.suggestedName || 'score')
        .replace(/[\\/:*?"<>|]/g, '_')
        .slice(0, 80);
      const result = await dialog.showSaveDialog(window as Electron.BrowserWindow, {
        title: '导出图片',
        defaultPath: `${safeName}.png`,
        filters: [{ name: 'PNG 图片', extensions: ['png'] }],
      });
      if (result.canceled || !result.filePath) return null;
      fs.writeFileSync(result.filePath, buffer);
      shell.showItemInFolder(result.filePath);
      return result.filePath;
    },
  );

  /** 读缓存：命中就直接渲染，不用重跑引擎。 */
  ipcRegistry.registerHandler(SCOREFLOW_IPC_CHANNELS.cacheRead, (_event, key: string) =>
    readScoreCache(String(key || '')),
  );

  /** 写缓存：扒谱成功后由渲染层调用，顺手把目录监听挂上。 */
  ipcRegistry.registerHandler(
    SCOREFLOW_IPC_CHANNELS.cacheWrite,
    (_event, payload: { key: string; label: string; doc: ScoreDoc; engineVersion?: string }) => {
      if (!payload?.doc || !Array.isArray(payload.doc.measures)) throw new Error('谱面数据无效');
      const file = writeScoreCache({
        key: String(payload.key || ''),
        label: String(payload.label || ''),
        doc: payload.doc,
        engineVersion: payload.engineVersion,
      });
      // 监听挂在主窗口上：缓存被改时推给页面，页面自己决定要不要刷新。
      // 这里每轮都取当前窗口，不缓存 sender —— 页面刷新后 sender 会失效。
      startScoreCacheWatcher((change) => {
        const window = context.getMainWindow();
        if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return;
        window.webContents.send(SCOREFLOW_IPC_CHANNELS.cacheChanged, change);
      });
      return file;
    },
  );

  /** 列出缓存目录与已有条目。 */
  ipcRegistry.registerHandler(SCOREFLOW_IPC_CHANNELS.cacheList, () => listScoreCache());

  /** 在文件管理器里打开缓存目录，方便直接改 json。 */
  ipcRegistry.registerHandler(SCOREFLOW_IPC_CHANNELS.cacheOpenDir, async () => {
    const dir = scoreCacheDir();
    await shell.openPath(dir);
    return dir;
  });
};

/** 供其他模块引用的导出目录提示（当前未使用，保留给后续「打开输出目录」入口）。 */
export const scoreflowOutDirHint = (): string => path.join('', '');
