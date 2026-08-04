// js/tools/selectionPath.js — builds a canvas path from state.selection so
// tools can ctx.clip() their drawing to the active selection.
// Selection shapes: null | { type:'rect', x,y,w,h } | { type:'lasso', points:[{x,y}...] }

import { state } from '../core/state.js';

// Traces the selection onto ctx's current path (doc coordinates).
// Caller is responsible for ctx.save()/ctx.restore() around clip+draw.
export function traceSelectionPath(ctx, selection) {
  ctx.beginPath();
  if (!selection) return;
  if (selection.type === 'rect') {
    ctx.rect(selection.x, selection.y, selection.w, selection.h);
  } else if (selection.type === 'lasso' && selection.points && selection.points.length) {
    const pts = selection.points;
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
  }
}

// Convenience wrapper: runs drawFn(ctx) clipped to state.selection (when one
// exists), restoring the context afterwards.
export function withSelectionClip(ctx, drawFn) {
  ctx.save();
  if (state.selection) {
    traceSelectionPath(ctx, state.selection);
    ctx.clip();
  }
  drawFn(ctx);
  ctx.restore();
}
