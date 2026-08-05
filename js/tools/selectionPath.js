// js/tools/selectionPath.js — selection path/mask helpers.
// Selection shapes:
//   null
//   | { type:'rect',    x,y,w,h, invert:false, feather:0 }
//   | { type:'ellipse', x,y,w,h, invert:false, feather:0 }
//   | { type:'lasso',   points:[{x,y}...], invert:false, feather:0 }
//   | { type:'mask',    mask: canvas }   // mask ALPHA 255 = selected
//
// This module must NOT import document.js (document.js imports this one);
// it reads doc dimensions from state.doc directly. DOM/Path2D are only
// touched inside functions, so importing in Node is safe.

import { state, emit } from '../core/state.js';
import { createCanvas } from '../core/canvasUtils.js';
import { boxBlur } from '../filters/filters.js';

// Traces the selection onto ctx's current path (doc coordinates).
// Caller is responsible for ctx.save()/ctx.restore() around clip+draw.
// Mask-type selections trace nothing (empty path).
export function traceSelectionPath(ctx, selection) {
  ctx.beginPath();
  if (!selection) return;
  if (selection.type === 'rect') {
    ctx.rect(selection.x, selection.y, selection.w, selection.h);
  } else if (selection.type === 'ellipse') {
    ctx.ellipse(
      selection.x + selection.w / 2, selection.y + selection.h / 2,
      Math.abs(selection.w) / 2, Math.abs(selection.h) / 2,
      0, 0, Math.PI * 2,
    );
  } else if (selection.type === 'lasso' && selection.points && selection.points.length) {
    const pts = selection.points;
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
  }
}

// Builds a standalone Path2D for a path-type selection (doc coordinates).
function buildSelectionPath(selection) {
  const path = new Path2D();
  if (selection.type === 'rect') {
    path.rect(selection.x, selection.y, selection.w, selection.h);
  } else if (selection.type === 'ellipse') {
    path.ellipse(
      selection.x + selection.w / 2, selection.y + selection.h / 2,
      Math.abs(selection.w) / 2, Math.abs(selection.h) / 2,
      0, 0, Math.PI * 2,
    );
  } else if (selection.type === 'lasso' && selection.points && selection.points.length) {
    const pts = selection.points;
    path.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) path.lineTo(pts[i].x, pts[i].y);
    path.closePath();
  }
  return path;
}

// Clips ctx to the current selection (caller wraps in save/restore).
// - rect/ellipse/lasso: plain path clip; invert adds a full-doc rect as the
//   outer subpath and clips with 'evenodd'.
// - mask type: NO-OP (paint tools draw unclipped — documented limitation;
//   raster ops should use getSelectionMask() instead).
// Feather is NOT applied here, only to raster ops via getSelectionMask().
export function clipSelection(ctx) {
  const sel = state.selection;
  if (!sel || sel.type === 'mask') return;
  const path = buildSelectionPath(sel);
  if (sel.invert && state.doc) {
    const outer = new Path2D();
    outer.rect(0, 0, state.doc.width, state.doc.height);
    outer.addPath(path);
    ctx.clip(outer, 'evenodd');
  } else {
    ctx.clip(path);
  }
}

// Rasterizes the current selection into a doc-sized mask canvas
// (white / alpha 255 = selected, transparent = not). Returns null when there
// is no selection (or no doc). Mask-type selections return their mask as-is.
// Feather > 0 applies a separable box blur of radius=feather to the mask.
export function getSelectionMask() {
  const doc = state.doc;
  const sel = state.selection;
  if (!doc || !sel) return null;
  if (sel.type === 'mask') return sel.mask;

  const { canvas, ctx } = createCanvas(doc.width, doc.height);
  const path = buildSelectionPath(sel);
  ctx.fillStyle = '#ffffff';
  if (sel.invert) {
    const outer = new Path2D();
    outer.rect(0, 0, doc.width, doc.height);
    outer.addPath(path);
    ctx.fill(outer, 'evenodd');
  } else {
    ctx.fill(path);
  }

  const feather = Math.round(sel.feather || 0);
  if (feather > 0) {
    const imageData = ctx.getImageData(0, 0, doc.width, doc.height);
    boxBlur(imageData, feather);
    ctx.putImageData(imageData, 0, 0);
  }
  return canvas;
}

// Toggles selection inversion. Path types flip their `invert` flag; mask-type
// selections pixel-invert the mask canvas in place (alpha channel is the
// selection channel; RGB is kept white for thumbnail legibility).
export function invertSelection() {
  const sel = state.selection;
  if (!sel) return;
  if (sel.type === 'mask') {
    const ctx = sel.mask.getContext('2d');
    const imageData = ctx.getImageData(0, 0, sel.mask.width, sel.mask.height);
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = 255;
      d[i + 1] = 255;
      d[i + 2] = 255;
      d[i + 3] = 255 - d[i + 3];
    }
    ctx.putImageData(imageData, 0, 0);
  } else {
    sel.invert = !sel.invert;
  }
  emit('selection:changed', sel);
}

// Sets selection feather in px. Path types store `feather` (applied at
// rasterization time by getSelectionMask); mask-type selections blur the
// mask canvas in place.
export function featherSelection(px) {
  const sel = state.selection;
  if (!sel) return;
  const radius = Math.max(0, Math.round(Number(px)) || 0);
  if (sel.type === 'mask') {
    if (radius > 0) {
      const ctx = sel.mask.getContext('2d');
      const imageData = ctx.getImageData(0, 0, sel.mask.width, sel.mask.height);
      boxBlur(imageData, radius);
      ctx.putImageData(imageData, 0, 0);
    }
  } else {
    sel.feather = radius;
  }
  emit('selection:changed', sel);
}

// Convenience wrapper: runs drawFn(ctx) clipped to state.selection (when one
// exists), restoring the context afterwards. (v1 API — kept for tools that
// clip via traceSelectionPath; new code should prefer clipSelection.)
export function withSelectionClip(ctx, drawFn) {
  ctx.save();
  if (state.selection) {
    traceSelectionPath(ctx, state.selection);
    ctx.clip();
  }
  drawFn(ctx);
  ctx.restore();
}
