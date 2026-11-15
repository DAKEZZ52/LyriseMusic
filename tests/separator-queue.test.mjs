/**
 * 人声分离队列的纯逻辑测试
 * 说明：队列必须串行推进（主进程只有一个结果暂存槽位），
 *      这里只验证状态机与统计，不涉及 Vue / Electron。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  cancelPending,
  dropSettled,
  hasPending,
  isRunning,
  nextPending,
  queueStats,
  statusLabel,
} from '../src/renderer/utils/separatorQueue.ts';

/** 造一条任务。 */
const job = (id, status) => ({ id, title: id, subtitle: '', status });

describe('separatorQueue 统计', () => {
  it('空队列全为 0', () => {
    assert.deepEqual(queueStats([]), {
      total: 0,
      pending: 0,
      running: 0,
      done: 0,
      failed: 0,
      canceled: 0,
    });
  });

  it('按状态分类计数', () => {
    const jobs = [
      job('a', 'pending'),
      job('b', 'pending'),
      job('c', 'running'),
      job('d', 'done'),
      job('e', 'failed'),
      job('f', 'canceled'),
    ];
    const stats = queueStats(jobs);
    assert.equal(stats.total, 6);
    assert.equal(stats.pending, 2);
    assert.equal(stats.running, 1);
    assert.equal(stats.done, 1);
    assert.equal(stats.failed, 1);
    assert.equal(stats.canceled, 1);
  });
});

describe('separatorQueue 推进顺序', () => {
  it('按入队顺序取下一条待执行任务', () => {
    const jobs = [job('a', 'done'), job('b', 'pending'), job('c', 'pending')];
    assert.equal(nextPending(jobs)?.id, 'b');
  });

  it('没有待执行任务时返回 null', () => {
    assert.equal(nextPending([job('a', 'done'), job('b', 'failed')]), null);
  });

  it('hasPending / isRunning 判定', () => {
    assert.equal(hasPending([job('a', 'done')]), false);
    assert.equal(hasPending([job('a', 'pending')]), true);
    assert.equal(isRunning([job('a', 'running')]), true);
    assert.equal(isRunning([job('a', 'pending')]), false);
  });
});

describe('separatorQueue 停止与清理', () => {
  it('停止只取消等待中的任务，正在跑的不动', () => {
    const jobs = [job('a', 'done'), job('b', 'running'), job('c', 'pending'), job('d', 'pending')];
    const next = cancelPending(jobs);
    assert.equal(next[1].status, 'running');
    assert.equal(next[2].status, 'canceled');
    assert.equal(next[3].status, 'canceled');
    // 原数组不被修改（纯函数）
    assert.equal(jobs[2].status, 'pending');
  });

  it('清理移除已完成/已取消，保留失败项方便看原因', () => {
    const jobs = [
      job('a', 'done'),
      job('b', 'canceled'),
      job('c', 'failed'),
      job('d', 'pending'),
      job('e', 'running'),
    ];
    assert.deepEqual(
      dropSettled(jobs).map((j) => j.id),
      ['c', 'd', 'e'],
    );
  });
});

describe('separatorQueue 文案', () => {
  it('每种状态都有中文文案', () => {
    assert.equal(statusLabel('pending'), '等待中');
    assert.equal(statusLabel('running'), '分离中');
    assert.equal(statusLabel('done'), '已完成');
    assert.equal(statusLabel('failed'), '失败');
    assert.equal(statusLabel('canceled'), '已取消');
  });
});
