// js/tools/wand.js — magic wand selection. Click samples the FLATTENED
// composite (flattenImage) and builds a doc-sized mask canvas
// (white / alpha 255 = selected):
// - contiguous: iterative scanline flood from the click point, using the
//   same tolerance formula as fill.js (per-channel abs diff vs the seed,
//   each <= tolerance/100*255);
// - non-contiguous: single global per-pixel match pass.
// Non-destructive: sets { type:'mask', mask } via setSelection.

import { state, setSelection, getToolOption } from '../core/state.js';
import { flattenImage } from '../core/document.js';
import { createCanvas } from '../core/canvasUtils.js';

function buildMask(image, sx, sy, tolerance, contiguous) {
  const w = image.width;
  const h = image.height;
  const d = image.data;
  const { canvas, ctx } = createCanvas(w, h);
  const out = ctx.createImageData(w, h);
  const od = out.data;

  const seedIdx = (sy * w + sx) * 4;
  const sr = d[seedIdx], sg = d[seedIdx + 1], sb = d[seedIdx + 2], sa = d[seedIdx + 3];

  // Same mapping as fill.js: tolerance 0 matches exact colors only,
  // tolerance 100 matches everything.
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
  const select = (i) => {
    const p = i * 4;
    od[p] = 255;
    od[p + 1] = 255;
    od[p + 2] = 255;
    od[p + 3] = 255;
  };

  if (contiguous) {
    // Iterative scanline flood from the seed point (no recursion).
    const done = new Uint8Array(w * h);
    const ok = (x, y) => {
      const i = y * w + x;
      return !done[i] && matches(i);
    };
    const stack = [[sx, sy]];
    while (stack.length) {
      const [px, py] = stack.pop();
      let x = px;
      while (x >= 0 && ok(x, py)) x--;
      x++;
      let spanAbove = false;
      let spanBelow = false;
      while (x < w && ok(x, py)) {
        const i = py * w + x;
        done[i] = 1;
        select(i);
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
  } else {
    for (let i = 0; i < w * h; i++) {
      if (matches(i)) select(i);
    }
  }

  ctx.putImageData(out, 0, 0);
  return canvas;
}

export default {
  id: 'wand',
  label: 'Magic Wand',
  icon: '🪄',
  cursor: 'crosshair',
  destructive: false,
  options: [
    { key: 'tolerance', label: 'Tolerance', type: 'range', min: 0, max: 100, step: 1, default: 32 },
    { key: 'contiguous', label: 'Contiguous', type: 'checkbox', default: true },
  ],

  onPointerDown(pt) {
    const doc = state.doc;
    if (!doc) return;
    const x = Math.round(pt.x);
    const y = Math.round(pt.y);
    if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return;
    const composite = flattenImage();
    if (!composite) return;
    const image = composite
      .getContext('2d', { willReadFrequently: true })
      .getImageData(0, 0, doc.width, doc.height);
    const tolerance = getToolOption('wand', 'tolerance', 32);
    const contiguous = getToolOption('wand', 'contiguous', true);
    const mask = buildMask(image, x, y, tolerance, contiguous);
    setSelection({ type: 'mask', mask }); // setSelection emits 'selection:changed'
  },

  onPointerMove() {},
  onPointerUp() {},
};
