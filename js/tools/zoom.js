// js/tools/zoom.js — click zooms in around the clicked screen point,
// alt-click zooms out. zoomAt takes SCREEN coords, so we use offsetX/offsetY.

import { renderer } from '../core/renderer.js';

export default {
  id: 'zoom',
  label: 'Zoom',
  icon: '🔍',
  cursor: 'zoom-in',
  destructive: false,
  options: [],

  onPointerDown(pt, e) {
    renderer.zoomAt(e.altKey ? 0.8 : 1.25, e.offsetX, e.offsetY);
  },

  onPointerMove() {},
  onPointerUp() {},
};
