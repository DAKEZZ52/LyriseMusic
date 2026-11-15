import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parseUninstallRecords,
  selectLegacyInstalls,
} from '../src/main/storage/registryUninstall.ts';

const PREFIXES = ['DakeMusic', 'EchoMusic'];

test('parses a single legacy install from reg query output', () => {
  const stdout = [
    '',
    'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{1F2E3D4C}',
    '    DisplayName    REG_SZ    DakeMusic 2.4.8',
    '    DisplayVersion    REG_SZ    2.4.8',
    '    UninstallString    REG_SZ    "C:\\Program Files\\DakeMusic\\Uninstall DakeMusic.exe"',
    '',
    'End of search: 1 match(es) found.',
    '',
  ].join('\r\n');

  const records = parseUninstallRecords(stdout);
  assert.deepEqual(records, [
    {
      displayName: 'DakeMusic 2.4.8',
      uninstallString: '"C:\\Program Files\\DakeMusic\\Uninstall DakeMusic.exe"',
    },
  ]);
  assert.deepEqual(selectLegacyInstalls(records, PREFIXES), records);
});

test('keeps every matching key when one query returns several', () => {
  const stdout = [
    'HKEY_LOCAL_MACHINE\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{AAA}',
    '    DisplayName    REG_SZ    DakeMusic 2.4.5',
    '    UninstallString    REG_SZ    "C:\\Old\\DakeMusic\\Uninstall.exe"',
    'HKEY_LOCAL_MACHINE\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{BBB}',
    '    DisplayName    REG_SZ    DakeMusic 2.4.8',
    '    UninstallString    REG_SZ    "C:\\New\\DakeMusic\\Uninstall.exe"',
    'End of search: 2 match(es) found.',
  ].join('\n');

  const selected = selectLegacyInstalls(parseUninstallRecords(stdout), PREFIXES);
  assert.deepEqual(
    selected.map((item) => item.displayName),
    ['DakeMusic 2.4.5', 'DakeMusic 2.4.8'],
  );
});

test('an EchoMusic install is selectable, not just a DakeMusic one', () => {
  const records = parseUninstallRecords(
    [
      'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{CCC}',
      '    DisplayName    REG_SZ    EchoMusic 2.2.0',
      '    UninstallString    REG_SZ    C:\\Echo\\Uninstall EchoMusic.exe',
    ].join('\n'),
  );

  assert.deepEqual(selectLegacyInstalls(records, PREFIXES), [
    { displayName: 'EchoMusic 2.2.0', uninstallString: 'C:\\Echo\\Uninstall EchoMusic.exe' },
  ]);
});

test('prefix matching is case-insensitive and ignores unrelated products', () => {
  const records = parseUninstallRecords(
    [
      'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{DDD}',
      '    DisplayName    REG_SZ    dakemusic 2.4.8',
      '    UninstallString    REG_SZ    C:\\A\\Uninstall.exe',
      'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{EEE}',
      '    DisplayName    REG_SZ    SomeOtherPlayer 1.0',
      '    UninstallString    REG_SZ    C:\\B\\Uninstall.exe',
    ].join('\n'),
  );

  const selected = selectLegacyInstalls(records, PREFIXES);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].displayName, 'dakemusic 2.4.8');
});

test('entries without an uninstaller are dropped and identical installers are deduplicated', () => {
  const records = parseUninstallRecords(
    [
      'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{FFF}',
      '    DisplayName    REG_SZ    DakeMusic 2.4.8',
      'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{GGG}',
      '    DisplayName    REG_SZ    DakeMusic 2.4.7',
      '    UninstallString    REG_SZ    C:\\Same\\Uninstall.exe',
      'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{HHH}',
      '    DisplayName    REG_SZ    DakeMusic 2.4.6',
      '    UninstallString    REG_SZ    c:\\same\\uninstall.exe',
    ].join('\n'),
  );

  const selected = selectLegacyInstalls(records, PREFIXES);
  assert.equal(selected.length, 1, '同一个卸载器只清理一次，缺 UninstallString 的条目被丢弃');
  assert.equal(selected[0].uninstallString, 'C:\\Same\\Uninstall.exe');
});

test('an empty search result yields nothing instead of a phantom record', () => {
  const records = parseUninstallRecords('End of search: 0 match(es) found.\r\n');
  assert.deepEqual(records, []);
  assert.deepEqual(selectLegacyInstalls(records, PREFIXES), []);
});

test('malformed output never throws and keeps whatever it could read', () => {
  const records = parseUninstallRecords(
    [
      '    DisplayName    REG_SZ    DakeMusic 2.4.8',
      '    UninstallString    REG_SZ',
      'garbage line without REG_SZ',
    ].join('\n'),
  );

  assert.deepEqual(records, [{ displayName: 'DakeMusic 2.4.8', uninstallString: '' }]);
  assert.deepEqual(selectLegacyInstalls(records, PREFIXES), []);
});
