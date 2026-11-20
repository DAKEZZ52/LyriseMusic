<script setup lang="ts">
/**
 * 和弦进行条：把每小节的和弦符号按横向小节铺开，像吉他谱顶上的和弦行。
 *
 * 谱面里本来就画了和弦（小字标在每小节上方），但太小、又挤在音符之间，
 * 弹唱时想快速扫一眼走向并不方便。这条用大字独立成行，和谱面共享横向滚动。
 *
 * 用 DOM 而不是 canvas：文字能选中、能缩放，62 个小节的节点量也很轻。
 */
import type { ScoreMeasure } from '../../shared/scoreflow';
import type { ScoreBarBox } from '@/utils/jianpu';

const props = defineProps<{
  measures: ScoreMeasure[];
  bars: ScoreBarBox[];
  /** 当前播放到的小节下标，-1 表示不在播放。 */
  currentBar?: number;
}>();

/** 小节起点坐标；bars 与 measures 同序，越界时退回 0。 */
function barX(index: number): number {
  return props.bars[index]?.x ?? 0;
}
function barW(index: number): number {
  return props.bars[index]?.w ?? 0;
}
</script>

<template>
  <div class="chord-bar">
    <div
      v-for="(measure, index) in measures"
      :key="measure.index"
      class="chord-cell"
      :class="{ active: index === currentBar, silent: !measure.chord?.symbol }"
      :style="{ left: `${barX(index)}px`, width: `${barW(index)}px` }"
    >
      <span v-if="measure.chord?.symbol">{{ measure.chord.symbol }}</span>
      <span v-else class="rest">·</span>
    </div>
  </div>
</template>

<style scoped>
.chord-bar {
  position: relative;
  height: 34px;
  display: block;
}
.chord-cell {
  position: absolute;
  top: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-left: 1px solid var(--content-panel-border);
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-main);
  white-space: nowrap;
  transition: background-color 0.15s ease;
}
.chord-cell:first-child {
  border-left: 0;
}
.chord-cell.silent {
  color: var(--text-secondary);
  font-weight: 400;
  opacity: 0.5;
}
.chord-cell.active {
  background: color-mix(in srgb, var(--surface-card-base) 70%, transparent);
  box-shadow: inset 0 0 0 1px var(--color-primary);
}
.rest {
  font-size: 12px;
}
</style>
