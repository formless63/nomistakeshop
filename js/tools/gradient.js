// js/tools/gradient.js — drag-defined gradient fill (primary -> secondary).
// Live preview via snapshot-restore: the layer canvas is snapshotted at
// pointerdown, restored on every move, then the gradient is redrawn.

import { state, emit, getToolOption } from '../core/state.js';
import { getActiveLayer } from '../core/document.js';
import { cloneCanvas } from '../core/canvasUtils.js';
import { withSelectionClip } from './selectionPath.js';

let snapshot = null;
let start = null;

function drawGradient(layer, from, to) {
  const ctx = layer.ctx;
  const w = layer.canvas.width;
  const h = layer.canvas.height;
  const type = getToolOption('gradient', 'type', 'linear');

  // Restore pre-drag pixels, then paint the gradient on top.
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(snapshot, 0, 0);
  ctx.restore();

  withSelectionClip(ctx, (c) => {
    let grad;
    if (type === 'radial') {
      const radius = Math.max(1, Math.hypot(to.x - from.x, to.y - from.y));
      grad = c.createRadialGradient(from.x, from.y, 0, from.x, from.y, radius);
    } else {
      grad = c.createLinearGradient(from.x, from.y, to.x, to.y);
    }
    grad.addColorStop(0, state.primaryColor);
    grad.addColorStop(1, state.secondaryColor);
    c.fillStyle = grad;
    c.fillRect(0, 0, w, h);
  });
  emit('layer:content', { layerId: layer.id });
}

export default {
  id: 'gradient',
  label: 'Gradient',
  icon: '🌈',
  cursor: 'crosshair',
  destructive: true,
  options: [
    {
      key: 'type', label: 'Type', type: 'select', default: 'linear',
      choices: [
        { value: 'linear', label: 'Linear' },
        { value: 'radial', label: 'Radial' },
      ],
    },
  ],

  onPointerDown(pt) {
    const layer = getActiveLayer();
    if (!layer || layer.type !== 'pixel') {
      emit('status:message', { text: 'Select a pixel layer' });
      return;
    }
    snapshot = cloneCanvas(layer.canvas);
    start = { ...pt };
    drawGradient(layer, start, pt);
  },

  onPointerMove(pt) {
    if (!snapshot || !state.isPointerDown) return;
    const layer = getActiveLayer();
    if (!layer) return;
    drawGradient(layer, start, pt);
  },

  onPointerUp(pt) {
    if (!snapshot) return;
    const layer = getActiveLayer();
    if (layer) drawGradient(layer, start, pt);
    snapshot = null;
    start = null;
  },

  onDeactivate() {
    snapshot = null;
    start = null;
  },
};
