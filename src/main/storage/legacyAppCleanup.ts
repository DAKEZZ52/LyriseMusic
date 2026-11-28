/**
 * LyriseMusic 旧版应用清理
 * 描述：品牌改名后 appId 变化（com.dake.dakemusic → com.lyrise.music），Windows 会把
 * 旧版与新版当成两个软件。用户升级后旧版仍留在系统里，需要在首次启动时静默卸载。
 *
 * NSIS 安装器里遍历卸载项受 label 作用域限制，改在主进程完成：
 * electron-builder 的卸载项键名是生成的 GUID，只能按 DisplayName 前缀识别。
 */
import { execFile } from 'child_process';
import { app } from 'electron';
import { existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  parseUninstallRecords,
  selectLegacyInstalls,
  type UninstallRecord,
} from './registryUninstall';

/** 历史产品的显示名前缀（DisplayName 形如 "DakeMusic 2.4.8"） */
const LEGACY_DISPLAY_NAME_PREFIXES = ['DakeMusic', 'EchoMusic'] as const;

/** 清理完成标记，避免每次启动都扫描注册表 */
const CLEANUP_MARKER = '.legacy-app-cleaned';

/** 卸载项可能落在的三个注册表位置 */
const HIVE_ROOTS = [
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
] as const;

export type LegacyInstallEntry = UninstallRecord;

/**
 * 通过 reg query 列出卸载项（含 DisplayName / UninstallString）。
 *
 * 每个「注册表根 × 历史前缀」都要查一次：`/f` 只做字面量匹配，
 * 只查 DakeMusic 的话，DisplayName 为 "EchoMusic ..." 的安装永远找不到。
 */
export const findLegacyInstalls = (): Promise<LegacyInstallEntry[]> =>
  new Promise((resolve) => {
    const records: UninstallRecord[] = [];
    const searches = HIVE_ROOTS.flatMap((root) =>
      LEGACY_DISPLAY_NAME_PREFIXES.map((prefix) => ({ root, prefix })),
    );
    let pending = searches.length;

    for (const { root, prefix } of searches) {
      execFile(
        'reg',
        ['query', root, '/s', '/f', prefix, '/t', 'REG_SZ'],
        { windowsHide: true },
        (error, stdout) => {
          if (!error && stdout) records.push(...parseUninstallRecords(stdout));
          pending -= 1;
          if (pending === 0) resolve(selectLegacyInstalls(records, LEGACY_DISPLAY_NAME_PREFIXES));
        },
      );
    }
  });

const normalizeUninstallerPath = (value: string) => {
  const trimmed = value.trim();
  const quoted = /^"([^"]+)"/.exec(trimmed);
  if (quoted) return { file: quoted[1], args: trimmed.slice(quoted[0].length).trim() };
  const [file, ...rest] = trimmed.split(/\s+/);
  return { file, args: rest.join(' ') };
};

/** 静默卸载一个旧版安装 */
const uninstallLegacy = (entry: LegacyInstallEntry) =>
  new Promise<void>((resolve) => {
    const { file } = normalizeUninstallerPath(entry.uninstallString);
    if (!file || !existsSync(file)) {
      resolve();
      return;
    }
    execFile(file, ['/S'], { windowsHide: true, timeout: 60_000 }, () => resolve());
  });

/**
 * 首次启动时清理旧版安装。打包版才执行；带标记文件保证只跑一次。
 */
export const cleanupLegacyApps = async (): Promise<void> => {
  if (!app.isPackaged || process.platform !== 'win32') return;

  let markerPath: string;
  try {
    markerPath = join(app.getPath('userData'), CLEANUP_MARKER);
  } catch {
    return;
  }
  if (existsSync(markerPath)) return;

  try {
    const legacy = await findLegacyInstalls();
    for (const entry of legacy) {
      await uninstallLegacy(entry);
    }
    if (legacy.length > 0) {
      console.log(`[LegacyCleanup] 已卸载 ${legacy.length} 个旧版安装`);
    }
  } catch (error) {
    console.warn('[LegacyCleanup] 清理旧版安装失败:', error);
  }

  try {
    writeFileSync(markerPath, `${Date.now()}\n`, 'utf8');
  } catch {
    // 标记写入失败最多导致下次再扫一次
  }
};

