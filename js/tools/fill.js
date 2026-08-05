// js/tools/fill.js — scanline flood fill into getPaintTarget() (the active
// layer, or its mask when the mask is targeted). Mask targets store
// visibility in ALPHA, so the painted color's luminance becomes the mask
// value (black hides, white reveals) and RGB stays white. Explicit span
// stack, O(w*h), no recursion. Respects the selection via
// getSelectionMask(): a pixel is fillable when the mask's red channel at
// that pixel is > 127.

import { state, emit, getToolOption } from '../core/state.js';
import { getPaintTarget } from '../core/document.js';
import { hexToRgb } from '../core/canvasUtils.js';
import { getSelectionMask } from './selectionPath.js';

function floodFill(ctx, w, h, sx, sy, tolerance, isMask = false) {
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return false;

  const image = ctx.getImageData(0, 0, w, h);
  const d = image.data;

  // Per-pixel allow mask rasterized from the selection, or null when
  // unrestricted. Mask red channel > 127 = selected.
  const maskCanvas = getSelectionMask();
  const maskData = maskCanvas
    ? maskCanvas.getContext('2d').getImageData(0, 0, w, h).data
    : null;
  const allowed = (i) => !maskData || maskData[i * 4] > 127;

  const seedIdx = (sy * w + sx) * 4;
  const sr = d[seedIdx], sg = d[seedIdx + 1], sb = d[seedIdx + 2], sa = d[seedIdx + 3];

  // Tolerance 0-100 maps to a per-channel absolute-difference threshold:
  // a pixel matches the seed when |dr|,|dg|,|db|,|da| are all <=
  // (tolerance/100)*255. tolerance=0 matches exact colors only,
  // tolerance=100 matches everything.
  const maxDiff = (tolerance / 100) * 255;

  const matches = (i) => {
    const p = i * 4;
    return (
      Math.abs(d[p] - sr) <= maxDiff &&
      Math.abs(d[p + 1] - sg) <= maxDiff &&
      Math.abs(d[p + 2] - sb) <= maxDiff &&
      Math.abs(d[p + 3] - sa) <= maxDiff
    );
  };
  const ok = (x, y) => {
    const i = y * w + x;
    return !filled[i] && allowed(i) && matches(i);
  };

  const { r, g, b } = hexToRgb(state.primaryColor);
  // Mask fill: luminance -> alpha (visibility); RGB pinned to white.
  const fr = isMask ? 255 : r;
  const fg = isMask ? 255 : g;
  const fb = isMask ? 255 : b;
  const fa = isMask ? Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b) : 255;
  const filled = new Uint8Array(w * h);
  const stack = [[sx, sy]];

  while (stack.length) {
    const [px, py] = stack.pop();
    // Walk left to the start of this horizontal span.
    let x = px;
    while (x >= 0 && ok(x, py)) x--;
    x++;
    let spanAbove = false;
    let spanBelow = false;
    while (x < w && ok(x, py)) {
      const i = py * w + x;
      filled[i] = 1;
      const p = i * 4;
      d[p] = fr;
      d[p + 1] = fg;
      d[p + 2] = fb;
      d[p + 3] = fa;
      // Seed the rows above/below once per contiguous matching run.
      if (py > 0) {
        if (ok(x, py - 1)) {
          if (!spanAbove) { stack.push([x, py - 1]); spanAbove = true; }
        } else spanAbove = false;
      }
      if (py < h - 1) {
        if (ok(x, py + 1)) {
          if (!spanBelow) { stack.push([x, py + 1]); spanBelow = true; }
        } else spanBelow = false;
      }
      x++;
    }
  }

  ctx.putImageData(image, 0, 0);
  return true;
}

export default {
  id: 'fill',
  label: 'Fill',
  icon: '🪣',
  cursor: 'crosshair',
  destructive: true,
  options: [
    { key: 'tolerance', label: 'Tolerance', type: 'range', min: 0, max: 100, step: 1, default: 32 },
  ],

  onPointerDown(pt) {
    const target = getPaintTarget();
    if (!target) {
      emit('status:message', { text: 'Select a pixel layer' });
      return;
    }
    const { ctx, layer, isMask } = target;
    const tolerance = getToolOption('fill', 'tolerance', 32);
    const x = Math.round(pt.x);
    const y = Math.round(pt.y);
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    if (floodFill(ctx, w, h, x, y, tolerance, isMask)) {
      emit('layer:content', { layerId: layer.id });
    }
  },

  onPointerMove() {},
  onPointerUp() {},
};
