/**
 * LyriseMusic 注册表卸载项解析
 * 文件：registryUninstall.ts
 * 描述：把 `reg query` 的输出解析成卸载项记录，并按历史产品名前缀筛选出需要清理的旧版安装。
 *       纯函数，不依赖 electron / 子进程，便于单测。
 */

/** 一条卸载项记录（DisplayName / UninstallString 均为注册表原值） */
export interface UninstallRecord {
  displayName: string;
  uninstallString: string;
}

/**
 * 解析 `reg query <key> /s /f <word> /t REG_SZ` 的 stdout。
 *
 * 输出形如：
 * ```
 * HKEY_CURRENT_USER\Software\...\Uninstall\{GUID}
 *     DisplayName    REG_SZ    DakeMusic 2.4.8
 *     UninstallString    REG_SZ    "C:\...\Uninstall DakeMusic.exe"
 * ```
 * 键名行顶格、值行缩进，所以按「顶格行 = 新键」切块，一个键里可能同时出现多个匹配项。
 */
export const parseUninstallRecords = (stdout: string): UninstallRecord[] => {
  const records: UninstallRecord[] = [];
  let current: UninstallRecord | null = null;

  const flush = () => {
    if (current && (current.displayName || current.uninstallString)) records.push(current);
    current = null;
  };

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line.trim()) continue;

    // 顶格行是键名（或 "End of search: N match(es) found."），开新块
    if (!/^\s/.test(line)) {
      flush();
      current = { displayName: '', uninstallString: '' };
      continue;
    }

    const value = line.trim();
    const displayName = /^DisplayName\s+REG_SZ\s+(.*)$/i.exec(value);
    if (displayName) {
      if (!current) current = { displayName: '', uninstallString: '' };
      current.displayName = displayName[1].trim();
      continue;
    }

    const uninstallString = /^UninstallString\s+REG_SZ\s+(.*)$/i.exec(value);
    if (uninstallString) {
      if (!current) current = { displayName: '', uninstallString: '' };
      current.uninstallString = uninstallString[1].trim();
    }
  }

  flush();
  return records;
};

/**
 * 按显示名前缀筛出旧版安装项。
 *
 * - 只保留有 UninstallString 的记录（没有卸载器就没法静默清理）
 * - 前缀不区分大小写
 * - 按卸载命令去重：同一个卸载器命中多个前缀/多个注册表根时只清理一次
 */
export const selectLegacyInstalls = (
  records: readonly UninstallRecord[],
  prefixes: readonly string[],
): UninstallRecord[] => {
  const seen = new Set<string>();
  const selected: UninstallRecord[] = [];

  for (const record of records) {
    const uninstallString = record.uninstallString.trim();
    if (!uninstallString) continue;

    const displayName = record.displayName.trim().toLowerCase();
    if (!prefixes.some((prefix) => displayName.startsWith(prefix.toLowerCase()))) continue;

    const identity = uninstallString.toLowerCase();
    if (seen.has(identity)) continue;
    seen.add(identity);
    selected.push({ displayName: record.displayName, uninstallString });
  }

  return selected;
};
