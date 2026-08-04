// js/tools/crop.js — drag a rect, confirm, then transform.cropToRect.
// While dragging the rect is shown via the live selection outline; the
// previous selection is restored if the user cancels.
// destructive: false — cropToRect pushes its own history snapshot.

import { state, setSelection } from '../core/state.js';
import { cropToRect } from '../ops/transform.js';

let dragging = false;
let start = null;
let rect = null;
let prevSelection = null;

function normRect(a, b) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
}

export default {
  id: 'crop',
  label: 'Crop',
  icon: '✂️',
  cursor: 'crosshair',
  destructive: false,
  options: [],

  onPointerDown(pt) {
    if (!state.doc) return;
    dragging = true;
    start = { ...pt };
    rect = null;
    prevSelection = state.selection;
  },

  onPointerMove(pt) {
    if (!dragging) return;
    rect = normRect(start, pt);
    setSelection({ type: 'rect', ...rect });
  },

  async onPointerUp(pt) {
    if (!dragging) return;
    dragging = false;
    rect = normRect(start, pt);
    start = null;
    const r = rect;
    rect = null;
    if (r.w < 2 || r.h < 2) {
      setSelection(prevSelection);
      prevSelection = null;
      return;
    }
    const dialogs = await import('../ui/dialogs.js');
    const ok = await dialogs.confirm(
      `Crop to ${Math.round(r.w)}×${Math.round(r.h)}?`
    );
    if (ok) {
      prevSelection = null;
      cropToRect(r); // pushes history, clears selection, emits events
    } else {
      setSelection(prevSelection);
      prevSelection = null;
    }
  },

  onDeactivate() {
    if (dragging) {
      dragging = false;
      setSelection(prevSelection);
    }
    start = rect = prevSelection = null;
  },
};
