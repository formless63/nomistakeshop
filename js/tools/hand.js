// js/tools/hand.js — drag pans the viewport via renderer.pan.
// Pan deltas are screen-space, so this tool tracks raw client coordinates.

import { renderer } from '../core/renderer.js';

let last = null;

export default {
  id: 'hand',
  label: 'Hand',
  icon: '✋',
  cursor: 'grab',
  destructive: false,
  options: [],

  onPointerDown(pt, e) {
    last = { x: e.clientX, y: e.clientY };
  },

  onPointerMove(pt, e) {
    if (!last) return;
    renderer.pan(e.clientX - last.x, e.clientY - last.y);
    last = { x: e.clientX, y: e.clientY };
  },

  onPointerUp() {
    last = null;
  },

  onDeactivate() {
    last = null;
  },
};
