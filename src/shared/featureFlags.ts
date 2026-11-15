/**
 * 远程功能开关的纯逻辑
 * 文件：featureFlags.ts
 *
 * 从 /api/feature-flags 的响应里解析出各功能的开关状态。
 * 放在 shared 里是为了能脱离 electron 单测（remoteFlags.ts 需要 net/app）。
 */

export type RemoteFeatureKey = 'separator' | 'scoreflow';

export interface FeatureFlag {
  enabled: boolean;
  message: string;
}

export type RemoteFeatureFlags = Record<RemoteFeatureKey, FeatureFlag>;

/** 默认全部开启：接口挂了或返回脏数据时不能误伤用户 */
export const DEFAULT_FEATURE_FLAGS: RemoteFeatureFlags = {
  separator: { enabled: true, message: '' },
  scoreflow: { enabled: true, message: '' },
};

export const REMOTE_FEATURE_KEYS = Object.keys(DEFAULT_FEATURE_FLAGS) as RemoteFeatureKey[];

/**
 * 解析接口响应。只接受 `enabled` 为布尔值的条目，其它一律回落到默认（开启），
 * 后台改结构或返回脏数据都不会把用户的功能误关。
 */
export const parseFeatureFlags = (data: unknown): RemoteFeatureFlags => {
  const features: RemoteFeatureFlags = {
    separator: { ...DEFAULT_FEATURE_FLAGS.separator },
    scoreflow: { ...DEFAULT_FEATURE_FLAGS.scoreflow },
  };
  const source = (data as { features?: Record<string, unknown> } | null)?.features;
  if (!source || typeof source !== 'object') return features;

  for (const key of REMOTE_FEATURE_KEYS) {
    const raw = (source as Record<string, unknown>)[key] as
      | { enabled?: unknown; message?: unknown }
      | undefined;
    if (!raw || typeof raw !== 'object') continue;
    if (typeof raw.enabled !== 'boolean') continue;
    features[key] = {
      enabled: raw.enabled,
      message: typeof raw.message === 'string' ? raw.message : '',
    };
  }
  return features;
};
