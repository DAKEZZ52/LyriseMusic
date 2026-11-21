import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { findDuplicates } from '../src/main/media/duplicateFinder.ts';
import type { LocalAudioFile, LocalMusicLibrary } from '../src/shared/localMusic.ts';

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lyrise-dup-'));
after(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

/** 造一个文件并返回它的路径。 */
function makeFile(name: string, content: string): string {
  const target = path.join(workDir, name);
  fs.writeFileSync(target, content);
  return target;
}

/** 按真实库结构拼一条记录。文件可能已被删掉（测「文件消失」场景），这里不报错。 */
function entry(filePath: string, extra: Partial<LocalAudioFile> = {}): LocalAudioFile {
  const exists = fs.existsSync(filePath);
  return {
    name: path.basename(filePath),
    path: filePath,
    size: exists ? fs.statSync(filePath).size : 1024,
    modifiedAt: Date.now(),
    extension: path.extname(filePath).slice(1),
    relativePath: path.basename(filePath),
    title: extra.title ?? path.basename(filePath, path.extname(filePath)),
    artist: extra.artist,
    duration: extra.duration,
    album: extra.album,
  } as LocalAudioFile;
}

function library(files: LocalAudioFile[]): LocalMusicLibrary {
  return {
    id: 'lib-1',
    root: workDir,
    name: '测试库',
    kind: 'folder',
    addedAt: Date.now(),
    scannedAt: Date.now(),
    files,
  } as LocalMusicLibrary;
}

test('字节完全相同的文件会被归到 identical 组', async () => {
  const a = makeFile('same-a.mp3', 'x'.repeat(4096));
  const b = makeFile('same-b.mp3', 'x'.repeat(4096));
  const c = makeFile('other.mp3', 'y'.repeat(4096));

  const groups = await findDuplicates([library([entry(a), entry(b), entry(c)])]);

  const identical = groups.filter((group) => group.reason === 'identical');
  assert.equal(identical.length, 1);
  assert.equal(identical[0].files.length, 2);
  const paths = identical[0].files.map((file) => file.path).sort();
  assert.deepEqual(paths, [a, b].sort());
  // c 内容不同，不该被归进来
  assert.ok(!identical[0].files.some((file) => file.path === c));
});

test('同曲不同码率（内容不同但标题歌手时长一致）归到 same-track 组', async () => {
  const mp3 = makeFile('track-lossy.mp3', 'a'.repeat(2048));
  const flac = makeFile('track-lossless.flac', 'b'.repeat(8192));

  const groups = await findDuplicates([
    library([
      entry(mp3, { title: '晴天', artist: '周杰伦', duration: 269.4 }),
      entry(flac, { title: '晴天', artist: '周杰伦', duration: 269.8 }),
    ]),
  ]);

  const sameTrack = groups.filter((group) => group.reason === 'same-track');
  assert.equal(sameTrack.length, 1);
  assert.equal(sameTrack[0].files.length, 2);
  // 无损优先保留
  assert.equal(sameTrack[0].keepPath, flac);
});

test('时长差超过容差不算同一首', async () => {
  const a = makeFile('diff-1.mp3', 'c'.repeat(1024));
  const b = makeFile('diff-2.mp3', 'd'.repeat(1024));

  const groups = await findDuplicates([
    library([
      entry(a, { title: '同名歌', artist: '某人', duration: 200 }),
      entry(b, { title: '同名歌', artist: '某人', duration: 240 }),
    ]),
  ]);

  assert.equal(groups.length, 0, '8 秒差距不该判为重复');
});

test('标题里的现场版/重制版标记会被忽略', async () => {
  const a = makeFile('live-a.mp3', 'e'.repeat(1024));
  const b = makeFile('live-b.flac', 'f'.repeat(2048));

  const groups = await findDuplicates([
    library([
      entry(a, { title: '后来 (Live)', artist: '刘若英', duration: 300 }),
      entry(b, { title: '后来', artist: '刘若英', duration: 300.5 }),
    ]),
  ]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].reason, 'same-track');
});

test('没有重复时返回空数组', async () => {
  const a = makeFile('solo-1.mp3', 'g'.repeat(512));
  const b = makeFile('solo-2.mp3', 'h'.repeat(512));

  const groups = await findDuplicates([
    library([
      entry(a, { title: '甲', artist: 'A', duration: 100 }),
      entry(b, { title: '乙', artist: 'B', duration: 200 }),
    ]),
  ]);

  assert.deepEqual(groups, []);
});

test('文件已被删除时跳过，不会让整次扫描失败', async () => {
  const alive = makeFile('alive.mp3', 'i'.repeat(1024));
  const missing = path.join(workDir, 'gone.mp3');

  const groups = await findDuplicates([
    library([entry(alive, { title: '在', duration: 100 }), entry(missing, { title: '没了' })]),
  ]);

  assert.equal(groups.length, 0);
});
