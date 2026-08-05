// js/core/composite.js — single source of truth for flattening the layer stack.
// Used by renderer.js (display) and document.flattenImage() (export/tools).
// Imports ONLY filters.js + canvasUtils.js so document.js can import this
// module without creating a cycle (composite.js never imports document.js).
//
// Compositing rules (bottom-up, layers[0] first):
// - pixel layer: draw layer.canvas into a temp canvas; if it has an enabled
//   mask, 'destination-in' the mask (mask ALPHA = visibility); then draw the
//   temp canvas onto the composite with globalAlpha=opacity and
//   globalCompositeOperation=blendMode.
// - adjustment layer: run its filter on an ImageData copy of the composite so
//   far; opacity lerps filtered/unfiltered per pixel; a non-normal blendMode
//   draws the filtered result through a temp canvas with that composite op,
//   otherwise the filtered pixels replace the composite via putImageData.
//   Unknown filterId -> the adjustment layer is skipped silently.

import * as filters from '../filters/filters.js';
import { createCanvas } from './canvasUtils.js';

// v2 object-param filters receive their params object as the single argument;
// every other filter takes positional scalar params in FILTER_LIST order.
const OBJECT_PARAM_FILTERS = new Set(['levels', 'curves', 'hueSaturation', 'gradientMap']);

// FILTER_LIST id -> filter fn. Namespace property access is lazy-safe at
// import time: ids whose fns don't exist yet simply map to undefined and are
// skipped at composite time.
export const FILTER_FNS = {
  brightness: filters.brightness,
  contrast: filters.contrast,
  saturation: filters.saturation,
  hueRotate: filters.hueRotate,
  grayscale: filters.grayscale,
  invert: filters.invert,
  sepia: filters.sepia,
  threshold: filters.threshold,
  posterize: filters.posterize,
  boxBlur: filters.boxBlur,
  sharpen: filters.sharpen,
  noise: filters.noise,
  pixelate: filters.pixelate,
  emboss: filters.emboss,
  edgeDetect: filters.edgeDetect,
  levels: filters.levels,
  curves: filters.curves,
  hueSaturation: filters.hueSaturation,
  gradientMap: filters.gradientMap,
};

function applyFilter(fn, filterId, imageData, params) {
  if (OBJECT_PARAM_FILTERS.has(filterId)) return fn(imageData, params || {});
  if (params == null) return fn(imageData); // filter defaults
  if (Array.isArray(params)) return fn(imageData, ...params);
  if (typeof params === 'object') return fn(imageData, ...Object.values(params));
  return fn(imageData, params); // single scalar param
}

function applyAdjustmentLayer(ctx, width, height, layer) {
  const adj = layer.adjustment;
  const fn = adj && FILTER_FNS[adj.filterId];
  if (typeof fn !== 'function') return; // unknown filterId: skip silently

  const before = ctx.getImageData(0, 0, width, height);
  const filtered = new ImageData(new Uint8ClampedArray(before.data), width, height);
  applyFilter(fn, adj.filterId, filtered, adj.params);

  // Opacity: per-pixel lerp between unfiltered and filtered.
  const opacity = layer.opacity == null ? 1 : layer.opacity;
  if (opacity < 1) {
    const f = filtered.data;
    const b = before.data;
    for (let i = 0; i < f.length; i++) f[i] = b[i] + (f[i] - b[i]) * opacity;
  }

  if (layer.blendMode && layer.blendMode !== 'source-over') {
    const temp = createCanvas(width, height);
    temp.ctx.putImageData(filtered, 0, 0);
    ctx.save();
    ctx.globalCompositeOperation = layer.blendMode;
    ctx.drawImage(temp.canvas, 0, 0);
    ctx.restore();
  } else {
    ctx.putImageData(filtered, 0, 0);
  }
}

export function compositeLayers(width, height, layers, upToIndex = layers.length - 1) {
  const { canvas, ctx } = createCanvas(width, height);
  const last = Math.min(upToIndex, layers.length - 1);
  for (let i = 0; i <= last; i++) {
    const layer = layers[i];
    if (!layer || !layer.visible) continue;

    if (layer.type === 'adjustment') {
      applyAdjustmentLayer(ctx, width, height, layer);
      continue;
    }

    // Pixel layer (v1 layers may not carry an explicit .type).
    const temp = createCanvas(width, height);
    temp.ctx.drawImage(layer.canvas, 0, 0);
    if (layer.mask && layer.mask.enabled) {
      temp.ctx.save();
      temp.ctx.globalCompositeOperation = 'destination-in';
      temp.ctx.drawImage(layer.mask.canvas, 0, 0);
      temp.ctx.restore();
    }
    ctx.save();
    ctx.globalAlpha = layer.opacity;
    ctx.globalCompositeOperation = layer.blendMode;
    ctx.drawImage(temp.canvas, 0, 0);
    ctx.restore();
  }
  return canvas;
}
