// js/tools/selectEllipse.js — elliptical marquee. Updates state.selection
// live while dragging; non-destructive (no history push).

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

function makeSelection(a, b) {
  const r = normRect(a, b);
  return { type: 'ellipse', x: r.x, y: r.y, w: r.w, h: r.h, invert: false, feather: 0 };
}

export default {
  id: 'selectEllipse',
  label: 'Ellipse Select',
  icon: '◯',
  cursor: 'crosshair',
  destructive: false,
  options: [],

  onPointerDown(pt) {
    dragging = true;
    start = { ...pt };
    setSelection(makeSelection(start, pt));
  },

  onPointerMove(pt) {
    if (!dragging) return;
    setSelection(makeSelection(start, pt));
  },

  onPointerUp(pt) {
    if (!dragging) return;
    dragging = false;
    const sel = makeSelection(start, pt);
    if (sel.w < 1 && sel.h < 1) setSelection(null); // plain click clears selection
    else setSelection(sel);
    start = null;
  },

  onDeactivate() {
    dragging = false;
    start = null;
  },
};
