// js/tools/eraser.js — same stroke engine as brush, painting with
// 'destination-out' into getPaintTarget() (erasing a mask is destination-
// out on the mask ctx). Color is irrelevant; the stamp only carries alpha.

import { state, emit, getToolOption } from '../core/state.js';
import { getPaintTarget } from '../core/document.js';
import { createCanvas } from '../core/canvasUtils.js';
import { withSelectionClip } from './selectionPath.js';

const stampCache = new Map();

// Alpha-only radial-gradient dab (see brush.js for the hardness model).
function getStamp(size, hardness) {
  const key = `${size}|${hardness}`;
  let stamp = stampCache.get(key);
  if (stamp) return stamp;
  if (stampCache.size > 16) stampCache.clear();
  const { canvas, ctx } = createCanvas(size, size);
  const radius = size / 2;
  const hard = Math.min(1, Math.max(0, hardness / 100));
  const grad = ctx.createRadialGradient(radius, radius, 0, radius, radius, radius);
  grad.addColorStop(0, 'rgba(0,0,0,1)');
  grad.addColorStop(Math.min(hard, 0.999), 'rgba(0,0,0,1)');
  if (hard < 1) grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  stampCache.set(key, canvas);
  return canvas;
}

function quadPoint(p0, p1, p2, t) {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
    y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
  };
}

let painting = false;
let last = null;
let lastMid = null;
let strokeCtx = null;   // paint-target ctx captured at pointerdown
let strokeLayer = null; // layer owning that ctx (for layer:content payloads)

function opts() {
  return {
    size: getToolOption('eraser', 'size', 12),
    hardness: getToolOption('eraser', 'hardness', 100),
    opacity: getToolOption('eraser', 'opacity', 100) / 100,
  };
}

function stampAt(ctx, stamp, size, opacity, x, y) {
  ctx.globalAlpha = opacity;
  ctx.globalCompositeOperation = 'destination-out';
  ctx.drawImage(stamp, x - size / 2, y - size / 2);
}

function stampSegment(ctx, stamp, size, opacity, spacing, p0, c, p1) {
  const approxLen = Math.hypot(c.x - p0.x, c.y - p0.y) + Math.hypot(p1.x - c.x, p1.y - c.y);
  const steps = Math.max(1, Math.ceil(approxLen / spacing));
  for (let i = 1; i <= steps; i++) {
    const p = quadPoint(p0, c, p1, i / steps);
    stampAt(ctx, stamp, size, opacity, p.x, p.y);
  }
}

export default {
  id: 'eraser',
  label: 'Eraser',
  icon: '🧽',
  cursor: 'crosshair',
  destructive: true,
  options: [
    { key: 'size', label: 'Size', type: 'range', min: 1, max: 300, step: 1, default: 12 },
    { key: 'hardness', label: 'Hardness', type: 'range', min: 0, max: 100, step: 1, default: 100 },
    { key: 'opacity', label: 'Opacity', type: 'range', min: 1, max: 100, step: 1, default: 100 },
  ],

  onPointerDown(pt) {
    const target = getPaintTarget();
    if (!target) {
      emit('status:message', { text: 'Select a pixel layer' });
      return;
    }
    const { ctx, layer } = target;
    strokeCtx = ctx;
    strokeLayer = layer;
    const { size, hardness, opacity } = opts();
    const stamp = getStamp(size, hardness);
    withSelectionClip(ctx, (c) => stampAt(c, stamp, size, opacity, pt.x, pt.y));
    painting = true;
    last = { ...pt };
    lastMid = { ...pt };
    emit('layer:content', { layerId: layer.id });
  },

  onPointerMove(pt) {
    if (!painting || !state.isPointerDown || !strokeCtx) return;
    const { size, hardness, opacity } = opts();
    const stamp = getStamp(size, hardness);
    const spacing = Math.max(0.5, size / 4);
    const mid = { x: (last.x + pt.x) / 2, y: (last.y + pt.y) / 2 };
    withSelectionClip(strokeCtx, (ctx) =>
      stampSegment(ctx, stamp, size, opacity, spacing, lastMid, last, mid)
    );
    last = { ...pt };
    lastMid = mid;
    emit('layer:content', { layerId: strokeLayer.id });
  },

  onPointerUp(pt) {
    if (!painting) return;
    painting = false;
    if (strokeCtx) {
      const { size, hardness, opacity } = opts();
      const stamp = getStamp(size, hardness);
      const spacing = Math.max(0.5, size / 4);
      withSelectionClip(strokeCtx, (ctx) =>
        stampSegment(ctx, stamp, size, opacity, spacing, lastMid, last, pt)
      );
      emit('layer:content', { layerId: strokeLayer.id });
    }
    last = lastMid = null;
    strokeCtx = strokeLayer = null;
  },

  onDeactivate() {
    painting = false;
    last = lastMid = null;
    strokeCtx = strokeLayer = null;
  },
};
