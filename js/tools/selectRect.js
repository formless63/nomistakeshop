// js/tools/selectRect.js — rectangular marquee. Updates state.selection live
// while dragging; non-destructive (no history push).

import { setSelection } from '../core/state.js';

let dragging = false;
let start = null;

function normRect(a, b) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
}

export default {
  id: 'selectRect',
  label: 'Rect Select',
  icon: '⬚',
  cursor: 'crosshair',
  destructive: false,
  options: [],

  onPointerDown(pt) {
    dragging = true;
    start = { ...pt };
    const r = normRect(start, pt);
    setSelection({ type: 'rect', x: r.x, y: r.y, w: r.w, h: r.h });
  },

  onPointerMove(pt) {
    if (!dragging) return;
    const r = normRect(start, pt);
    setSelection({ type: 'rect', x: r.x, y: r.y, w: r.w, h: r.h });
  },

  onPointerUp(pt) {
    if (!dragging) return;
    dragging = false;
    const r = normRect(start, pt);
    if (r.w < 1 && r.h < 1) setSelection(null); // plain click clears selection
    else setSelection({ type: 'rect', x: r.x, y: r.y, w: r.w, h: r.h });
    start = null;
  },

  onDeactivate() {
    dragging = false;
    start = null;
  },
};
