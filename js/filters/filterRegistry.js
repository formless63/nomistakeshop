// Filter metadata + apply-to-active-layer glue.
// Pure pixel math lives in ./filters.js; this module owns history/events/dialog flow.

import * as filters from './filters.js';
import { state, emit } from '../core/state.js';
import { getActiveLayer } from '../core/document.js';
import { history } from '../core/history.js';
import { getLayerImageData, putLayerImageData } from '../core/canvasUtils.js';

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
];

export async function applyFilterToActiveLayer(id, paramValues = null) {
  const def = FILTER_LIST.find((f) => f.id === id);
  if (!def) return;
  if (!state.doc) return;
  const layer = getActiveLayer();
  if (!layer) return;
  const fn = filters[def.id];
  if (typeof fn !== 'function') return;

  let values = paramValues;
  if (def.params.length > 0 && values == null) {
    // Dynamic import so this module loads before ../ui/dialogs.js exists.
    const dialogs = await import('../ui/dialogs.js');
    values = await dialogs.filterParams(def);
    if (values == null) return; // cancelled — no history push, no mutation
  }

  history.push(def.label.replace(/…$/, ''));

  const imageData = getLayerImageData(layer);
  const args = def.params.map((p) => {
    const v = values ? values[p.key] : undefined;
    return v == null ? p.default : v;
  });
  fn(imageData, ...args);
  putLayerImageData(layer, imageData);

  emit('layer:content', { layerId: layer.id });
}
