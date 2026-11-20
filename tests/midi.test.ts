import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildScoreMidi } from '../src/renderer/utils/midi.ts';
import type { ScoreDoc } from '../src/shared/scoreflow.ts';

const doc = {
  meta: {
    title: '测试',
    artist: '',
    duration: 8,
    key_name: '1=C',
    key_root: 0,
    key_mode: 'major',
    bpm: 120,
    beats_per_bar: 4,
    beat_unit: 4,
  },
  measures: [],
  raw_notes: [
    { start: 0, end: 0.5, midi: 60, velocity: 1, confidence: 0.9 },
    { start: 0.5, end: 1, midi: 64, velocity: 1, confidence: 0.9 },
    { start: 1, end: 2, midi: 67, velocity: 1, confidence: 0.9 },
  ],
  pitch_curve: [],
  chords: [{ start: 0, end: 2, root: 0, quality: 'maj', bass: null, score: 1 }],
  lyric_tokens: [],
} as unknown as ScoreDoc;

const readAscii = (bytes: Uint8Array, at: number, len: number) =>
  String.fromCharCode(...bytes.slice(at, at + len));

const u32At = (bytes: Uint8Array, at: number) =>
  (bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3];

test('MIDI 文件头正确', () => {
  const bytes = buildScoreMidi(doc);
  assert.equal(readAscii(bytes, 0, 4), 'MThd');
  assert.equal(u32At(bytes, 4), 6);
  const format = (bytes[8] << 8) | bytes[9];
  const tracks = (bytes[10] << 8) | bytes[11];
  const division = (bytes[12] << 8) | bytes[13];
  assert.equal(format, 1, 'format 1');
  assert.equal(tracks, 3, '速度 + 旋律 + 和弦 三条轨');
  assert.equal(division, 480, 'PPQ 480');
});

test('每条轨道的长度字段与实际字节数一致', () => {
  const bytes = buildScoreMidi(doc);
  let at = 14;
  let count = 0;
  while (at < bytes.length) {
    assert.equal(readAscii(bytes, at, 4), 'MTrk', `第 ${count} 条轨道头`);
    const len = u32At(bytes, at + 4);
    at += 8;
    assert.ok(at + len <= bytes.length, '轨道长度不越界');
    // 轨道末尾必须是 end-of-track
    assert.deepEqual(
      Array.from(bytes.slice(at + len - 3, at + len)),
      [0xff, 0x2f, 0x00],
      '以 end-of-track 收尾',
    );
    at += len;
    count += 1;
  }
  assert.equal(at, bytes.length, '轨道首尾相接，没有多余字节');
  assert.equal(count, 3);
});

test('旋律音符数量：每个音一对 note on/off', () => {
  const bytes = buildScoreMidi(doc, { withChords: false });
  let onCount = 0;
  let offCount = 0;
  for (let i = 0; i < bytes.length - 2; i += 1) {
    // 只看 note on/off 状态字节（跳过 meta 与 running status 的干扰）
    if (bytes[i] === 0x90 && bytes[i + 2] > 0) onCount += 1;
    if (bytes[i] === 0x80) offCount += 1;
  }
  assert.equal(onCount, 3, '3 个 note on');
  assert.equal(offCount, 3, '3 个 note off');
});

test('关闭和弦后只剩两条轨道', () => {
  const bytes = buildScoreMidi(doc, { withChords: false });
  const tracks = (bytes[10] << 8) | bytes[11];
  assert.equal(tracks, 2);
});

test('没有音符时不崩，仍然输出合法文件', () => {
  const empty = { ...doc, raw_notes: [], chords: [] } as unknown as ScoreDoc;
  const bytes = buildScoreMidi(empty);
  assert.equal(readAscii(bytes, 0, 4), 'MThd');
  assert.ok(bytes.length > 14);
});
