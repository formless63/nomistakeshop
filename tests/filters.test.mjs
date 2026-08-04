import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as filters from '../js/filters/filters.js';

// Build a synthetic ImageData-like object from a flat pixel list [[r,g,b,a], ...].
function makeImg(w, h, pixels) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < pixels.length; p++) {
    const [r, g, b, a = 255] = pixels[p];
    const i = p * 4;
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = a;
  }
  return { data, width: w, height: h };
}

function px(img, x, y) {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
}

function assertAllBytesValid(img) {
  for (let i = 0; i < img.data.length; i++) {
    const v = img.data[i];
    assert.ok(Number.isFinite(v), `byte ${i} is not finite`);
    assert.ok(v >= 0 && v <= 255, `byte ${i} out of range: ${v}`);
  }
}

test('brightness shifts channels and preserves alpha', () => {
  const img = makeImg(2, 1, [[10, 20, 30], [100, 150, 250, 200]]);
  const out = filters.brightness(img, 20); // delta = 51
  assert.equal(out, img, 'mutate-and-return');
  assert.deepEqual(px(img, 0, 0), [61, 71, 81, 255]);
  assert.deepEqual(px(img, 1, 0), [151, 201, 255, 200]);

  filters.brightness(img, -9999); // clamps to -100
  assert.deepEqual(px(img, 0, 0), [0, 0, 0, 255]);
});

test('contrast: 0 is identity, 100 pushes to extremes', () => {
  const img = makeImg(3, 1, [[64, 128, 192], [128, 128, 128], [200, 100, 50]]);
  filters.contrast(img, 0);
  assert.deepEqual(px(img, 0, 0), [64, 128, 192, 255]);
  assert.deepEqual(px(img, 2, 0), [200, 100, 50, 255]);

  const img2 = makeImg(3, 1, [[64, 64, 64], [128, 128, 128], [192, 192, 192]]);
  filters.contrast(img2, 100);
  assert.deepEqual(px(img2, 0, 0), [0, 0, 0, 255]);
  assert.deepEqual(px(img2, 1, 0), [128, 128, 128, 255]); // midpoint fixed
  assert.deepEqual(px(img2, 2, 0), [255, 255, 255, 255]);
});

test('saturation: -100 equals grayscale', () => {
  const img = makeImg(1, 1, [[200, 100, 50]]);
  filters.saturation(img, -100);
  // luma = 0.299*200 + 0.587*100 + 0.114*50 = 124.2 -> 124
  assert.deepEqual(px(img, 0, 0), [124, 124, 124, 255]);

  const gray = makeImg(1, 1, [[200, 100, 50]]);
  filters.grayscale(gray);
  assert.deepEqual(px(gray, 0, 0), px(img, 0, 0));
});

test('saturation: +100 extrapolates away from luma and clamps', () => {
  const img = makeImg(1, 1, [[200, 100, 50]]);
  filters.saturation(img, 100);
  const [r, g, b] = px(img, 0, 0);
  assert.equal(r, 255); // clamped
  assert.equal(b, 0); // clamped
  assert.ok(g < 100, 'green moved away from luma');
});

test('grayscale uses luminance weights', () => {
  const img = makeImg(4, 1, [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255]]);
  filters.grayscale(img);
  assert.deepEqual(px(img, 0, 0), [76, 76, 76, 255]); // 0.299*255 = 76.245
  assert.deepEqual(px(img, 1, 0), [150, 150, 150, 255]); // 0.587*255 = 149.685
  assert.deepEqual(px(img, 2, 0), [29, 29, 29, 255]); // 0.114*255 = 29.07
  assert.deepEqual(px(img, 3, 0), [255, 255, 255, 255]);
});

test('invert complements channels, preserves alpha', () => {
  const img = makeImg(1, 1, [[10, 20, 30, 77]]);
  filters.invert(img);
  assert.deepEqual(px(img, 0, 0), [245, 235, 225, 77]);
});

test('sepia spot check on neutral gray', () => {
  const img = makeImg(1, 1, [[100, 100, 100]]);
  filters.sepia(img);
  assert.deepEqual(px(img, 0, 0), [135, 120, 94, 255]);
});

test('threshold splits on luminance', () => {
  const img = makeImg(3, 1, [[100, 100, 100], [128, 128, 128], [200, 200, 200]]);
  filters.threshold(img, 128);
  assert.deepEqual(px(img, 0, 0), [0, 0, 0, 255]);
  assert.deepEqual(px(img, 1, 0), [255, 255, 255, 255]); // >= t passes
  assert.deepEqual(px(img, 2, 0), [255, 255, 255, 255]);
});

test('posterize quantizes to N levels', () => {
  const img = makeImg(3, 1, [[0, 100, 200], [0, 100, 200], [0, 100, 200]]);
  filters.posterize(img, 2);
  assert.deepEqual(px(img, 0, 0), [0, 0, 255, 255]);

  const img2 = makeImg(2, 1, [[100, 100, 100], [200, 200, 200]]);
  filters.posterize(img2, 4); // quantum = 85
  assert.deepEqual(px(img2, 0, 0), [85, 85, 85, 255]);
  assert.deepEqual(px(img2, 1, 0), [170, 170, 170, 255]);
});

test('hueRotate: 0 is identity, 120 maps red to green', () => {
  const img = makeImg(1, 1, [[10, 200, 99]]);
  const before = px(img, 0, 0);
  filters.hueRotate(img, 0);
  assert.deepEqual(px(img, 0, 0), before);

  const red = makeImg(1, 1, [[255, 0, 0]]);
  filters.hueRotate(red, 120);
  const [r, g, b] = px(red, 0, 0);
  assert.equal(r, 0);
  assert.equal(b, 0);
  assert.ok(g >= 112 && g <= 114, `expected g≈113, got ${g}`);
});

