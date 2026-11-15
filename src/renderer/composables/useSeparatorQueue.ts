/**
 * LyriseMusic - 人声分离队列（响应式封装）
 * 文件：useSeparatorQueue.ts
 * 描述：把「入队 / 串行执行 / 停止 / 清理」包成 ref 状态，真正的分离动作由调用方
 *      以闭包形式注入（页面里复用现有的 start→save 流程）。
 *      串行执行：主进程只有一个结果暂存槽位，同时跑两首会互相覆盖并翻倍占内存。
 * 版权：Copyright © 2026 Dake（知之Dake）. All Rights Reserved.
 */
import { computed, ref } from 'vue';
import {
  cancelPending,
  dropSettled,
  hasPending,
  nextPending,
  queueStats,
  type SeparatorJob,
} from '@/utils/separatorQueue';

/** 入队项：run 只在该项真正开始执行时才被调用（音频在这一刻才读取，避免提前占内存）。 */
export interface SeparatorQueueInput {
  title: string;
  subtitle?: string;
  /** 执行一项分离，成功返回两条输出文件路径，失败直接 throw。 */
  run: () => Promise<{ vocalPath: string; instrumentalPath: string }>;
}

export function useSeparatorQueue() {
  const jobs = ref<SeparatorJob[]>([]);
  const running = ref(false);
  /** 当前正在执行的任务 id（没有则为 null）。 */
  const currentId = ref<string | null>(null);

  /** 每个任务对应的执行闭包，按 id 存放；不放 ref 里，避免被响应式代理包一层。 */
  const runners = new Map<string, SeparatorQueueInput['run']>();
  let seq = 0;
  /** 用户点了停止：当前项跑完后不再继续后续任务。 */
  let stopRequested = false;

  const stats = computed(() => queueStats(jobs.value));
  const canStart = computed(() => !running.value && hasPending(jobs.value));

  function patch(id: string, next: Partial<SeparatorJob>) {
    jobs.value = jobs.value.map((job) => (job.id === id ? { ...job, ...next } : job));
  }

  /** 入队，返回实际加入的条数。 */
  function enqueue(inputs: SeparatorQueueInput[]): number {
    if (inputs.length === 0) return 0;
    const added: SeparatorJob[] = [];
    for (const input of inputs) {
      seq += 1;
      const id = `sep-job-${seq}`;
      runners.set(id, input.run);
      added.push({
        id,
        title: input.title,
        subtitle: input.subtitle ?? '',
        status: 'pending',
      });
    }
    jobs.value = [...jobs.value, ...added];
    return added.length;
  }

  /** 串行跑完队列；已在跑时直接返回。 */
  async function start() {
    if (running.value) return;
    if (!hasPending(jobs.value)) return;
    running.value = true;
    stopRequested = false;
    try {
      for (;;) {
        if (stopRequested) break;
        const job = nextPending(jobs.value);
        if (!job) break;
        const run = runners.get(job.id);
        currentId.value = job.id;
        patch(job.id, { status: 'running', error: undefined });
        if (!run) {
          patch(job.id, { status: 'failed', error: '任务已失效，请重新加入队列' });
          continue;
        }
        try {
          const output = await run();
          patch(job.id, {
            status: 'done',
            vocalPath: output.vocalPath,
            instrumentalPath: output.instrumentalPath,
          });
        } catch (err) {
          patch(job.id, {
            status: 'failed',
            error: err instanceof Error ? err.message : String(err),
          });
        }
        runners.delete(job.id);
      }
    } finally {
      // 用户中途停止：剩下的等待项标记为已取消
      if (stopRequested) jobs.value = cancelPending(jobs.value);
      running.value = false;
      currentId.value = null;
      stopRequested = false;
    }
  }

  /** 请求停止：当前项跑完后收尾，剩下的等下次再跑。 */
  function stop() {
    if (!running.value) {
      jobs.value = cancelPending(jobs.value);
      return;
    }
    stopRequested = true;
  }

  /** 清理已完成 / 已取消的条目。 */
  function clearSettled() {
    jobs.value = dropSettled(jobs.value);
    for (const id of [...runners.keys()]) {
      if (!jobs.value.some((job) => job.id === id)) runners.delete(id);
    }
  }

  /** 全部清空（队列空闲时才允许调用）。 */
  function clearAll() {
    if (running.value) return;
    jobs.value = [];
    runners.clear();
  }

  return {
    jobs,
    running,
    currentId,
    stats,
    canStart,
    enqueue,
    start,
    stop,
    clearSettled,
    clearAll,
  };
}
