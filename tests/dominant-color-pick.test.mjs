import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  normalizeAccent,
  pickDominantColorFromPixels,
  parseAccent,
} from '../src/shared/accentPalette.ts';

/** 按 RGB 生成一块 size×size 的 RGBA 像素 */
const solid = (size, r, g, b, a = 255) => {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = a;
  }
  return data;
};

/** 两种颜色按比例混合（前 ratio 比例的像素是 c1） */
const mix = (size, c1, c2, ratio) => {
  const data = new Uint8ClampedArray(size * size * 4);
  const pixels = size * size;
  const split = Math.round(pixels * ratio);
  for (let p = 0; p < pixels; p += 1) {
    const c = p < split ? c1 : c2;
    const i = p * 4;
    data[i] = c[0];
    data[i + 1] = c[1];
    data[i + 2] = c[2];
    data[i + 3] = 255;
  }
  return data;
};

const hueOf = (hex) => {
  const { r, g, b } = parseAccent(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return 0;
  let h;
  if (max === r) h = ((g - b) / delta) % 6;
  else if (max === g) h = (b - r) / delta + 2;
  else h = (r - g) / delta + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
};

const hueDistance = (a, b) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

test('returns null for empty, transparent and fully grayscale input', () => {
  assert.equal(pickDominantColorFromPixels([]), null);
  assert.equal(pickDominantColorFromPixels(new Uint8ClampedArray(0)), null);
  assert.equal(pickDominantColorFromPixels(solid(8, 128, 128, 128)), null, '中性灰');
  assert.equal(pickDominantColorFromPixels(solid(8, 250, 250, 250)), null, '近白被过滤');
  assert.equal(pickDominantColorFromPixels(solid(8, 255, 0, 0, 0)), null, '全透明');
});

test('picks the hue of a vivid cover', () => {
  const red = pickDominantColorFromPixels(solid(16, 220, 30, 40));
  const green = pickDominantColorFromPixels(solid(16, 30, 200, 60));
  const blue = pickDominantColorFromPixels(solid(16, 40, 70, 220));

  assert.ok(hueDistance(hueOf(red), 355) < 20, `红：${red}`);
  assert.ok(hueDistance(hueOf(green), 130) < 25, `绿：${green}`);
  assert.ok(hueDistance(hueOf(blue), 227) < 25, `蓝：${blue}`);
});

test('different covers stay visibly different after accent normalization', () => {
  const covers = [
    solid(16, 220, 30, 40), // 红
    solid(16, 30, 200, 60), // 绿
    solid(16, 40, 70, 220), // 蓝
    solid(16, 210, 150, 30), // 橙
  ].map((data) => normalizeAccent(pickDominantColorFromPixels(data), false));

  assert.equal(new Set(covers).size, covers.length, `四张封面应得到四个不同主题色：${covers}`);
});

test('a vivid accent area is not averaged into the muted background', () => {
  const size = 32;
  // 85% 米白背景 + 15% 饱和蓝：整桶平均会洗成灰蓝，取高分像素应保持蓝的色相
  const data = mix(size, [30, 60, 200], [236, 228, 216], 0.15);
  const picked = pickDominantColorFromPixels(data);
  assert.ok(picked, '应能取到颜色');
  assert.ok(hueDistance(hueOf(picked), 227) < 25, `应保持蓝色相，实际 ${picked}`);
});

test('repeated calls on the same pixels are deterministic', () => {
  const data = mix(16, [200, 40, 60], [40, 90, 210], 0.5);
  assert.equal(pickDominantColorFromPixels(data), pickDominantColorFromPixels(data));
});

test('a large vivid region beats a small vivid accent', () => {
  // 复现李宇春那类封面：46% 藏蓝 + 9% 亮黄 + 45% 灰。
  // 面积大的藏蓝应该胜出，而不是小块黄字把主题色抢走。
  const size = 32;
  const data = new Uint8ClampedArray(size * size * 4);
  const total = size * size;
  const navy = [27, 46, 106]; // #1b2e6a
  const yellow = [242, 222, 50]; // #f2de32
  const gray = [120, 120, 120]; // 会被灰度过滤
  for (let p = 0; p < total; p += 1) {
    const ratio = p / total;
    const color = ratio < 0.46 ? navy : ratio < 0.55 ? yellow : gray;
    const i = p * 4;
    data[i] = color[0];
    data[i + 1] = color[1];
    data[i + 2] = color[2];
    data[i + 3] = 255;
  }

  const picked = pickDominantColorFromPixels(data);
  assert.ok(picked, '应能取到颜色');
  assert.ok(hueDistance(hueOf(picked), 230) < 30, `应选藏蓝，实际 ${picked}`);
});

test('alpha below the sampling threshold is ignored', () => {
  const data = solid(8, 255, 0, 0, 120);
  assert.equal(pickDominantColorFromPixels(data), null);
});
