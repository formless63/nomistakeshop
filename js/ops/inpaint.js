// js/ops/inpaint.js — content-aware fill (inpainting) via vendored OpenCV.js
// (Apache-2.0, see vendor/opencv/). The multi-MB OpenCV runtime is lazy-loaded
// via dynamic import() on first use only; the promise is cached module-level.
// All DOM/canvas access happens inside functions, so importing this module in
// Node is safe.

import { state, emit, setSelection } from '../core/state.js';
import { history } from '../core/history.js';
import { getActiveLayer } from '../core/document.js';
import { getSelectionMask } from '../tools/selectionPath.js';

let cvPromise = null;

// Lazy-loads and initializes the OpenCV runtime (cached).
function loadCv() {
  if (!cvPromise) {
    emit('status:message', { text: 'Loading inpaint engine…' });
    cvPromise = import('../../vendor/opencv/opencv.js').then((mod) => mod.default);
  }
  return cvPromise;
}

// Inpaints the current selection on the active pixel layer (OpenCV
// INPAINT_TELEA), replacing the selected pixels with surrounding content.
export async function contentAwareFill() {
  if (!state.doc) {
    emit('status:message', { text: 'No document open' });
    return;
  }
  const layer = getActiveLayer();
  if (!layer || layer.type !== 'pixel') {
    emit('status:message', { text: 'Content-Aware Fill needs a pixel layer' });
    return;
  }
  if (!state.selection) {
    emit('status:message', { text: 'Make a selection first' });
    return;
  }
  const maskCanvas = getSelectionMask();
  if (!maskCanvas) {
    emit('status:message', { text: 'Make a selection first' });
    return;
  }

  const cv = await loadCv();
  const { width, height } = state.doc;

  history.push('Content-Aware Fill');

  const imageData = layer.ctx.getImageData(0, 0, width, height);
  const maskData = maskCanvas
    .getContext('2d')
    .getImageData(0, 0, width, height);

  let src = null;
  let srcRgb = null;
  let mask = null;
  let dst = null;
  try {
    src = cv.matFromImageData(imageData); // CV_8UC4 RGBA
    // cv.inpaint only supports 1-channel or 8-bit 3-channel images.
    srcRgb = new cv.Mat();
    cv.cvtColor(src, srcRgb, cv.COLOR_RGBA2RGB);
    mask = new cv.Mat(height, width, cv.CV_8UC1);
    // Binary mask: selected (mask red > 127) -> 255, else 0.
    const md = maskData.data;
    const bin = mask.data;
    for (let i = 0, j = 0; i < md.length; i += 4, j++) {
      bin[j] = md[i] > 127 ? 255 : 0;
    }
    dst = new cv.Mat();
    cv.inpaint(srcRgb, mask, dst, 3, cv.INPAINT_TELEA);

    // Write back RGB from dst, preserving the layer's alpha channel.
    const out = new ImageData(width, height);
    const od = out.data;
    od.set(imageData.data);
    const dd = dst.data;
    for (let i = 0, j = 0; j < dd.length; i += 4, j += 3) {
      od[i] = dd[j];
      od[i + 1] = dd[j + 1];
      od[i + 2] = dd[j + 2];
    }
    layer.ctx.putImageData(out, 0, 0);
  } finally {
    if (src) src.delete();
    if (srcRgb) srcRgb.delete();
    if (mask) mask.delete();
    if (dst) dst.delete();
  }

  emit('layer:content', { layerId: layer.id });
  setSelection(null);
  emit('status:message', { text: 'Filled' });
}
