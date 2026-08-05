// Doc-wide transform operations: rotate / flip / resize / crop.
// Every op pushes history BEFORE mutating, then emits 'doc:changed' + 'layer:content'
// (layer flips emit 'layer:content' only). Ops that change dimensions clear the selection.

import { state, emit, setSelection } from '../core/state.js';
import { history } from '../core/history.js';
import { createCanvas } from '../core/canvasUtils.js';
import { smartLayerToPixel, setSmartTransform } from '../core/document.js';

function getDoc() {
  return state.doc || null;
}

function dim(v, fallback) {
  v = Math.round(Number(v));
  return Number.isFinite(v) && v >= 1 ? v : fallback;
}

function emitDocChanged() {
  emit('doc:changed');
  emit('layer:content');
}

// Rebuild every pixel layer's canvas (and mask, if any) at (newW, newH)
// via drawFn(ctx, oldCanvas). Adjustment layers carry no pixels — skipped.
// Smart layers are RASTERIZED first (same in-place swap as
// rasterizeSmartLayer, but without per-layer history pushes — the calling
// op's single history.push covers it); one status message reports the count.
function rebuildLayers(doc, newW, newH, drawFn, opLabel) {
  let rasterized = 0;
  for (let i = 0; i < doc.layers.length; i++) {
    const layer = doc.layers[i];
    if (layer && layer.type === 'smart') {
      smartLayerToPixel(doc, layer);
      rasterized++;
    }
  }
  if (rasterized > 0) {
    emit('status:message', { text: `${rasterized} smart layer(s) rasterized by ${opLabel}` });
  }
  for (const layer of doc.layers) {
    if (layer.type === 'adjustment') continue;
    const { canvas, ctx } = createCanvas(newW, newH);
    drawFn(ctx, layer.canvas);
    layer.canvas = canvas;
    layer.ctx = ctx;
    if (layer.mask) {
      const m = createCanvas(newW, newH);
      drawFn(m.ctx, layer.mask.canvas);
      layer.mask.canvas = m.canvas;
      layer.mask.ctx = m.ctx;
    }
  }
}

export function rotate90(dir) {
  const doc = getDoc();
  if (!doc) return;
  const cw = dir >= 0; // 1 = CW, -1 = CCW
  const label = cw ? 'Rotate 90° CW' : 'Rotate 90° CCW';
  history.push(label);
  const newW = doc.height;
  const newH = doc.width;
  rebuildLayers(doc, newW, newH, (ctx, old) => {
    if (cw) {
      ctx.translate(newW, 0);
      ctx.rotate(Math.PI / 2);
    } else {
      ctx.translate(0, newH);
      ctx.rotate(-Math.PI / 2);
    }
    ctx.drawImage(old, 0, 0);
  }, label);
  doc.width = newW;
  doc.height = newH;
  setSelection(null);
  emitDocChanged();
}

export function rotate180() {
  const doc = getDoc();
  if (!doc) return;
  history.push('Rotate 180°');
  rebuildLayers(doc, doc.width, doc.height, (ctx, old) => {
    ctx.translate(doc.width, doc.height);
    ctx.rotate(Math.PI);
    ctx.drawImage(old, 0, 0);
  }, 'Rotate 180°');
  emitDocChanged();
}

