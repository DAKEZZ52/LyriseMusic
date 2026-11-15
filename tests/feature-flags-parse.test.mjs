import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_FEATURE_FLAGS, parseFeatureFlags } from '../src/shared/featureFlags.ts';

test('reads the real endpoint shape', () => {
  // 这是 dkyy.top/api/feature-flags 的真实响应（2026-11-15 抓取）
  const payload = {
    webroom: { mode: 'maintenance', message: '暂不开启，理解', updatedAt: 1794597115587 },
    features: {
      separator: { enabled: true, message: '' },
      scoreflow: { enabled: false, message: '' },
    },
  };

  assert.deepEqual(parseFeatureFlags(payload), {
    separator: { enabled: true, message: '' },
    scoreflow: { enabled: false, message: '' },
  });
});

test('keeps the server message so the client can show the reason', () => {
  const flags = parseFeatureFlags({
    features: { separator: { enabled: false, message: '模型维护中，预计今晚恢复' } },
  });
  assert.equal(flags.separator.enabled, false);
  assert.equal(flags.separator.message, '模型维护中，预计今晚恢复');
  // 没提到的功能保持默认开启
  assert.equal(flags.scoreflow.enabled, true);
});

test('missing, malformed or dirty payloads fall back to everything enabled', () => {
  const cases = [
    undefined,
    null,
    {},
    { features: null },
    { features: 'nope' },
    { features: { separator: null } },
    { features: { separator: { enabled: 'false' } } }, // 字符串不算开关
    { features: { separator: { enabled: 0 } } },
    { features: { separator: { message: '只有文案' } } },
    { features: { unknown: { enabled: false } } },
  ];

  for (const payload of cases) {
    const flags = parseFeatureFlags(payload);
    assert.equal(flags.separator.enabled, true, `应回落到开启: ${JSON.stringify(payload)}`);
    assert.equal(flags.scoreflow.enabled, true);
  }
});

test('does not mutate the defaults between calls', () => {
  const disabled = parseFeatureFlags({ features: { scoreflow: { enabled: false } } });
  assert.equal(disabled.scoreflow.enabled, false);
  assert.equal(DEFAULT_FEATURE_FLAGS.scoreflow.enabled, true, '默认值不能被解析结果改写');
  assert.equal(parseFeatureFlags({}).scoreflow.enabled, true);
});

test('non-string message becomes an empty string', () => {
  const flags = parseFeatureFlags({ features: { separator: { enabled: false, message: 42 } } });
  assert.equal(flags.separator.message, '');
});
