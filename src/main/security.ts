import { session, shell, type WebContents } from 'electron';
import log from './logger';
import { withImageCorsHeader } from './imageCors';

/**
 * 安全加固（P0）
 *
 * 1. CSP：只允许 self + 可信的验证码域，禁止 eval / object / 外部 frame
 * 2. 导航拦截：窗口只能停留在应用自己的页面，外链交给系统浏览器
 * 3. 权限：只放行音频采集（语聊房），其它一律拒绝
 *
 * 说明：index.html 里有一段内联脚本负责首帧主题，为避免闪白保留了
 * 'unsafe-inline'；但外部脚本仍被限制在 self 与腾讯验证码域内。
 */

import { CONTENT_SECURITY_POLICY } from '../shared/csp';

export function installSecurityHardening(isDev: boolean): void {
  const defaultSession = session.defaultSession;

  // 权限：只给音频（麦克风）开口子，摄像头/通知/剪贴板等一律拒绝
  defaultSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    const mediaTypes = (details as { mediaTypes?: string[] } | undefined)?.mediaTypes ?? [];
    const isAudioCapture =
      permission === 'media' && mediaTypes.includes('audio') && !mediaTypes.includes('video');
    if (isAudioCapture) {
      callback(true);
      return;
    }
    log.warn('[Security] 拒绝权限请求:', permission);
    callback(false);
  });

  defaultSession.setPermissionCheckHandler((_webContents, permission, _origin, details) => {
    if (permission !== 'media') return false;
    const mediaType = (details as { mediaType?: string } | undefined)?.mediaType;
    return mediaType === 'audio' || mediaType === undefined;
  });

  // 响应头只在生产构建里加 CSP；开发服务器需要 Vite 的 HMR/eval。
  //
  // ⚠️ Electron 的 webRequest 同一事件只认**最后注册**的监听器，重复注册会
  // 静默顶掉前一个。所以这里一个监听器同时负责两件事：
  //   1. 生产构建的 CSP 响应头
  //   2. 图片响应的 Access-Control-Allow-Origin（封面取色要读 canvas 像素，
  //      不补这个头 canvas 会被跨域污染，取色永远失败、主题色不动）
  // 之前 imageCors.ts 也注册了一个，结果先注册的 CSP 被顶掉，生产环境等于没加。
  defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const url = details.url ?? '';
    let responseHeaders: Record<string, string[]> = { ...(details.responseHeaders ?? {}) };
    if (!isDev && /^https?:/i.test(url)) {
      responseHeaders['Content-Security-Policy'] = [CONTENT_SECURITY_POLICY];
    }
    responseHeaders = withImageCorsHeader(details.resourceType, responseHeaders);
    callback({ responseHeaders });
  });
}

const isInternalPage = (target: string, devOrigin: string | null): boolean => {
  try {
    const url = new URL(target);
    if (url.protocol === 'file:') return true;
    if (devOrigin && url.origin === devOrigin) return true;
    // 应用内偶发使用 about:blank（打印、临时页面）
    if (url.protocol === 'about:') return true;
    return false;
  } catch {
    return false;
  }
};

/**
 * 给窗口装上「禁止任意导航」与「外链走系统浏览器」。
 * 返回卸载函数（窗口销毁时自行断开，这里仅为对称）。
 */
export function hardenWebContents(
  contents: WebContents,
  options: { devOrigin?: string | null; allowExternal?: boolean } = {},
): void {
  const devOrigin = options.devOrigin ?? null;
  const allowExternal = options.allowExternal !== false;

  contents.setWindowOpenHandler(({ url }) => {
    if (allowExternal && /^https:/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  contents.on('will-navigate', (event, target) => {
    if (isInternalPage(target, devOrigin)) return;
    event.preventDefault();
    log.warn('[Security] 已阻止导航:', target);
    if (allowExternal && /^https:/i.test(target)) void shell.openExternal(target);
  });

  contents.on('will-redirect', (event, target) => {
    if (isInternalPage(target, devOrigin)) return;
    event.preventDefault();
    log.warn('[Security] 已阻止重定向:', target);
  });

  // 禁止创建 webview（当前版本未使用，防止后续被注入）
  contents.on('will-attach-webview', (event) => {
    event.preventDefault();
    log.warn('[Security] 已阻止 webview 挂载');
  });
}
