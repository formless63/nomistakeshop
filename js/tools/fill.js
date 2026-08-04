// js/tools/fill.js — scanline flood fill on the active layer.
// Explicit span stack, O(w*h), no recursion. Respects selection bounds:
// a rect selection confines the fill to the rect, a lasso confines it to
// pixels inside the polygon.

import { state, emit, getToolOption } from '../core/state.js';
import { getActiveLayer } from '../core/document.js';
import { hexToRgb, getLayerImageData, putLayerImageData } from '../core/canvasUtils.js';

// Per-pixel allow mask derived from the selection, or null when unrestricted.
function buildAllowedMask(sel, w, h) {
  if (!sel) return null;
  const mask = new Uint8Array(w * h);
  if (sel.type === 'rect') {
    const x0 = Math.max(0, Math.floor(sel.x));
    const y0 = Math.max(0, Math.floor(sel.y));
    const x1 = Math.min(w, Math.ceil(sel.x + sel.w));
    const y1 = Math.min(h, Math.ceil(sel.y + sel.h));
    for (let y = y0; y < y1; y++) {
      mask.fill(1, y * w + x0, y * w + x1);
    }
  } else if (sel.type === 'lasso' && sel.points && sel.points.length >= 3) {
    const pts = sel.points;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    const x0 = Math.max(0, Math.floor(minX));
    const y0 = Math.max(0, Math.floor(minY));
    const x1 = Math.min(w - 1, Math.ceil(maxX));
    const y1 = Math.min(h - 1, Math.ceil(maxY));
    // Ray-casting point-in-polygon over the bounding box only.
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        let inside = false;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
          if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
            inside = !inside;
          }
        }
        if (inside) mask[y * w + x] = 1;
      }
    }
  }
  return mask;
}

function floodFill(layer, sx, sy, tolerance) {
  const w = layer.canvas.width;
  const h = layer.canvas.height;
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return false;

  const image = getLayerImageData(layer);
  const d = image.data;
  const allowed = buildAllowedMask(state.selection, w, h);

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
    return !filled[i] && (!allowed || allowed[i]) && matches(i);
  };

  const { r, g, b } = hexToRgb(state.primaryColor);
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
      d[p] = r;
      d[p + 1] = g;
      d[p + 2] = b;
      d[p + 3] = 255;
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

  putLayerImageData(layer, image);
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
    const layer = getActiveLayer();
    if (!layer) return;
    const tolerance = getToolOption('fill', 'tolerance', 32);
    const x = Math.round(pt.x);
    const y = Math.round(pt.y);
    if (floodFill(layer, x, y, tolerance)) {
      emit('layer:content', { layerId: layer.id });
    }
  },

  onPointerMove() {},
  onPointerUp() {},
};
