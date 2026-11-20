/**
 * LyriseMusic 简谱导出 MIDI
 * 文件：midi.ts
 * 描述：把扒谱结果写成标准 MIDI 文件（SMF format 1），旋律一轨、和弦一轨。
 *
 *       raw_notes 是「秒 + MIDI 音高」，MIDI 走的是 tick，所以按 BPM 换算：
 *       tick = 秒 × (BPM / 60) × PPQ
 *       扒谱引擎的速度恒定（首末锚点核对过 216.69s / 245.5 拍 = 0.8826s/拍），
 *       用平均 BPM 线性换算不会漂。
 * 版权：Copyright © 2026 Dake（知之Dake）. All Rights Reserved.
 */
import type { ScoreChordSpan, ScoreDoc } from '../../shared/scoreflow';

/** 每拍多少个 tick，480 是 DAW 通行的分辨率。 */
const PPQ = 480;

const ascii = (text: string): number[] => Array.from(text, (ch) => ch.charCodeAt(0));
const u16 = (v: number): number[] => [(v >> 8) & 0xff, v & 0xff];
const u32 = (v: number): number[] => [
  (v >>> 24) & 0xff,
  (v >> 16) & 0xff,
  (v >> 8) & 0xff,
  v & 0xff,
];

/** MIDI 变长整数（delta time 用）。 */
function varLen(value: number): number[] {
  let v = Math.max(0, Math.round(value));
  const bytes = [v & 0x7f];
  v >>>= 7;
  while (v > 0) {
    bytes.unshift((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  return bytes;
}

interface NoteEvent {
  tick: number;
  on: boolean;
  pitch: number;
  velocity: number;
}

/** 秒 → tick。 */
function secToTick(sec: number, bpm: number): number {
  return Math.round((Math.max(0, sec) * bpm * PPQ) / 60);
}

/** 和弦性质对应到音程；认不出的按大三和弦处理。 */
const CHORD_INTERVALS: Record<string, number[]> = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10],
  '7': [0, 4, 7, 10],
  dom7: [0, 4, 7, 10],
  m7b5: [0, 3, 6, 10],
  dim7: [0, 3, 6, 9],
  '6': [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
  add9: [0, 4, 7, 14],
};

/** 和弦 ⇒ 一组 MIDI 音高（从 C3 附近往上排）。 */
function chordPitches(span: ScoreChordSpan): number[] {
  const root = 48 + (((span.root % 12) + 12) % 12);
  const intervals = CHORD_INTERVALS[span.quality] ?? CHORD_INTERVALS.maj;
  return intervals.map((i) => root + i).filter((p) => p >= 0 && p <= 127);
}

/** 把音符事件写成一条 MTrk 轨道（含 end-of-track）。 */
function buildTrack(events: NoteEvent[], head: number[] = []): number[] {
  // 同一个 tick 上先关后开，避免相邻同音高的音被吞掉
  const sorted = [...events].sort((a, b) => a.tick - b.tick || (a.on ? 1 : -1));
  const out: number[] = [...head];
  let last = 0;
  for (const e of sorted) {
    out.push(...varLen(e.tick - last));
    if (e.on) out.push(0x90, e.pitch & 0x7f, e.velocity & 0x7f);
    else out.push(0x80, e.pitch & 0x7f, 0x40);
    last = e.tick;
  }
  out.push(...varLen(0), 0xff, 0x2f, 0x00);
  return out;
}

export interface MidiExportOptions {
  /** 是否附带和弦轨，默认带。 */
  withChords?: boolean;
}

/**
 * 把谱面写成 MIDI 文件字节。
 * 轨道布局：0 = 速度，1 = 旋律，2 = 和弦（可选）。
 */
export function buildScoreMidi(doc: ScoreDoc, options: MidiExportOptions = {}): Uint8Array {
  const bpm = Number(doc.meta?.bpm) > 0 ? Number(doc.meta.bpm) : 100;

  const melody: NoteEvent[] = [];
  for (const note of doc.raw_notes ?? []) {
    if (!Number.isFinite(note.midi) || !Number.isFinite(note.start)) continue;
    if (!(note.end > note.start)) continue;
    const pitch = Math.round(note.midi);
    if (pitch < 0 || pitch > 127) continue;
    melody.push({ tick: secToTick(note.start, bpm), on: true, pitch, velocity: 90 });
    melody.push({ tick: secToTick(note.end, bpm), on: false, pitch, velocity: 0 });
  }

  const tracks: number[][] = [];

  // 轨 0：速度
  const tempo = Math.round(60000000 / bpm);
  tracks.push(
    buildTrack(
      [],
      [0x00, 0xff, 0x51, 0x03, (tempo >> 16) & 0xff, (tempo >> 8) & 0xff, tempo & 0xff],
    ),
  );

  // 轨 1：旋律
  tracks.push(buildTrack(melody));

  // 轨 2：和弦
  if (options.withChords !== false) {
    const chordEvents: NoteEvent[] = [];
    for (const span of doc.chords ?? []) {
      if (!Number.isFinite(span.root) || !(span.end > span.start)) continue;
      for (const pitch of chordPitches(span)) {
        chordEvents.push({ tick: secToTick(span.start, bpm), on: true, pitch, velocity: 70 });
        chordEvents.push({ tick: secToTick(span.end, bpm), on: false, pitch, velocity: 0 });
      }
    }
    if (chordEvents.length) tracks.push(buildTrack(chordEvents));
  }

  const bytes: number[] = [];
  bytes.push(...ascii('MThd'), ...u32(6), ...u16(1), ...u16(tracks.length), ...u16(PPQ));
  for (const track of tracks) {
    bytes.push(...ascii('MTrk'), ...u32(track.length), ...track);
  }
  return new Uint8Array(bytes);
}
