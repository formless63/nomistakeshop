// js/tools/clone.js — clone stamp. Always paints the ACTIVE PIXEL LAYER
// (never the mask, never adjustment layers).
//
// - Alt-click records the source doc-point ('Clone source set').
// - A normal pointerdown with no source shows 'Alt-click to set clone
//   source' and aborts — no history push. Because of this the tool is
//   destructive:false and pushes history.push('Clone Stamp') itself on
//   every real (stamping) stroke pointerdown.
// - Stamps copy circular dabs (radial-gradient alpha for hardness,
//   globalAlpha = opacity/100) from a snapshot taken at stroke start, so
//   self-overlap never smears. Aligned mode keeps the source anchored
//   across strokes (the recorded source advances with each stroke);
//   non-aligned re-samples from the original source point every stroke.
// - Stamping is clipped to the selection via clipSelection.

import { state, emit, getToolOption } from '../core/state.js';
import { getActiveLayer } from '../core/document.js';
import { history } from '../core/history.js';
import { createCanvas, cloneCanvas } from '../core/canvasUtils.js';
import { clipSelection } from './selectionPath.js';

const stampCache = new Map(); // hardness alpha mask per size|hardness

// Alpha-only radial dab used with 'destination-in' to shape each stamp.
function getStampMask(size, hardness) {
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

let source = null;     // recorded source doc-point (on the active layer)
let snapshot = null;   // layer canvas snapshot taken at stroke start
let strokeStart = null;
let last = null;
let strokeLayer = null;

function opts() {
  return {
    size: getToolOption('clone', 'size', 40),
    hardness: getToolOption('clone', 'hardness', 75),
    opacity: getToolOption('clone', 'opacity', 100) / 100,
    aligned: getToolOption('clone', 'aligned', true),
  };
}

function activePixelLayer() {
  const layer = getActiveLayer();
  if (!layer || layer.type === 'adjustment') return null;
  return layer;
}

// Copy one dab from the snapshot at (sx, sy) onto the layer at (dx, dy).
function stampAt(layer, sx, sy, dx, dy, size, hardness, opacity) {
  const dab = createCanvas(size, size);
  dab.ctx.drawImage(snapshot, sx - size / 2, sy - size / 2, size, size, 0, 0, size, size);
  dab.ctx.globalCompositeOperation = 'destination-in';
  dab.ctx.drawImage(getStampMask(size, hardness), 0, 0);
  const ctx = layer.ctx;
  ctx.save();
  clipSelection(ctx);
  ctx.globalAlpha = opacity;
  ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(dab.canvas, dx - size / 2, dy - size / 2);
  ctx.restore();
}

// Stamp along the segment a -> b with spacing <= size/4.
function stampSegment(layer, a, b, o) {
  const spacing = Math.max(0.5, o.size / 4);
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.max(1, Math.ceil(len / spacing));
  const offX = strokeStart.x - source.x; // dest - source at stroke start
  const offY = strokeStart.y - source.y;
  for (let i = 1; i <= steps; i++) {
    const x = a.x + ((b.x - a.x) * i) / steps;
    const y = a.y + ((b.y - a.y) * i) / steps;
    stampAt(layer, x - offX, y - offY, x, y, o.size, o.hardness, o.opacity);
  }
}

function endStroke(pt) {
  if (!strokeLayer) return;
  const o = opts();
  // Aligned mode: the source follows the stroke so the next stroke
  // continues from where this one ended. Non-aligned leaves `source`
  // untouched, so every new stroke samples from the recorded point.
  if (o.aligned && source && strokeStart) {
    source = {
      x: source.x + (pt.x - strokeStart.x),
      y: source.y + (pt.y - strokeStart.y),
    };
  }
  strokeLayer = null;
  snapshot = null;
  strokeStart = null;
  last = null;
}

export default {
  id: 'clone',
  label: 'Clone Stamp',
  icon: '🧬',
  cursor: 'crosshair',
  destructive: false, // pushes history itself, only on real strokes
  options: [
    { key: 'size', label: 'Size', type: 'range', min: 1, max: 300, step: 1, default: 40 },
    { key: 'hardness', label: 'Hardness', type: 'range', min: 0, max: 100, step: 1, default: 75 },
    { key: 'opacity', label: 'Opacity', type: 'range', min: 1, max: 100, step: 1, default: 100 },
    { key: 'aligned', label: 'Aligned', type: 'checkbox', default: true },
  ],

  onPointerDown(pt, e) {
    if (e && e.altKey) {
      if (!activePixelLayer()) {
        emit('status:message', { text: 'Select a pixel layer' });
        return;
      }
      source = { ...pt };
      emit('status:message', { text: 'Clone source set' });
      return;
    }
    const layer = activePixelLayer();
    if (!layer) {
      emit('status:message', { text: 'Select a pixel layer' });
      return;
    }
    if (!source) {
      emit('status:message', { text: 'Alt-click to set clone source' });
      return;
    }
    history.push('Clone Stamp'); // real stroke — own the undo step
    const o = opts();
    snapshot = cloneCanvas(layer.canvas);
    strokeLayer = layer;
    strokeStart = { ...pt };
    last = { ...pt };
    stampAt(layer, source.x, source.y, pt.x, pt.y, o.size, o.hardness, o.opacity);
    emit('layer:content', { layerId: layer.id });
  },

  onPointerMove(pt) {
    if (!strokeLayer || !state.isPointerDown) return;
    const o = opts();
    stampSegment(strokeLayer, last, pt, o);
    last = { ...pt };
    emit('layer:content', { layerId: strokeLayer.id });
  },

  onPointerUp(pt) {
    endStroke(pt);
  },

  onDeactivate() {
    // Finish any in-flight stroke; keep the recorded source across tools.
    endStroke(last || strokeStart || { x: 0, y: 0 });
  },
};
