/**
 * 全局开关（当前只有语聊房维护模式）
 * 文件：config/flags.json，改动后 2 秒内热生效，无需重启
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, 'config', 'flags.json');

const FEATURE_DEFAULT = { enabled: true, message: '' };

const DEFAULT = {
  webroom: { mode: 'open', message: '', updatedAt: 0, updatedBy: '' },
  features: {
    separator: { ...FEATURE_DEFAULT },
    scoreflow: { ...FEATURE_DEFAULT },
  },
};

let cache = load();

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    const features = {};
    for (const key of Object.keys(DEFAULT.features)) {
      features[key] = { ...DEFAULT.features[key], ...((raw.features || {})[key] || {}) };
    }
    return {
      ...DEFAULT,
      ...raw,
      webroom: { ...DEFAULT.webroom, ...(raw.webroom || {}) },
      features,
    };
  } catch {
    return { ...DEFAULT };
  }
}

export const getFlags = () => cache;

export function setWebroom(patch, by = 'admin') {
  cache = {
    webroom: {
      ...cache.webroom,
      ...patch,
      updatedAt: Date.now(),
      updatedBy: by,
    },
  };
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(cache, null, 2) + '\n');
  return cache;
}

export const isWebroomClosed = () => cache.webroom.mode !== 'open';

export function setFeatures(patch, by = 'admin') {
  const next = { ...cache.features };
  for (const [key, value] of Object.entries(patch || {})) {
    if (!next[key]) continue;
    next[key] = {
      ...next[key],
      ...(typeof value.enabled === 'boolean' ? { enabled: value.enabled } : {}),
      ...(typeof value.message === 'string' ? { message: value.message.slice(0, 200) } : {}),
      // 与 webroom 一致：记下是谁改的，管理后台会传管理员名进来
      updatedAt: Date.now(),
      updatedBy: by,
    };
  }
  cache = { ...cache, features: next };
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(cache, null, 2) + '\n');
  return cache;
}

/** 客户端用：功能是否开放 */
export const isFeatureEnabled = (key) => cache.features?.[key]?.enabled !== false;
export const getFeatureMessage = (key) => cache.features?.[key]?.message || '';

fs.watchFile(FILE, { interval: 2000 }, () => {
  cache = load();
});