/**
 * LyriseMusic - 人声分离队列（纯逻辑）
 * 文件：separatorQueue.ts
 * 描述：分离任务队列的状态、统计与推进规则，不依赖 Vue / Electron，便于单测。
 *      主进程的分离结果只有一个暂存槽位（pendingStems），因此队列必须串行推进：
 *      一项 start→save 完整结束后才处理下一项，绝不同时跑两首。
 * 版权：Copyright © 2026 Koason. All Rights Reserved.
 */

/** 队列任务状态。 */
export type SeparatorJobStatus = 'pending' | 'running' | 'done' | 'failed' | 'canceled';

/** 一条分离队列任务（界面展示用；真正的音频解析闭包不放在这里）。 */
export interface SeparatorJob {
  id: string;
  /** 主标题：歌名或文件名。 */
  title: string;
  /** 副标题：歌手或来源说明。 */
  subtitle: string;
  status: SeparatorJobStatus;
  /** 失败原因（status 为 failed 时展示）。 */
  error?: string;
  vocalPath?: string;
  instrumentalPath?: string;
}

/** 队列统计。 */
export interface SeparatorQueueStats {
  total: number;
  pending: number;
  running: number;
  done: number;
  failed: number;
  canceled: number;
}

/** 统计各状态数量。 */
export function queueStats(jobs: readonly SeparatorJob[]): SeparatorQueueStats {
  const stats: SeparatorQueueStats = {
    total: jobs.length,
    pending: 0,
    running: 0,
    done: 0,
    failed: 0,
    canceled: 0,
  };
  for (const job of jobs) stats[job.status] += 1;
  return stats;
}

/** 是否还有等待执行的任务。 */
export function hasPending(jobs: readonly SeparatorJob[]): boolean {
  return jobs.some((job) => job.status === 'pending');
}

/** 取下一条待执行任务（没有则返回 null；保持入队顺序）。 */
export function nextPending(jobs: readonly SeparatorJob[]): SeparatorJob | null {
  return jobs.find((job) => job.status === 'pending') ?? null;
}

/** 把仍在等待的任务标记为已取消（当前正在跑的那一条不动）。 */
export function cancelPending(jobs: readonly SeparatorJob[]): SeparatorJob[] {
  return jobs.map((job) => (job.status === 'pending' ? { ...job, status: 'canceled' } : job));
}

/**
 * 清理条目：移除已完成 / 已取消的，保留等待中、分离中与失败的（失败项留给用户看原因）。
 */
export function dropSettled(jobs: readonly SeparatorJob[]): SeparatorJob[] {
  return jobs.filter(
    (job) => job.status === 'pending' || job.status === 'running' || job.status === 'failed',
  );
}

/** 是否有任务在跑（用于界面判断队列是否可开始）。 */
export function isRunning(jobs: readonly SeparatorJob[]): boolean {
  return jobs.some((job) => job.status === 'running');
}

/** 状态文案（界面统一用词）。 */
export function statusLabel(status: SeparatorJobStatus): string {
  switch (status) {
    case 'pending':
      return '等待中';
    case 'running':
      return '分离中';
    case 'done':
      return '已完成';
    case 'failed':
      return '失败';
    default:
      return '已取消';
  }
}
