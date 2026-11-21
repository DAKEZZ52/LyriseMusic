<!--
 * LyriseMusic - 人声分离队列面板
 * 作者：Koason
 * 版权：© 2026 LyriseMusic. All rights reserved.
 * 描述：展示分离队列（等待中 / 分离中 / 已完成 / 失败）与统计，
 *      提供开始、停止、清理已完成三个操作；真正的执行由页面通过 composable 注入。
 -->
<script setup lang="ts">
defineOptions({ name: 'separator-queue-panel' });

import { computed } from 'vue';
import { iconScissors } from '@/icons';
import type { SeparatorJob, SeparatorQueueStats } from '@/utils/separatorQueue';
import { statusLabel } from '@/utils/separatorQueue';

const props = defineProps<{
  jobs: SeparatorJob[];
  stats: SeparatorQueueStats;
  running: boolean;
  /** 是否还有等待中的任务（决定开始按钮可用）。 */
  canStart: boolean;
  /** 是否允许把「当前来源」加入队列。 */
  canAddCurrent: boolean;
  /** 当前播放列表可加入的歌曲数（0 表示没有可加的歌单）。 */
  playlistCount: number;
}>();

const emit = defineEmits<{
  (e: 'start'): void;
  (e: 'stop'): void;
  (e: 'clear'): void;
  (e: 'addCurrent'): void;
  (e: 'addPlaylist'): void;
}>();

/** 是否有可清理的条目（已完成 / 已取消）。 */
const canClear = computed(() => props.stats.done > 0 || props.stats.canceled > 0);
/** 进度文案：已完成 / 总数。 */
const progressText = computed(() => {
  const finished = props.stats.done + props.stats.failed;
  return `${finished} / ${props.stats.total}`;
});
</script>

<template>
  <div class="sep-queue-card">
    <div class="sep-queue-head">
      <div class="sep-queue-title">
        <Icon :icon="iconScissors" width="13" height="13" />
        <span>分离队列</span>
        <span class="sep-queue-count">{{ progressText }}</span>
        <span v-if="stats.pending > 0" class="sep-queue-wait">待处理 {{ stats.pending }}</span>
      </div>
      <div class="sep-queue-actions">
        <button
          v-if="!running"
          type="button"
          class="sep-queue-btn primary"
          :disabled="!canStart"
          @click="emit('start')"
        >
          开始队列
        </button>
        <button v-else type="button" class="sep-queue-btn" @click="emit('stop')">停止</button>
      </div>
    </div>

    <!-- 入队入口 + 清理 -->
    <div class="sep-queue-tools">
      <button
        type="button"
        class="sep-queue-btn"
        :disabled="!canAddCurrent"
        @click="emit('addCurrent')"
      >
        加入当前
      </button>
      <button
        type="button"
        class="sep-queue-btn"
        :disabled="running || playlistCount === 0"
        @click="emit('addPlaylist')"
      >
        加入播放列表<span v-if="playlistCount > 0"> · {{ playlistCount }}</span>
      </button>
      <button
        type="button"
        class="sep-queue-btn"
        :disabled="running || !canClear"
        @click="emit('clear')"
      >
        清理已完成
      </button>
    </div>

    <div v-if="jobs.length === 0" class="sep-queue-empty">
      本地文件可多选，或在下方把当前歌曲加入队列；任务按顺序逐个分离。
    </div>
    <ul v-else class="sep-queue-list">
      <li v-for="job in jobs" :key="job.id" class="sep-queue-item" :class="`is-${job.status}`">
        <span class="sep-queue-dot" />
        <div class="sep-queue-text">
          <div class="sep-queue-item-title">{{ job.title }}</div>
          <div v-if="job.subtitle" class="sep-queue-item-sub">{{ job.subtitle }}</div>
        </div>
        <span class="sep-queue-status">{{ statusLabel(job.status) }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
@reference "@/style.css";

.sep-queue-card {
  @apply rounded-2xl border border-[var(--border-subtle)];
  background-color: var(--bg-info-card);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
}

.sep-queue-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.sep-queue-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-main);
  min-width: 0;
}

.sep-queue-count {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-secondary);
}

.sep-queue-wait {
  font-size: 11px;
  color: var(--color-primary-text);
}

.sep-queue-actions {
  display: inline-flex;
  gap: 6px;
  flex-shrink: 0;
}

/* 入队入口行 */
.sep-queue-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.sep-queue-btn {
  height: 28px;
  padding: 0 10px;
  border-radius: 8px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--color-text-main);
  background-color: var(--bg-card);
  transition: filter 0.15s ease;
}

.sep-queue-btn.primary {
  color: var(--color-on-primary);
  background-color: var(--color-primary);
}

.sep-queue-btn:hover:not(:disabled) {
  filter: brightness(1.05);
}

.sep-queue-btn:disabled {
  opacity: 0.4;
  pointer-events: none;
}

.sep-queue-empty {
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--color-text-secondary);
}

.sep-queue-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 168px;
  overflow-y: auto;
}

.sep-queue-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 9px;
  background-color: var(--bg-card);
}

.sep-queue-dot {
  flex-shrink: 0;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: var(--color-text-secondary);
  opacity: 0.5;
}

.sep-queue-item.is-running .sep-queue-dot {
  background-color: var(--color-primary);
  opacity: 1;
}

.sep-queue-item.is-done .sep-queue-dot {
  background-color: var(--color-success, var(--color-primary));
  opacity: 1;
}

.sep-queue-item.is-failed .sep-queue-dot {
  background-color: var(--color-danger, var(--color-primary));
  opacity: 1;
}

.sep-queue-text {
  flex: 1;
  min-width: 0;
}

.sep-queue-item-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-main);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sep-queue-item-sub {
  font-size: 10.5px;
  color: var(--color-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sep-queue-status {
  flex-shrink: 0;
  font-size: 10.5px;
  font-weight: 600;
  color: var(--color-text-secondary);
}

.sep-queue-item.is-running .sep-queue-status {
  color: var(--color-primary-text);
}

.sep-queue-item.is-failed .sep-queue-status {
  color: var(--color-danger, var(--color-text-secondary));
}
</style>
