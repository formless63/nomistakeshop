// js/tools/lasso.js — freehand polygon selection. Points accumulate while
// dragging; state.selection updates live. Non-destructive.

import { setSelection } from '../core/state.js';

let dragging = false;
let points = [];

export default {
  id: 'lasso',
  label: 'Lasso',
  icon: '〰️',
  cursor: 'crosshair',
  destructive: false,
  options: [],

  onPointerDown(pt) {
    dragging = true;
    points = [{ ...pt }];
    setSelection({ type: 'lasso', points: points.slice() });
  },

  onPointerMove(pt) {
    if (!dragging) return;
    const last = points[points.length - 1];
    // Skip sub-pixel jitter so the path stays light.
    if (Math.hypot(pt.x - last.x, pt.y - last.y) < 1) return;
    points.push({ ...pt });
    setSelection({ type: 'lasso', points: points.slice() });
  },

  onPointerUp() {
    if (!dragging) return;
    dragging = false;
    if (points.length < 3) setSelection(null); // too small to be a region
    else setSelection({ type: 'lasso', points: points.slice() });
    points = [];
  },

  onDeactivate() {
    dragging = false;
    points = [];
  },
};
