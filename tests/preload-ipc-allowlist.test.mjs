import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// preload 有两道通道闸：命令（send/invoke）与事件（on/off）各一张白名单。
// 这里静态比对「渲染层实际用到的通道」与「白名单」，防止新增裸调用绕过闸门后静默失效。
const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const preloadSource = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8');

const readAllowlist = (name) => {
  const match = preloadSource.match(
    new RegExp(`const ${name} = new Set<string>\\(\\[([\\s\\S]*?)\\]\\);`),
  );
  assert.ok(match, `preload 里找不到 ${name}`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]);
};

// 渲染层的裸 ipcRenderer 调用（含可选链与换行），只认字面量通道名。
const RAW_IPC_CALL =
  /(?:\bipcRenderer|(?<![.\w])ipc)\s*\??\.\s*(on|off|send|invoke)\s*\(\s*['"]([^'"]+)['"]/g;

const collectRendererCalls = () => {
  const calls = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!/\.(ts|vue|mjs|js)$/.test(entry.name)) continue;
      const source = readFileSync(path, 'utf8');
      for (const match of source.matchAll(RAW_IPC_CALL)) {
        const line = source.slice(0, match.index).split('\n').length;
        calls.push({ method: match[1], channel: match[2], where: `${path}:${line}` });
      }
    }
  };
  walk(join(projectRoot, 'src/renderer'));
  return calls;
};

test('渲染层用到的每个裸 IPC 命令通道都在 RENDERER_CHANNEL_ALLOWLIST 里', () => {
  const allowed = new Set(readAllowlist('RENDERER_CHANNEL_ALLOWLIST'));
  const commands = collectRendererCalls().filter(
    (call) => call.method === 'send' || call.method === 'invoke',
  );
  assert.ok(commands.length > 0, '没扫到任何渲染层命令通道，扫描规则可能失效了');
  const blocked = commands.filter((call) => !allowed.has(call.channel));
  assert.deepEqual(
    blocked.map((call) => `${call.channel} @ ${call.where}`),
    [],
    '这些通道会被 preload 闸挡掉，调用会静默失效',
  );
});

test('渲染层用到的每个裸 IPC 事件通道都在 RENDERER_EVENT_ALLOWLIST 里', () => {
  const allowed = new Set(readAllowlist('RENDERER_EVENT_ALLOWLIST'));
  const events = collectRendererCalls().filter(
    (call) => call.method === 'on' || call.method === 'off',
  );
  assert.ok(events.length > 0, '没扫到任何渲染层事件通道，扫描规则可能失效了');
  const blocked = events.filter((call) => !allowed.has(call.channel));
  assert.deepEqual(
    blocked.map((call) => `${call.channel} @ ${call.where}`),
    [],
    '这些事件通道会被 preload 闸挡掉，订阅会静默失效',
  );
});

test('命令通道与事件通道是两张独立的白名单，且四个方法都挂了闸', () => {
  const commands = new Set(readAllowlist('RENDERER_CHANNEL_ALLOWLIST'));
  const events = new Set(readAllowlist('RENDERER_EVENT_ALLOWLIST'));
  assert.ok(commands.size > 0 && events.size > 0);
  // 同一个通道既能 subscribe 又能 invoke 属于可疑设计，出现就需要显式复核。
  const both = [...commands].filter((channel) => events.has(channel));
  assert.deepEqual(both, [], '这些通道同时出现在命令表与事件表里');

  const gate = (method) => {
    const start = preloadSource.indexOf(`    ${method}: (channel`);
    assert.ok(start >= 0, `preload 的 ipcRenderer.${method} 结构变了，请同步更新这个测试`);
    const end = preloadSource.indexOf('\n    },', start);
    assert.ok(end > start, `preload 的 ipcRenderer.${method} 结构变了，请同步更新这个测试`);
    return preloadSource.slice(start, end);
  };
  assert.match(gate('send'), /isChannelAllowed\(channel\)/);
  assert.match(gate('invoke'), /isChannelAllowed\(channel\)/);
  assert.match(gate('on'), /isEventAllowed\(channel\)/);
  assert.match(gate('off'), /isEventAllowed\(channel\)/);
});