test('boxBlur radius 1 on 3x3 impulse spreads evenly', () => {
  const img = makeImg(3, 3, [
    [0, 0, 0], [0, 0, 0], [0, 0, 0],
    [0, 0, 0], [255, 255, 255], [0, 0, 0],
    [0, 0, 0], [0, 0, 0], [0, 0, 0],
  ]);
  filters.boxBlur(img, 1);
  // Horizontal pass: middle row becomes 85 everywhere; vertical pass: 85/3 ≈ 28.
  assert.equal(px(img, 1, 1)[0], 28, 'center');
  assert.equal(px(img, 0, 0)[0], 28, 'corner');
  assert.equal(px(img, 2, 2)[0], 28, 'opposite corner');
  assertAllBytesValid(img);
});

test('pixelate averages each block', () => {
  const img = makeImg(2, 2, [
    [0, 0, 0], [255, 0, 0],
    [0, 255, 0], [0, 0, 255],
  ]);
  filters.pixelate(img, 2);
  for (let y = 0; y < 2; y++) {
    for (let x = 0; x < 2; x++) {
      assert.deepEqual(px(img, x, y), [64, 64, 64, 255]); // 255/4 = 63.75 -> 64
    }
  }
});

test('sharpen: amount 0 is identity; interior sharpens', () => {
  const img = makeImg(3, 3, Array(9).fill([128, 128, 128]).map((p) => [...p]));
  const before = Array.from(img.data);
  filters.sharpen(img, 0);
  assert.deepEqual(Array.from(img.data), before);

  // Impulse in uniform field, amount 100 (k=1): center = 5*255 - 4*128 -> clamped 255
  const img2 = makeImg(3, 3, Array(9).fill([128, 128, 128]).map((p) => [...p]));
  img2.data.fill(128, 0, 36);
  const c = (1 * 3 + 1) * 4;
  img2.data[c] = 255;
  img2.data[c + 1] = 255;
  img2.data[c + 2] = 255;
  filters.sharpen(img2, 100);
  assert.equal(px(img2, 1, 1)[0], 255);
  assert.equal(px(img2, 0, 0)[0], 128, 'border pixels untouched');
  assertAllBytesValid(img2);
});

test('emboss and edgeDetect run, keep dimensions, no NaN', () => {
  const base = () => makeImg(4, 4, Array.from({ length: 16 }, (_, i) => [i * 16, 255 - i * 16, 80]));
  const e = filters.emboss(base());
  assert.equal(e.width, 4);
  assert.equal(e.height, 4);
  assertAllBytesValid(e);

  const ed = filters.edgeDetect(base());
  assert.equal(ed.width, 4);
  assert.equal(ed.height, 4);
  assertAllBytesValid(ed);

  // Uniform image has no edges -> interior is 0 after abs
  const flat = makeImg(3, 3, Array(9).fill([90, 90, 90]).map((p) => [...p]));
  filters.edgeDetect(flat);
  assert.equal(px(flat, 1, 1)[0], 0);
});

test('noise: amount 0 is identity', () => {
  const img = makeImg(2, 2, [[1, 2, 3], [4, 5, 6], [7, 8, 9], [10, 11, 12]]);
  const before = Array.from(img.data);
  filters.noise(img, 0);
  assert.deepEqual(Array.from(img.data), before);

  const img2 = makeImg(4, 4, Array(16).fill([128, 128, 128]).map((p) => [...p]));
  filters.noise(img2, 100);
  assertAllBytesValid(img2);
});

test('all filters are total: extreme params never throw and stay in 0-255', () => {
  const extremes = [9999, -9999, NaN, Infinity, -Infinity, undefined, 'abc'];
  const fns = [
    'brightness', 'contrast', 'saturation', 'hueRotate', 'grayscale', 'invert',
    'sepia', 'threshold', 'posterize', 'boxBlur', 'sharpen', 'noise', 'pixelate',
    'emboss', 'edgeDetect',
  ];
  for (const name of fns) {
    for (const v of extremes) {
      const img = makeImg(3, 3, Array(9).fill([37, 200, 111, 190]).map((p) => [...p]));
      assert.doesNotThrow(() => filters[name](img, v), `${name}(${v}) threw`);
      assertAllBytesValid(img);
      assert.equal(img.width, 3);
      assert.equal(img.height, 3);
    }
  }
});

test('filters clamp out-of-range params to contract ranges', () => {
  // brightness(9999) behaves like brightness(100)
  const a = makeImg(1, 1, [[100, 100, 100]]);
  const b = makeImg(1, 1, [[100, 100, 100]]);
  filters.brightness(a, 9999);
  filters.brightness(b, 100);
  assert.deepEqual(Array.from(a.data), Array.from(b.data));

  // hueRotate(720) clamps to 360 == identity
  const img = makeImg(1, 1, [[12, 34, 56]]);
  const before = px(img, 0, 0);
  filters.hueRotate(img, 720);
  assert.deepEqual(px(img, 0, 0), before);

  // pixelate(1) clamps to size 2; on a 2x2 image the whole image becomes one block
  const p = makeImg(2, 2, [[0, 0, 0], [255, 0, 0], [0, 255, 0], [0, 0, 255]]);
  filters.pixelate(p, 1);
  assert.deepEqual(px(p, 0, 0), [64, 64, 64, 255]);
});
