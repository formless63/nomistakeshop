// js/tools/dodgeBurn.js — dodge (lighten) / burn (darken) on the ACTIVE
// PIXEL layer. Each stamp processes its bounding square via getImageData:
//   luma    = Rec.601 / 255
//   weight  = shadows: 1-luma | highlights: luma | midtones: 1-|2*luma-1|
//   falloff = 1 - (dist/radius)^2          (smooth radial, 0 at the edge)
//   factor  = 1 ± (exposure/100) * weight * falloff * 0.5
// rgb *= factor, clamped. putImageData ignores the canvas clip, so a
// selection is honored by multiplying each pixel's change by the
// getSelectionMask() alpha instead.

import { state, emit, getToolOption } from '../core/state.js';
import { getActiveLayer } from '../core/document.js';
import { getSelectionMask } from './selectionPath.js';

let painting = false;
let last = null;
let strokeLayer = null;
let selMask = null; // { data, width, height } of getSelectionMask(), or null

function opts() {
  return {
    size: getToolOption('dodgeBurn', 'size', 40),
    exposure: getToolOption('dodgeBurn', 'exposure', 50),
    mode: getToolOption('dodgeBurn', 'mode', 'dodge'),
    range: getToolOption('dodgeBurn', 'range', 'midtones'),
  };
}

function selectionAlpha(x, y) {
  if (!selMask) return 1;
  if (x < 0 || y < 0 || x >= selMask.width || y >= selMask.height) return 0;
  return selMask.data[(y * selMask.width + x) * 4 + 3] / 255;
}

function stampAt(layer, cx, cy, o) {
  const radius = o.size / 2;
  const w = layer.canvas.width;
  const h = layer.canvas.height;
  const x0 = Math.max(0, Math.floor(cx - radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const x1 = Math.min(w, Math.ceil(cx + radius));
  const y1 = Math.min(h, Math.ceil(cy + radius));
  if (x1 <= x0 || y1 <= y0) return;

  const bw = x1 - x0;
  const bh = y1 - y0;
  const image = layer.ctx.getImageData(x0, y0, bw, bh);
  const d = image.data;
  const dir = o.mode === 'dodge' ? 1 : -1;
  const strength = (o.exposure / 100) * 0.5;

  for (let py = 0; py < bh; py++) {
    const docY = y0 + py;
    for (let px = 0; px < bw; px++) {
      const docX = x0 + px;
      const dist = Math.hypot(docX - cx, docY - cy);
      if (dist > radius) continue;
      const falloff = 1 - (dist / radius) ** 2;
      const p = (py * bw + px) * 4;
      const luma = (0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2]) / 255;
      let weight;
      if (o.range === 'shadows') weight = 1 - luma;
      else if (o.range === 'highlights') weight = luma;
      else weight = 1 - Math.abs(2 * luma - 1);
      // The selection scales the change, not the value itself.
      const delta = dir * strength * weight * falloff * selectionAlpha(docX, docY);
      if (delta === 0) continue;
      const factor = 1 + delta;
      d[p] = Math.min(255, Math.max(0, d[p] * factor));
      d[p + 1] = Math.min(255, Math.max(0, d[p + 1] * factor));
      d[p + 2] = Math.min(255, Math.max(0, d[p + 2] * factor));
    }
  }
  layer.ctx.putImageData(image, x0, y0);
}

// Stamp along the segment a -> b with spacing <= size/4 (like brush).
function stampSegment(layer, a, b, o) {
  const spacing = Math.max(0.5, o.size / 4);
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.max(1, Math.ceil(len / spacing));
  for (let i = 1; i <= steps; i++) {
    stampAt(layer, a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps, o);
  }
}

export default {
  id: 'dodgeBurn',
  label: 'Dodge / Burn',
  icon: '🌗',
  cursor: 'crosshair',
  destructive: true,
  options: [
    { key: 'size', label: 'Size', type: 'range', min: 1, max: 300, step: 1, default: 40 },
    { key: 'exposure', label: 'Exposure', type: 'range', min: 1, max: 100, step: 1, default: 50 },
    {
      key: 'mode', label: 'Mode', type: 'select', default: 'dodge',
      choices: [
        { value: 'dodge', label: 'Dodge (lighten)' },
        { value: 'burn', label: 'Burn (darken)' },
      ],
    },
    {
      key: 'range', label: 'Range', type: 'select', default: 'midtones',
      choices: [
        { value: 'shadows', label: 'Shadows' },
        { value: 'midtones', label: 'Midtones' },
        { value: 'highlights', label: 'Highlights' },
      ],
    },
  ],

  onPointerDown(pt) {
    const layer = getActiveLayer();
    if (!layer || layer.type !== 'pixel') {
      emit('status:message', { text: 'Select a pixel layer' });
      return;
    }
    const maskCanvas = state.selection ? getSelectionMask() : null;
    selMask = maskCanvas
      ? maskCanvas.getContext('2d').getImageData(0, 0, maskCanvas.width, maskCanvas.height)
      : null;
    strokeLayer = layer;
    painting = true;
    last = { ...pt };
    stampAt(layer, pt.x, pt.y, opts());
    emit('layer:content', { layerId: layer.id });
  },

  onPointerMove(pt) {
    if (!painting || !state.isPointerDown || !strokeLayer) return;
    stampSegment(strokeLayer, last, pt, opts());
    last = { ...pt };
    emit('layer:content', { layerId: strokeLayer.id });
  },

  onPointerUp(pt) {
    if (!painting) return;
    painting = false;
    if (strokeLayer) {
      stampSegment(strokeLayer, last, pt, opts());
      emit('layer:content', { layerId: strokeLayer.id });
    }
    strokeLayer = null;
    last = null;
    selMask = null;
  },

  onDeactivate() {
    painting = false;
    strokeLayer = null;
    last = null;
    selMask = null;
  },
};