export function flipCanvasHorizontal() {
  const doc = getDoc();
  if (!doc) return;
  history.push('Flip Canvas Horizontal');
  rebuildLayers(doc, doc.width, doc.height, (ctx, old) => {
    ctx.translate(doc.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(old, 0, 0);
  }, 'Flip Canvas Horizontal');
  emitDocChanged();
}

export function flipCanvasVertical() {
  const doc = getDoc();
  if (!doc) return;
  history.push('Flip Canvas Vertical');
  rebuildLayers(doc, doc.width, doc.height, (ctx, old) => {
    ctx.translate(0, doc.height);
    ctx.scale(1, -1);
    ctx.drawImage(old, 0, 0);
  }, 'Flip Canvas Vertical');
  emitDocChanged();
}

function flipLayer(id, horizontal) {
  const doc = getDoc();
  if (!doc) return;
  const layer = doc.layers.find((l) => l.id === id);
  if (!layer || layer.type === 'adjustment') return;
  if (layer.type === 'smart') {
    // Smart layers carry no pixel canvas — rasterize (or transform) first.
    emit('status:message', { text: 'Smart layers cannot be flipped — rasterize first' });
    return;
  }
  history.push(horizontal ? 'Flip Layer Horizontal' : 'Flip Layer Vertical');
  const flipCanvasInPlace = (canvas, ctx) => {
    const w = canvas.width;
    const h = canvas.height;
    // Intermediate copy so we never draw a canvas onto itself mid-transform.
    const { canvas: tmp, ctx: tmpCtx } = createCanvas(w, h);
    tmpCtx.drawImage(canvas, 0, 0);
    ctx.save();
    ctx.clearRect(0, 0, w, h);
    if (horizontal) {
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    } else {
      ctx.translate(0, h);
      ctx.scale(1, -1);
    }
    ctx.drawImage(tmp, 0, 0);
    ctx.restore();
  };
  flipCanvasInPlace(layer.canvas, layer.ctx);
  if (layer.mask) flipCanvasInPlace(layer.mask.canvas, layer.mask.ctx);
  emit('layer:content', { layerId: id });
}

export function flipLayerHorizontal(id) {
  flipLayer(id, true);
}

export function flipLayerVertical(id) {
  flipLayer(id, false);
}

export function resizeImage(newW, newH) {
  const doc = getDoc();
  if (!doc) return;
  const w = dim(newW, doc.width);
  const h = dim(newH, doc.height);
  if (w === doc.width && h === doc.height) return;
  history.push('Image Size');
  rebuildLayers(doc, w, h, (ctx, old) => {
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(old, 0, 0, w, h);
  }, 'Image Size');
  doc.width = w;
  doc.height = h;
  setSelection(null);
  emitDocChanged();
}

const ANCHORS = ['center', 'tl', 't', 'tr', 'l', 'r', 'bl', 'b', 'br'];

function anchorOffset(anchor, oldSize, newSize, isX) {
  const start = isX ? ['tl', 'l', 'bl'] : ['tl', 't', 'tr'];
  const end = isX ? ['tr', 'r', 'br'] : ['bl', 'b', 'br'];
  if (start.includes(anchor)) return 0;
  if (end.includes(anchor)) return newSize - oldSize;
  return Math.round((newSize - oldSize) / 2); // center column/row
}

export function resizeCanvas(newW, newH, anchor = 'center') {
  const doc = getDoc();
  if (!doc) return;
  const w = dim(newW, doc.width);
  const h = dim(newH, doc.height);
  if (!ANCHORS.includes(anchor)) anchor = 'center';
  history.push('Canvas Size');
  const dx = anchorOffset(anchor, doc.width, w, true);
  const dy = anchorOffset(anchor, doc.height, h, false);
  rebuildLayers(doc, w, h, (ctx, old) => {
    ctx.drawImage(old, dx, dy);
  }, 'Canvas Size');
  doc.width = w;
  doc.height = h;
  setSelection(null);
  emitDocChanged();
}

export function cropToRect(rect) {
  const doc = getDoc();
  if (!doc || !rect) return;
  const x0 = Math.max(0, Math.min(doc.width, Math.floor(Number(rect.x) || 0)));
  const y0 = Math.max(0, Math.min(doc.height, Math.floor(Number(rect.y) || 0)));
  const x1 = Math.max(0, Math.min(doc.width, Math.ceil((Number(rect.x) || 0) + (Number(rect.w) || 0))));
  const y1 = Math.max(0, Math.min(doc.height, Math.ceil((Number(rect.y) || 0) + (Number(rect.h) || 0))));
  const w = x1 - x0;
  const h = y1 - y0;
  if (w <= 0 || h <= 0) return; // empty or fully outside — no-op
  history.push('Crop');
  rebuildLayers(doc, w, h, (ctx, old) => {
    ctx.drawImage(old, x0, y0, w, h, 0, 0, w, h);
  }, 'Crop');
  doc.width = w;
  doc.height = h;
  setSelection(null);
  emitDocChanged();
}

// Scale/rotate the active layer (doc size unchanged).
// Smart layers: non-destructive — the transform accumulates (multiplicative
// scale, additive rotate) and the pristine source is re-rendered, so quality
// never degrades. Pixel layers: destructive in-place redraw as before.
export function transformActiveLayer({ scaleXPct = 100, scaleYPct = 100, rotateDeg = 0 } = {}) {
  const doc = getDoc();
  if (!doc) return;
  const layer = doc.layers.find((l) => l.id === doc.activeLayerId);
  if (!layer || layer.type === 'adjustment') return;
  const sx = Number(scaleXPct) / 100;
  const sy = Number(scaleYPct) / 100;
  const deg = Number(rotateDeg) || 0;
  const rad = deg * (Math.PI / 180);
  if (!Number.isFinite(sx) || !Number.isFinite(sy) || sx <= 0 || sy <= 0) return;
  if (sx === 1 && sy === 1 && rad === 0) return; // identity — no-op
  history.push('Transform Layer');
  if (layer.type === 'smart') {
    const cur = layer.transform;
    setSmartTransform(layer.id, {
      scaleX: cur.scaleX * sx,
      scaleY: cur.scaleY * sy,
      rotateDeg: cur.rotateDeg + deg,
    });
    return;
  }
  const transformInPlace = (canvas, ctx) => {
    const w = canvas.width;
    const h = canvas.height;
    const { canvas: tmp, ctx: tmpCtx } = createCanvas(w, h);
    tmpCtx.drawImage(canvas, 0, 0);
    ctx.save();
    ctx.clearRect(0, 0, w, h);
    ctx.translate(w / 2, h / 2);
    ctx.rotate(rad);
    ctx.scale(sx, sy);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(tmp, -w / 2, -h / 2);
    ctx.restore();
  };
  transformInPlace(layer.canvas, layer.ctx);
  if (layer.mask) transformInPlace(layer.mask.canvas, layer.mask.ctx);
  emit('layer:content', { layerId: layer.id });
}
