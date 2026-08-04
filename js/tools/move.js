// js/tools/move.js — drags the active layer's pixels.
// Snapshots the layer canvas at pointerdown; on move, clears and redraws it
// shifted by the integer drag delta; commits on pointerup.

import { emit } from '../core/state.js';
import { getActiveLayer } from '../core/document.js';
import { cloneCanvas } from '../core/canvasUtils.js';

let snapshot = null;
let start = null;
let lastDx = 0;
let lastDy = 0;

function applyOffset(layer, dx, dy) {
  const ctx = layer.ctx;
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
  ctx.drawImage(snapshot, dx, dy);
  ctx.restore();
  emit('layer:content', { layerId: layer.id });
}

export default {
  id: 'move',
  label: 'Move',
  icon: '✥',
  cursor: 'move',
  destructive: true,
  options: [],

  onPointerDown(pt) {
    const layer = getActiveLayer();
    if (!layer) return;
    snapshot = cloneCanvas(layer.canvas);
    start = { ...pt };
    lastDx = 0;
    lastDy = 0;
  },

  onPointerMove(pt) {
    if (!snapshot) return;
    const layer = getActiveLayer();
    if (!layer) return;
    const dx = Math.round(pt.x - start.x);
    const dy = Math.round(pt.y - start.y);
    if (dx === lastDx && dy === lastDy) return;
    lastDx = dx;
    lastDy = dy;
    applyOffset(layer, dx, dy);
  },

  onPointerUp(pt) {
    if (!snapshot) return;
    const layer = getActiveLayer();
    if (layer) {
      applyOffset(layer, Math.round(pt.x - start.x), Math.round(pt.y - start.y));
    }
    snapshot = null;
    start = null;
  },

  onDeactivate() {
    snapshot = null;
    start = null;
  },
};
