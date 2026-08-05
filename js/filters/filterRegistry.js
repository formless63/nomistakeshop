// Filter metadata + apply-to-layer glue.
// Pure pixel math lives in ./filters.js; this module owns history/events/dialog flow.

import * as filters from './filters.js';
import { state, emit } from '../core/state.js';
import { getActiveLayer } from '../core/document.js';
import { history } from '../core/history.js';
import { getLayerImageData, putLayerImageData } from '../core/canvasUtils.js';
import { getSelectionMask } from '../tools/selectionPath.js';

// Params spec: { key, label, type: 'range'|'color', min, max, step, default }.
// Entries without `type` are treated as 'range'.
export const FILTER_LIST = [
  { id: 'brightness', label: 'Brightness…', params: [{ key: 'v', label: 'Amount', min: -100, max: 100, step: 1, default: 0 }] },
  { id: 'contrast', label: 'Contrast…', params: [{ key: 'v', label: 'Amount', min: -100, max: 100, step: 1, default: 0 }] },
  { id: 'saturation', label: 'Saturation…', params: [{ key: 'v', label: 'Amount', min: -100, max: 100, step: 1, default: 0 }] },
  { id: 'hueRotate', label: 'Hue Rotate…', params: [{ key: 'deg', label: 'Angle', min: 0, max: 360, step: 1, default: 0 }] },
  { id: 'grayscale', label: 'Grayscale', params: [] },
  { id: 'invert', label: 'Invert', params: [] },
  { id: 'sepia', label: 'Sepia', params: [] },
  { id: 'threshold', label: 'Threshold…', params: [{ key: 't', label: 'Threshold', min: 0, max: 255, step: 1, default: 128 }] },
  { id: 'posterize', label: 'Posterize…', params: [{ key: 'levels', label: 'Levels', min: 2, max: 16, step: 1, default: 4 }] },
  { id: 'boxBlur', label: 'Box Blur…', params: [{ key: 'radius', label: 'Radius', min: 1, max: 50, step: 1, default: 3 }] },
  { id: 'sharpen', label: 'Sharpen…', params: [{ key: 'amount', label: 'Amount', min: 0, max: 100, step: 1, default: 50 }] },
  { id: 'noise', label: 'Noise…', params: [{ key: 'amount', label: 'Amount', min: 0, max: 100, step: 1, default: 20 }] },
  { id: 'pixelate', label: 'Pixelate…', params: [{ key: 'size', label: 'Size', min: 2, max: 64, step: 1, default: 8 }] },
  { id: 'emboss', label: 'Emboss', params: [] },
  { id: 'edgeDetect', label: 'Edge Detect', params: [] },
  // v2 entries
  { id: 'hueSaturation', label: 'Hue/Saturation…', params: [
    { key: 'hue', label: 'Hue', type: 'range', min: -180, max: 180, step: 1, default: 0 },
    { key: 'saturation', label: 'Saturation', type: 'range', min: -100, max: 100, step: 1, default: 0 },
    { key: 'lightness', label: 'Lightness', type: 'range', min: -100, max: 100, step: 1, default: 0 },
  ] },
  { id: 'gradientMap', label: 'Gradient Map…', params: [
    { key: 'from', label: 'From', type: 'color', default: '#000000' },
    { key: 'to', label: 'To', type: 'color', default: '#ffffff' },
  ] },
  { id: 'levels', label: 'Levels…', custom: 'levels' },
  { id: 'curves', label: 'Curves…', custom: 'curves' },
];

// Filters whose fn receives a single params object instead of positional args.
export const OBJECT_PARAM_FILTERS = new Set(['levels', 'curves', 'hueSaturation', 'gradientMap']);

// FILTER_LIST entries usable as adjustment layers: everything except noise.
export const ADJUSTABLE_FILTERS = FILTER_LIST.filter((f) => f.id !== 'noise');

// Resolves the params for a filter run: given paramValues win, otherwise the
// appropriate dialog is opened. Returns null when the user cancels.
async function resolveParams(def, paramValues) {
  if (paramValues != null) return paramValues;
  // Dynamic import so this module loads before ../ui/dialogs.js exists.
  const dialogs = await import('../ui/dialogs.js');
  if (def.custom === 'levels') return dialogs.levelsDialog();
  if (def.custom === 'curves') return dialogs.curvesDialog();
  if (def.params && def.params.length > 0) return dialogs.filterParams(def);
  return {};
}

function runFilter(def, fn, imageData, values) {
  if (OBJECT_PARAM_FILTERS.has(def.id)) {
    fn(imageData, values);
    return;
  }
  const args = (def.params || []).map((p) => {
    const v = values ? values[p.key] : undefined;
    return v == null ? p.default : v;
  });
  fn(imageData, ...args);
}

// Applies filter `id` to an explicit layer. `layer` may be a real pixel layer
// or a { id, canvas, ctx }-shaped target (e.g. a layer mask).
export async function applyFilterToLayer(layer, id, paramValues = null) {
  const def = FILTER_LIST.find((f) => f.id === id);
  if (!def) return;
  if (!layer || !layer.canvas) return;
  const fn = filters[def.id];
  if (typeof fn !== 'function') return;

  const values = await resolveParams(def, paramValues);
  if (values == null) return; // cancelled — no history push, no mutation

  history.push(def.label.replace(/…$/, ''));

  const imageData = getLayerImageData(layer);
  const maskCanvas = state.selection ? getSelectionMask() : null;
  if (maskCanvas) {
    // Selection-aware: filter a copy, then merge filtered/original per pixel
    // using the selection mask (white = selected) as the blend factor.
    const filtered = {
      data: new Uint8ClampedArray(imageData.data),
      width: imageData.width,
      height: imageData.height,
    };
    runFilter(def, fn, filtered, values);
    const mw = Math.min(maskCanvas.width, imageData.width);
    const mh = Math.min(maskCanvas.height, imageData.height);
    const mask = maskCanvas.getContext('2d').getImageData(0, 0, mw, mh).data;
    const d = imageData.data;
    const f = filtered.data;
    const w = imageData.width;
    for (let y = 0; y < mh; y++) {
      for (let x = 0; x < mw; x++) {
        const i = (y * w + x) * 4;
        const a = mask[(y * mw + x) * 4] / 255; // red channel: white = selected
        if (a <= 0) continue;
        if (a >= 1) {
          d[i] = f[i];
          d[i + 1] = f[i + 1];
          d[i + 2] = f[i + 2];
          d[i + 3] = f[i + 3];
          continue;
        }
        const ia = 1 - a;
        d[i] = d[i] * ia + f[i] * a;
        d[i + 1] = d[i + 1] * ia + f[i + 1] * a;
        d[i + 2] = d[i + 2] * ia + f[i + 2] * a;
        d[i + 3] = d[i + 3] * ia + f[i + 3] * a;
      }
    }
  } else {
    runFilter(def, fn, imageData, values);
  }
  putLayerImageData(layer, imageData);

  emit('layer:content', { layerId: layer.id });
}

export async function applyFilterToActiveLayer(id, paramValues = null) {
  if (!state.doc) return;
  const layer = getActiveLayer();
  if (!layer || layer.type === 'adjustment' || !layer.canvas) return;
  if (state.activeTarget === 'mask' && layer.mask && layer.mask.canvas) {
    // Painting target is the mask: filter the mask's ImageData instead.
    return applyFilterToLayer({ id: layer.id, canvas: layer.mask.canvas, ctx: layer.mask.ctx }, id, paramValues);
  }
  return applyFilterToLayer(layer, id, paramValues);
}
