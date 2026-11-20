<script setup lang="ts">
/**
 * 音高块：把扒谱引擎检测到的原始音符画成钢琴卷帘式的横向块，铺在简谱下方。
 *
 * 与简谱同宽、同 dpr，塞进 .sheet-stage 里就天然共享横向滚动，不需要同步 scrollLeft。
 *
 * 音符时间是「秒」，简谱坐标是「拍」，这里按 BPM 换算。扒谱引擎的速度恒定，
 * 用首末锚点核对过：216.69s / 245.5 拍 = 0.8826s/拍，理论 60/68 = 0.8824s/拍。
 *
 * 注意：简谱每小节的宽度是按音符密度自适应的（170–460px），所以块会被非均匀拉伸——
 * 拍与拍之间对得准，但曲线形状会随小节密度变化。这是共享滚动换来的代价。
 */
import { onMounted, ref, watch } from 'vue';
import type { ScoreMeasure, ScoreRawNote } from '../../shared/scoreflow';
import type { ScoreLayout, ScoreTheme } from '@/utils/jianpu';

const props = withDefaults(
  defineProps<{
    notes: ScoreRawNote[];
    layout: ScoreLayout;
    measures: ScoreMeasure[];
    bpm: number;
    theme: ScoreTheme;
    dpr?: number;
    height?: number;
  }>(),
  { dpr: 1, height: 84 },
);

const canvasRef = ref<HTMLCanvasElement | null>(null);

const PAD_TOP = 8;
const PAD_BOTTOM = 6;
const BLOCK_H = 5;

/** 纵轴范围：实际音高上下各留两个半音。 */
function midiRange(): { lo: number; hi: number } | null {
  const values = props.notes.map((n) => n.midi).filter((m) => Number.isFinite(m) && m > 0);
  if (!values.length) return null;
  return { lo: Math.min(...values) - 2, hi: Math.max(...values) + 2 };
}

/** 拍 → 简谱横向坐标：先找所在小节，再按小节内比例插值。 */
function beatToX(beat: number): number {
  const bars = props.layout.bars;
  const measures = props.measures;
  for (let i = 0; i < measures.length; i += 1) {
    const measure = measures[i];
    const bar = bars[i];
    if (!bar) break;
    if (beat < measure.start_beat + measure.beats) {
      const ratio = Math.max(0, (beat - measure.start_beat) / Math.max(1, measure.beats));
      return bar.x + ratio * bar.w;
    }
  }
  const lastBar = bars[bars.length - 1];
  return lastBar ? lastBar.x + lastBar.w : 0;
}

function draw() {
  const canvas = canvasRef.value;
  const range = midiRange();
  if (!canvas || !range || !props.notes.length) return;

  const dpr = props.dpr;
  const width = props.layout.width;
  const height = props.height;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${Math.round(width)}px`;
  canvas.style.height = `${height}px`;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const drawHeight = height - PAD_TOP - PAD_BOTTOM;
  const { lo, hi } = range;
  const yOf = (midi: number) => PAD_TOP + ((hi - midi) / (hi - lo)) * drawHeight;

  // 八度参考线：只画 C，够看清音区
  ctx.strokeStyle = props.theme.rule;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 1;
  for (let midi = Math.ceil(lo / 12) * 12; midi <= hi; midi += 12) {
    const y = Math.round(yOf(midi)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // 音符块：拍 = 秒 × BPM / 60
  const beatsPerSecond = props.bpm / 60;
  ctx.fillStyle = props.theme.accent;
  for (const note of props.notes) {
    if (!Number.isFinite(note.midi) || !Number.isFinite(note.start)) continue;
    const x0 = beatToX(note.start * beatsPerSecond);
    const x1 = beatToX(note.end * beatsPerSecond);
    const blockWidth = Math.max(2, x1 - x0);
    const y = yOf(note.midi);
    // 引擎没把握的音降低透明度，一眼能看出哪些点不可信
    ctx.globalAlpha = note.confidence >= 0.4 ? 0.9 : 0.45;
    ctx.beginPath();
    ctx.roundRect(x0, y - BLOCK_H / 2, blockWidth, BLOCK_H, BLOCK_H / 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

onMounted(draw);
watch(() => props.notes, draw);
watch(() => props.layout, draw);
watch(() => [props.theme.accent, props.theme.rule, props.dpr, props.height], draw);
</script>

<template>
  <canvas ref="canvasRef" class="pitch-roll" :height="height" />
</template>

<style scoped>
.pitch-roll {
  display: block;
}
</style>