/** 供测试/调试使用的注册表扫描（不卸载） */
export const listLegacyInstalls = findLegacyInstalls;

/** 用户选择「不再提示」后写入，避免每次启动都弹 */
const ENV_WARN_MARKER = '.legacy-env-warned';

export interface LegacyEnvironmentFinding {
  /** 人类可读的残留描述，直接展示给用户 */
  label: string;
  /** 类型：安装记录 / 安装目录 / 配置目录 */
  kind: 'registry' | 'install-dir' | 'data-dir';
  /** 具体路径或名称 */
  target: string;
}

/**
 * 扫描旧版本残留：注册表卸载项 + 安装目录 + 配置目录。
 *
 * 光看注册表不够 —— 旧版本残留经常是「卸载了但目录还在」，
 * 那种情况下用户打开的还是旧 exe，界面自然是旧的。
 */
export const detectLegacyEnvironment = async (): Promise<LegacyEnvironmentFinding[]> => {
  const findings: LegacyEnvironmentFinding[] = [];

  try {
    const installs = await findLegacyInstalls();
    for (const entry of installs) {
      const name = entry.displayName || '未知名称';
      findings.push({ label: `安装记录：${name}`, kind: 'registry', target: name });
    }
  } catch {
    // 注册表查不到不影响目录扫描
  }

  const programRoot = join(process.env.LOCALAPPDATA ?? '', 'Programs');
  const roamingRoot = process.env.APPDATA ?? '';

  for (const name of LEGACY_DISPLAY_NAME_PREFIXES) {
    const installDir = join(programRoot, name);
    if (programRoot && existsSync(installDir)) {
      findings.push({ label: `安装目录：${installDir}`, kind: 'install-dir', target: installDir });
    }
    const dataDir = join(roamingRoot, name);
    if (roamingRoot && existsSync(dataDir)) {
      findings.push({ label: `配置目录：${dataDir}`, kind: 'data-dir', target: dataDir });
    }
  }

  return findings;
};

/**
 * 发现旧版本残留时弹一次系统对话框。
 *
 * 用主进程的系统对话框而不是页内弹窗：这一步可能在首屏之外，
 * 系统对话框能保证用户一定看见，且不依赖渲染层是否已经就绪。
 */
export const warnLegacyEnvironment = async (): Promise<void> => {
  if (!app.isPackaged || process.platform !== 'win32') return;

  let markerPath: string;
  try {
    markerPath = join(app.getPath('userData'), ENV_WARN_MARKER);
  } catch {
    return;
  }
  if (existsSync(markerPath)) return;

  const findings = await detectLegacyEnvironment().catch(() => []);
  // 只有配置目录残留不算：用户可能从旧版迁移过歌单，那目录本来就该留着。
  // 真正要提醒的是「还装着旧版」——注册表有记录，或安装目录还在。
  if (!findings.some((item) => item.kind !== 'data-dir')) return;

  const { dialog } = await import('electron');
  const detail = [
    '旧版本的界面与数据和新版本不通用，同时装两个可能出现功能异常、界面缺项。',
    '',
    ...findings.map((item) => `· ${item.label}`),
    '',
    '建议到「设置 → 应用」里卸载旧版本，必要时手动删掉上面列出的目录，然后重启本应用。',
  ].join('\n');

  const { response } = await dialog.showMessageBox({
    type: 'warning',
    title: '发现旧版本残留',
    message: '这台电脑上还装着旧版本',
    detail,
    buttons: ['知道了', '不再提示'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });

  if (response === 1) {
    try {
      writeFileSync(markerPath, `${Date.now()}\n`, 'utf8');
    } catch {
      // 写不进去最多下次再提示一次
    }
  }
};
