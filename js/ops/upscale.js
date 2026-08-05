// js/ops/upscale.js — AI upscaling of the active pixel layer via UpscalerJS
// (vendor/upscaler/, lazy-loaded) with the vendored @upscalerjs/default-model
// ESRGAN ×2 weights. ×4 is two ×2 passes. DOM access happens inside functions
// only; the vendor lib loads via a cached dynamic import, so importing this
// module in Node is safe.

import { state, emit } from '../core/state.js';
import { history } from '../core/history.js';
import { getActiveLayer } from '../core/document.js';
import { createCanvas } from '../core/canvasUtils.js';

const MAX_INPUT_DIM = 2048; // browser memory guard (input side; ×4 doubles it twice)

let upscalerLibPromise = null;
function loadUpscalerLib() {
  if (!upscalerLibPromise) upscalerLibPromise = import('../../vendor/upscaler/index.js');
  return upscalerLibPromise;
}

// Shared Upscaler instance: the ESRGAN model is parsed/compiled once and
// reused across calls (and across the two passes of a ×4 upscale).
let upscalerInstancePromise = null;
let modelLoadAnnounced = false;
function getUpscaler() {
  if (!upscalerInstancePromise) {
    if (!modelLoadAnnounced) {
      emit('status:message', { text: 'Loading AI model…' });
      modelLoadAnnounced = true;
    }
    upscalerInstancePromise = loadUpscalerLib().then((lib) => {
      const upscaler = new lib.default({ model: lib.defaultModelDefinition });
      return upscaler.ready.then(() => ({ upscaler, tf: lib.tf }));
    });
  }
  return upscalerInstancePromise;
}

// canvas -> upscaled canvas (width/height multiplied by the model's ×2 scale).
// patchSize + padding tile the inference: a whole-image tensor blows past the
// WebGL texture-size limit (8192px) long before the 2048px input guard.
async function upscaleCanvasOnce(canvas, upscaler, tf) {
  const tensor = await upscaler.upscale(canvas, {
    output: 'tensor',
    patchSize: 64,
    padding: 4,
  });
  // The model emits 0..255 floats (inputRange/outputRange [0,255]);
  // tf.browser.toPixels only accepts [0,1] floats or int32 0..255.
  const squeezed = tensor.shape.length === 4 ? tensor.squeeze() : tensor;
  const pixels = squeezed.clipByValue(0, 255).toInt();
  try {
    const { canvas: out, ctx } = createCanvas(canvas.width * 2, canvas.height * 2);
    await tf.browser.toPixels(pixels, out);
    return { canvas: out, ctx };
  } finally {
    tensor.dispose();
    if (squeezed !== tensor) squeezed.dispose();
    pixels.dispose();
  }
}

export async function upscaleActiveLayer(factor = 2) {
  const doc = state.doc;
  if (!doc) {
    emit('status:message', { text: 'No document open' });
    return;
  }
  const layer = getActiveLayer();
  if (!layer || layer.type !== 'pixel') {
    emit('status:message', { text: 'AI Upscale needs a pixel layer selected' });
    return;
  }
  factor = factor === 4 ? 4 : 2; // the vendored model is ×2; ×4 = two passes
  if (layer.canvas.width > MAX_INPUT_DIM || layer.canvas.height > MAX_INPUT_DIM) {
    const { alert } = await import('../ui/dialogs.js');
    alert(
      `AI Upscale is limited to layers up to ${MAX_INPUT_DIM}px per side ` +
      `(this layer is ${layer.canvas.width}×${layer.canvas.height}). ` +
      'Resize the image first to keep browser memory use in check.',
    );
    return;
  }

  try {
    const { upscaler, tf } = await getUpscaler(); // emits 'Loading AI model…' on first use
    emit('status:message', { text: `Upscaling ×${factor}…` });
    let result = await upscaleCanvasOnce(layer.canvas, upscaler, tf);
    if (factor === 4) result = await upscaleCanvasOnce(result.canvas, upscaler, tf);

    // Mutation starts here — snapshot first so undo restores the small layer.
    history.push('AI Upscale');
    layer.canvas = result.canvas;
    layer.ctx = result.ctx;
    if (layer.mask) {
      // Masks only need smooth resampling, not AI detail synthesis.
      const { canvas: maskCanvas, ctx: maskCtx } = createCanvas(result.canvas.width, result.canvas.height);
      maskCtx.drawImage(layer.mask.canvas, 0, 0, maskCanvas.width, maskCanvas.height);
      layer.mask.canvas = maskCanvas;
      layer.mask.ctx = maskCtx;
    }
    emit('layer:content', { layerId: layer.id });
    emit('status:message', { text: `Upscaled ×${factor}` });
  } catch (err) {
    console.error('AI Upscale failed:', err);
    emit('status:message', { text: `Upscale failed: ${err && err.message ? err.message : err}` });
  }
}
