// js/core/renderer.js — composites state.doc onto the display canvas.
// Display canvas is sized to the CSS pixel size of #viewport, scaled by
// devicePixelRatio for crispness. Zoom/pan live in state; renderer reads
// and writes them. All DOM access happens inside functions (init/render),
// so importing this module in Node is safe.

import { state, on, emit } from './state.js';

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 32;

let canvas = null;
let ctx = null;
let viewport = null;
let resizeObserver = null;
let checkerPattern = null;

function clampZoom(z) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

function makeCheckerPattern() {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 16;
  const p = c.getContext('2d');
  p.fillStyle = '#ffffff';
  p.fillRect(0, 0, 16, 16);
  p.fillStyle = '#c8c8c8';
  p.fillRect(0, 0, 8, 8);
  p.fillRect(8, 8, 8, 8);
  return ctx.createPattern(c, 'repeat');
}

function resizeToViewport() {
  if (!canvas || !viewport) return;
  const dpr = window.devicePixelRatio || 1;
  const w = viewport.clientWidth;
  const h = viewport.clientHeight;
  if (!w || !h) return;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
}

function traceSelectionPath(context, sel) {
  context.beginPath();
  if (sel.type === 'rect') {
    const a = renderer.docToScreen(sel.x, sel.y);
    context.rect(a.x, a.y, sel.w * state.zoom, sel.h * state.zoom);
  } else if (sel.type === 'lasso' && sel.points && sel.points.length) {
    const p0 = renderer.docToScreen(sel.points[0].x, sel.points[0].y);
    context.moveTo(p0.x, p0.y);
    for (let i = 1; i < sel.points.length; i++) {
      const p = renderer.docToScreen(sel.points[i].x, sel.points[i].y);
      context.lineTo(p.x, p.y);
    }
    context.closePath();
  }
}

function drawSelection(context, sel) {
  traceSelectionPath(context, sel);
  context.save();
  context.lineWidth = 1;
  context.setLineDash([]);
  context.strokeStyle = 'rgba(255,255,255,0.9)';
  context.stroke();
  context.setLineDash([4, 4]);
  context.strokeStyle = 'rgba(0,0,0,0.9)';
  context.stroke();
  context.restore();
}

export const renderer = {
  init(displayCanvas) {
    canvas = displayCanvas;
    ctx = canvas.getContext('2d');
    viewport = document.getElementById('viewport') || canvas.parentElement;
    checkerPattern = null;
    resizeToViewport();
    if (typeof ResizeObserver !== 'undefined' && viewport) {
      resizeObserver = new ResizeObserver(() => {
        resizeToViewport();
        renderer.render();
      });
      resizeObserver.observe(viewport);
    }
    const rerender = () => renderer.render();
    on('layer:content', rerender);
    on('doc:changed', rerender);
    on('layers:changed', rerender);
    on('selection:changed', rerender);
    on('view:changed', rerender);
    renderer.render();
  },

  render() {
    if (!ctx || !canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const vw = canvas.width / dpr;
    const vh = canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, vw, vh);
    ctx.fillStyle = '#3a3a3a';
    ctx.fillRect(0, 0, vw, vh);

    const doc = state.doc;
    if (!doc) {
      ctx.fillStyle = '#aaaaaa';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('No document — create one via File > New Document', vw / 2, vh / 2);
      return;
    }

    const { zoom, panX, panY } = state;

    // Checkerboard for transparency (screen-space pattern).
    if (!checkerPattern) checkerPattern = makeCheckerPattern();
    ctx.save();
    ctx.fillStyle = checkerPattern;
    ctx.fillRect(panX, panY, doc.width * zoom, doc.height * zoom);
    ctx.restore();

    // Layers bottom (index 0) to top, respecting opacity + blend mode.
    ctx.save();
    ctx.translate(panX, panY);
    ctx.scale(zoom, zoom);
    ctx.imageSmoothingEnabled = zoom < 4;
    for (const layer of doc.layers) {
      if (!layer.visible) continue;
      ctx.save();
      ctx.globalAlpha = layer.opacity;
      ctx.globalCompositeOperation = layer.blendMode;
      ctx.drawImage(layer.canvas, 0, 0);
      ctx.restore();
    }
    ctx.restore();

    // Selection outline (dashed, marching-ants style).
    if (state.selection) drawSelection(ctx, state.selection);
  },

  setZoom(z) {
    state.zoom = clampZoom(z);
    emit('view:changed');
  },

  zoomAt(factor, cx, cy) {
    const before = renderer.screenToDoc(cx, cy);
    state.zoom = clampZoom(state.zoom * factor);
    state.panX = cx - before.x * state.zoom;
    state.panY = cy - before.y * state.zoom;
    emit('view:changed');
  },

  pan(dx, dy) {
    state.panX += dx;
    state.panY += dy;
    emit('view:changed');
  },

  fitToScreen() {
    const doc = state.doc;
    if (!doc || !viewport) return;
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    if (!vw || !vh) return;
    const margin = 40;
    const z = clampZoom(Math.min((vw - margin) / doc.width, (vh - margin) / doc.height));
    state.zoom = z;
    state.panX = (vw - doc.width * z) / 2;
    state.panY = (vh - doc.height * z) / 2;
    emit('view:changed');
  },

  screenToDoc(sx, sy) {
    return { x: (sx - state.panX) / state.zoom, y: (sy - state.panY) / state.zoom };
  },

  docToScreen(dx, dy) {
    return { x: dx * state.zoom + state.panX, y: dy * state.zoom + state.panY };
  },
};
