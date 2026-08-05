// js/tools/brush.js — round brush with size/hardness/opacity options.
// Stamps a cached radial-gradient dab along quadratic-smoothed segments,
// spacing <= size/4. Paints state.primaryColor into getPaintTarget()
// (the layer itself, or its mask when the mask is targeted).
// Mask painting: mask ALPHA is visibility, so the painted color's luminance
// is mapped onto alpha — black hides (destination-out), white reveals
// (source-over white), gray partially hides/reveals.

import { state, emit, getToolOption } from '../core/state.js';
import { getPaintTarget } from '../core/document.js';
import { createCanvas, hexToRgb } from '../core/canvasUtils.js';
import { withSelectionClip } from './selectionPath.js';

const stampCache = new Map(); // key -> canvas (kept tiny, cleared when large)

// Hardness is rendered as a radial gradient: fully opaque out to
// (hardness/100) of the radius, fading to transparent at the edge.
// hardness=100 collapses to a solid disc.
function getStamp(size, hardness, colorHex) {
  const key = `${size}|${hardness}|${colorHex}`;
  let stamp = stampCache.get(key);
  if (stamp) return stamp;
  if (stampCache.size > 16) stampCache.clear();
  const { canvas, ctx } = createCanvas(size, size);
  const { r, g, b } = hexToRgb(colorHex);
  const rgb = `${r},${g},${b}`;
  const radius = size / 2;
  const hard = Math.min(1, Math.max(0, hardness / 100));
  const grad = ctx.createRadialGradient(radius, radius, 0, radius, radius, radius);
  grad.addColorStop(0, `rgba(${rgb},1)`);
  grad.addColorStop(Math.min(hard, 0.999), `rgba(${rgb},1)`);
  if (hard < 1) grad.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  stampCache.set(key, canvas);
  return canvas;
}

function quadPoint(p0, p1, p2, t) {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
    y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
  };
}

let painting = false;
let last = null;    // last raw pointer point
let lastMid = null; // last quadratic midpoint (curve anchor)
let strokeCtx = null;   // paint-target ctx captured at pointerdown
let strokeLayer = null; // layer owning that ctx (for layer:content payloads)
let strokeIsMask = false; // paint target is a layer mask (alpha = visibility)

function opts() {
  return {
    size: getToolOption('brush', 'size', 12),
    hardness: getToolOption('brush', 'hardness', 100),
    opacity: getToolOption('brush', 'opacity', 100) / 100,
  };
}

function stampAt(ctx, stamp, size, hardness, opacity, x, y) {
  if (strokeIsMask) {
    // Mask target: translate the painted color's luminance into visibility.
    const { r, g, b } = hexToRgb(state.primaryColor);
    const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    const hide = (1 - luma) * opacity;
    if (hide > 0) {
      ctx.globalAlpha = hide;
      ctx.globalCompositeOperation = 'destination-out';
      ctx.drawImage(stamp, x - size / 2, y - size / 2);
    }
    if (luma > 0) {
      ctx.globalAlpha = luma * opacity;
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(getStamp(size, hardness, '#ffffff'), x - size / 2, y - size / 2);
    }
    return;
  }
  ctx.globalAlpha = opacity;
  ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(stamp, x - size / 2, y - size / 2);
}

// Stamp along the quadratic from p0 (control c) to p1 with spacing <= size/4.
function stampSegment(ctx, stamp, size, hardness, opacity, spacing, p0, c, p1) {
  const approxLen = Math.hypot(c.x - p0.x, c.y - p0.y) + Math.hypot(p1.x - c.x, p1.y - c.y);
  const steps = Math.max(1, Math.ceil(approxLen / spacing));
  for (let i = 1; i <= steps; i++) {
    const p = quadPoint(p0, c, p1, i / steps);
    stampAt(ctx, stamp, size, hardness, opacity, p.x, p.y);
  }
}

export default {
  id: 'brush',
  label: 'Brush',
  icon: '🖌️',
  cursor: 'crosshair',
  destructive: true,
  options: [
    { key: 'size', label: 'Size', type: 'range', min: 1, max: 300, step: 1, default: 12 },
    { key: 'hardness', label: 'Hardness', type: 'range', min: 0, max: 100, step: 1, default: 100 },
    { key: 'opacity', label: 'Opacity', type: 'range', min: 1, max: 100, step: 1, default: 100 },
  ],

  onPointerDown(pt) {
    const target = getPaintTarget();
    if (!target) {
      emit('status:message', { text: 'Select a pixel layer' });
      return;
    }
    const { ctx, layer, isMask } = target;
    strokeCtx = ctx;
    strokeLayer = layer;
    strokeIsMask = !!isMask;
    const { size, hardness, opacity } = opts();
    const stamp = getStamp(size, hardness, state.primaryColor);
    withSelectionClip(ctx, (c) => stampAt(c, stamp, size, hardness, opacity, pt.x, pt.y));
    painting = true;
    last = { ...pt };
    lastMid = { ...pt };
    emit('layer:content', { layerId: layer.id });
  },

  onPointerMove(pt) {
    if (!painting || !state.isPointerDown || !strokeCtx) return;
    const { size, hardness, opacity } = opts();
    const stamp = getStamp(size, hardness, state.primaryColor);
    const spacing = Math.max(0.5, size / 4);
    // Quadratic smoothing: curve from lastMid through `last` to the new midpoint.
    const mid = { x: (last.x + pt.x) / 2, y: (last.y + pt.y) / 2 };
    withSelectionClip(strokeCtx, (ctx) =>
      stampSegment(ctx, stamp, size, hardness, opacity, spacing, lastMid, last, mid)
    );
    last = { ...pt };
    lastMid = mid;
    emit('layer:content', { layerId: strokeLayer.id });
  },

  onPointerUp(pt) {
    if (!painting) return;
    painting = false;
    if (strokeCtx) {
      const { size, hardness, opacity } = opts();
      const stamp = getStamp(size, hardness, state.primaryColor);
      const spacing = Math.max(0.5, size / 4);
      withSelectionClip(strokeCtx, (ctx) =>
        stampSegment(ctx, stamp, size, hardness, opacity, spacing, lastMid, last, pt)
      );
      emit('layer:content', { layerId: strokeLayer.id });
    }
    last = lastMid = null;
    strokeCtx = strokeLayer = null;
    strokeIsMask = false;
  },

  onDeactivate() {
    painting = false;
    last = lastMid = null;
    strokeCtx = strokeLayer = null;
    strokeIsMask = false;
  },
};
