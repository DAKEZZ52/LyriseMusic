import { session } from 'electron';
import log from './logger';

/**
 * 封面取色需要 canvas 读取跨域图片。
 *
 * 以前的做法是给窗口设置 `webSecurity: false`，但那等于关掉整个渲染进程的
 * 同源策略。改成只在图片响应上补 `Access-Control-Allow-Origin`：
 * `<img crossOrigin="anonymous">` 拿到该响应头后 canvas 就不会被污染，
 * 其它资源（脚本、iframe、fetch）仍然受同源策略保护。
 *
 * ⚠️ Electron 的 `webRequest` 同一个事件只认最后一次注册的监听器
 * （见 src/main/security.ts 的合并说明）。所以主窗口用的 defaultSession
 * 不能再单独装一个 onHeadersReceived，图片响应头由 security.ts 里那个
 * 唯一的监听器调用 withImageCorsHeader() 补上。
 */
const WINDOW_SESSION_PARTITIONS = ['persist:mini-player', 'persist:desktop-lyric'];

/** 图片资源类型（Electron webRequest 的 resourceType 取值） */
const IMAGE_RESOURCE_TYPE = 'image';

/** 给图片响应补上 ACAO；非图片资源、或响应已自带 ACAO 时原样返回。 */
export const withImageCorsHeader = (
  resourceType: string | undefined,
  headers: Record<string, string[]>,
): Record<string, string[]> => {
  if (resourceType !== IMAGE_RESOURCE_TYPE) return headers;

  // CDN（如 imge.kugou.com）本身就会回 `Access-Control-Allow-Origin: *`。
  // 再叠加一个会变成 `*, *`，浏览器按 CORS 规范直接拒绝，封面取色就永远失败。
  const alreadyAllowsCors = Object.keys(headers).some(
    (key) => key.toLowerCase() === 'access-control-allow-origin',
  );
  if (alreadyAllowsCors) return headers;

  return { ...headers, 'Access-Control-Allow-Origin': ['*'] };
};

const allowCrossOriginImageRead = (target: Electron.Session, label: string): void => {
  try {
    target.webRequest.onHeadersReceived(
      { urls: ['http://*/*', 'https://*/*'], types: [IMAGE_RESOURCE_TYPE] },
      (details, callback) => {
        callback({
          responseHeaders: withImageCorsHeader(details.resourceType, {
            ...(details.responseHeaders ?? {}),
          }),
        });
      },
    );
  } catch (error) {
    log.warn(`[CORS] Failed to install image header rule for ${label}`, error);
  }
};

/**
 * 给迷你播放器与桌面歌词窗口补图片 CORS。
 * 主窗口（defaultSession）由 `installSecurityHardening` 统一处理，这里不再重复注册，
 * 否则会把 CSP 的那个监听器顶掉。
 */
export const installImageCorsHeaders = (): void => {
  for (const partition of WINDOW_SESSION_PARTITIONS) {
    allowCrossOriginImageRead(session.fromPartition(partition), partition);
  }
};
