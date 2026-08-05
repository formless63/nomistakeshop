// js/tools/shapes.js — rect / ellipse / line, filled or stroked.
// Live preview via snapshot-restore: snapshot at pointerdown, restore+redraw
// on move, commit on up. Draws with the primary color.

import { state, emit, getToolOption } from '../core/state.js';
import { getActiveLayer } from '../core/document.js';
import { cloneCanvas } from '../core/canvasUtils.js';
import { withSelectionClip } from './selectionPath.js';

let snapshot = null;
let start = null;

function drawShape(layer, a, b) {
  const shape = getToolOption('shapes', 'shape', 'rect');
  const filled = getToolOption('shapes', 'filled', true);
  const strokeSize = getToolOption('shapes', 'strokeSize', 4);
  const ctx = layer.ctx;

  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
  ctx.drawImage(snapshot, 0, 0);
  ctx.restore();

  withSelectionClip(ctx, (c) => {
    c.beginPath();
    if (shape === 'ellipse') {
      c.ellipse(
        (a.x + b.x) / 2, (a.y + b.y) / 2,
        Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2,
        0, 0, Math.PI * 2
      );
    } else if (shape === 'line') {
      c.moveTo(a.x, a.y);
      c.lineTo(b.x, b.y);
    } else {
      c.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    }
    if (filled && shape !== 'line') {
      c.fillStyle = state.primaryColor;
      c.fill();
    } else {
      c.strokeStyle = state.primaryColor;
      c.lineWidth = strokeSize;
      c.stroke();
    }
  });
  emit('layer:content', { layerId: layer.id });
}

export default {
  id: 'shapes',
  label: 'Shapes',
  icon: '🔷',
  cursor: 'crosshair',
  destructive: true,
  options: [
    {
      key: 'shape', label: 'Shape', type: 'select', default: 'rect',
      choices: [
        { value: 'rect', label: 'Rectangle' },
        { value: 'ellipse', label: 'Ellipse' },
        { value: 'line', label: 'Line' },
      ],
    },
    { key: 'filled', label: 'Filled', type: 'checkbox', default: true },
    { key: 'strokeSize', label: 'Stroke Size', type: 'range', min: 1, max: 50, step: 1, default: 4 },
  ],

  onPointerDown(pt) {
    const layer = getActiveLayer();
    if (!layer || layer.type !== 'pixel') {
      emit('status:message', { text: 'Select a pixel layer' });
      return;
    }
    snapshot = cloneCanvas(layer.canvas);
    start = { ...pt };
    drawShape(layer, start, pt);
  },

  onPointerMove(pt) {
    if (!snapshot || !state.isPointerDown) return;
    const layer = getActiveLayer();
    if (!layer) return;
    drawShape(layer, start, pt);
  },

  onPointerUp(pt) {
    if (!snapshot) return;
    const layer = getActiveLayer();
    if (layer) drawShape(layer, start, pt);
    snapshot = null;
    start = null;
  },

  onDeactivate() {
    snapshot = null;
    start = null;
  },
};
