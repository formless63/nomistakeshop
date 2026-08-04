// js/tools/eyedropper.js — picks a color from the FLATTENED composite.
// Click = primary color; alt-click or right-click = secondary color.

import { setColor } from '../core/state.js';
import { flattenImage } from '../core/document.js';
import { rgbToHex, clamp } from '../core/canvasUtils.js';

function pick(pt, e) {
  const flat = flattenImage();
  if (!flat) return;
  const x = clamp(Math.round(pt.x), 0, flat.width - 1);
  const y = clamp(Math.round(pt.y), 0, flat.height - 1);
  const ctx = flat.getContext('2d');
  const d = ctx.getImageData(x, y, 1, 1).data;
  const hex = rgbToHex(d[0], d[1], d[2]);
  if (e.altKey || e.button === 2) setColor('secondary', hex);
  else setColor('primary', hex);
}

export default {
  id: 'eyedropper',
  label: 'Eyedropper',
  icon: '💉',
  cursor: 'crosshair',
  destructive: false,
  options: [],

  onPointerDown(pt, e) {
    pick(pt, e);
  },

  onPointerMove(pt, e) {
    if (pt && e && e.buttons) pick(pt, e); // drag-pick while held
  },

  onPointerUp() {},
};
