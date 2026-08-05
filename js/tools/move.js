// js/tools/move.js — drags the active layer's pixels (and its mask, when
// present, by the same delta). Snapshots both canvases at pointerdown; on
// move, clears and redraws them shifted by the integer drag delta; commits
// on pointerup. Adjustment layers have no pixels: status message, no-op.
// Smart layers drag non-destructively: pointerdown snapshots the transform,
// drag sets offsetX/offsetY = snapshot + integer delta via setSmartTransform
// (the tool's destructive history.push on stroke start covers undo).

import { emit } from '../core/state.js';
import { getActiveLayer, setSmartTransform } from '../core/document.js';
import { cloneCanvas } from '../core/canvasUtils.js';

let snapshot = null;
let maskSnapshot = null;
let transformSnapshot = null;
let start = null;
let lastDx = 0;
let lastDy = 0;

function shiftCanvas(ctx, canvas, snap, dx, dy) {
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(snap, dx, dy);
  ctx.restore();
}

function applyOffset(layer, dx, dy) {
  shiftCanvas(layer.ctx, layer.canvas, snapshot, dx, dy);
  if (maskSnapshot && layer.mask) {
    shiftCanvas(layer.mask.ctx, layer.mask.canvas, maskSnapshot, dx, dy);
  }
  emit('layer:content', { layerId: layer.id });
}

function applySmartOffset(layer, dx, dy) {
  setSmartTransform(layer.id, {
    offsetX: transformSnapshot.offsetX + dx,
    offsetY: transformSnapshot.offsetY + dy,
  });
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
    if (layer.type === 'adjustment') {
      emit('status:message', { text: 'Adjustment layers cannot be moved' });
      return;
    }
    if (layer.type === 'smart') {
      transformSnapshot = { ...layer.transform };
      start = { ...pt };
      lastDx = 0;
      lastDy = 0;
      return;
    }
    snapshot = cloneCanvas(layer.canvas);
    maskSnapshot = layer.mask ? cloneCanvas(layer.mask.canvas) : null;
    start = { ...pt };
    lastDx = 0;
    lastDy = 0;
  },

  onPointerMove(pt) {
    if (transformSnapshot) {
      const layer = getActiveLayer();
      if (!layer || layer.type !== 'smart') return;
      const dx = Math.round(pt.x - start.x);
      const dy = Math.round(pt.y - start.y);
      if (dx === lastDx && dy === lastDy) return;
      lastDx = dx;
      lastDy = dy;
      applySmartOffset(layer, dx, dy);
      return;
    }
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
    if (transformSnapshot) {
      const layer = getActiveLayer();
      if (layer && layer.type === 'smart') {
        applySmartOffset(layer, Math.round(pt.x - start.x), Math.round(pt.y - start.y));
      }
      transformSnapshot = null;
      start = null;
      return;
    }
    if (!snapshot) return;
    const layer = getActiveLayer();
    if (layer) {
      applyOffset(layer, Math.round(pt.x - start.x), Math.round(pt.y - start.y));
    }
    snapshot = null;
    maskSnapshot = null;
    start = null;
  },

  onDeactivate() {
    snapshot = null;
    maskSnapshot = null;
    transformSnapshot = null;
    start = null;
  },
};
