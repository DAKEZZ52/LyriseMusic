/**
 * 远程功能开关
 * 文件：remoteFlags.ts
 *
 * 从 dkyy.top 拉取 /api/feature-flags，用于在服务端关闭某些客户端功能
 * （人声分离、扒谱）。拉取失败或离线时保持上一次已知状态，默认全部开启，
 * 不会因为网络问题误伤正常使用。
 *
 * 两个曾经的坑（2026-11-15 修）：
 * 1. `startRemoteFlags()` 在 `app.whenReady()` 之前就调了 `net.fetch`，
 *    启动时那次拉取必定抛 `Session can only be received when app is ready`，
 *    结果开机后前 10 分钟一直用默认值（全开），后台关功能不生效。
 * 2. 后台改完开关后，客户端要等下一个 10 分钟周期才生效，用户会觉得"开关没用"。
 *    现在功能被判定为关闭时，会先按需拉一次最新状态再下结论。
 */
import { app, net } from 'electron';
import logger from './logger';
import {
  DEFAULT_FEATURE_FLAGS,
  parseFeatureFlags,
  type RemoteFeatureKey,
  type RemoteFeatureFlags,
} from '../shared/featureFlags';

export type { FeatureFlag, RemoteFeatureKey } from '../shared/featureFlags';

interface RemoteFlags {
  features: RemoteFeatureFlags;
  fetchedAt: number;
}

const FLAGS_URL = 'https://dkyy.top/api/feature-flags';
const REFRESH_INTERVAL_MS = 10 * 60 * 1000;
/** 按需刷新的最小间隔，避免反复打开页面把接口打爆 */
const MIN_ON_DEMAND_REFRESH_MS = 5 * 1000;
/** 按需刷新时等待接口的上限，避免卡住 IPC */
const FETCH_TIMEOUT_MS = 5000;

let cache: RemoteFlags = {
  features: { ...DEFAULT_FEATURE_FLAGS },
  fetchedAt: 0,
};
let timer: NodeJS.Timeout | null = null;
let lastFetchAt = 0;
let inflight: Promise<void> | null = null;

export function getRemoteFlags(): RemoteFlags {
  return cache;
}

export function isFeatureEnabled(key: RemoteFeatureKey): boolean {
  return cache.features[key]?.enabled !== false;
}

export function getFeatureMessage(key: RemoteFeatureKey): string {
  return cache.features[key]?.message || '';
}

/**
 * 解析接口响应。只接受 `enabled` 为布尔值的条目，其它一律回落到默认（开启），
 * 这样后台改结构或返回脏数据也不会把用户的功能误关。
 */
async function fetchFlags(): Promise<void> {
  try {
    const response = await net.fetch(FLAGS_URL, {
      // 后台刚改过开关时，别让 HTTP 缓存把旧值喂回来
      cache: 'no-store',
      headers: {
        'User-Agent': 'LyriseMusic-Updater',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      logger.warn('[RemoteFlags] non-ok response', response.status);
      return;
    }
    const data = await response.json();
    const features = parseFeatureFlags(data);
    cache = { features, fetchedAt: Date.now() };
    logger.info('[RemoteFlags] updated', {
      separator: features.separator.enabled,
      scoreflow: features.scoreflow.enabled,
    });
  } catch (error) {
    logger.warn('[RemoteFlags] fetch failed', error);
  }
}

/**
 * 刷新开关状态。
 * - 已有请求在飞：直接复用，不重复发
 * - `force` 时忽略最小间隔（用于"功能被判关闭"时的复核）
 */
export async function refreshRemoteFlags(options: { force?: boolean } = {}): Promise<void> {
  if (inflight) return inflight;
  if (!options.force && Date.now() - lastFetchAt < MIN_ON_DEMAND_REFRESH_MS) return;
  if (!app.isReady()) return;

  inflight = fetchFlags().finally(() => {
    inflight = null;
    lastFetchAt = Date.now();
  });
  return inflight;
}

/**
 * 功能被服务端关闭时抛出带提示的错误。
 * IPC handler 抛出后，渲染层会收到 reject 并把 message 显示出来。
 *
 * 判定为关闭时先按需刷新一次再下结论：后台刚把开关打开的话，用户重新进页面就能用，
 * 不用等下一个 10 分钟周期。
 */
export async function assertFeatureEnabled(key: RemoteFeatureKey): Promise<void> {
  if (isFeatureEnabled(key)) return;

  await refreshRemoteFlags({ force: true });
  if (isFeatureEnabled(key)) return;

  const fallback = key === 'separator' ? '人声分离暂时不可用' : '扒谱暂时不可用';
  throw new Error(getFeatureMessage(key) || fallback);
}

export function startRemoteFlags(): void {
  // 必须等 app ready：net.fetch 之前调用会抛
  // `Session can only be received when app is ready`，启动那次拉取等于白跑。
  void app.whenReady().then(() => {
    void refreshRemoteFlags({ force: true });
    if (timer) clearInterval(timer);
    timer = setInterval(() => void refreshRemoteFlags({ force: true }), REFRESH_INTERVAL_MS);
    // 不阻止应用退出
    (timer as unknown as { unref?: () => void }).unref?.();
  });
}

export function stopRemoteFlags(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
