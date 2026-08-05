// js/io/optimizePng.js — optimized (palette-quantized) PNG export via vendored
// UPNG.js (vendor/upng-js/). The vendor lib is loaded lazily via dynamic
// import() (cached promise) so first paint never pays for it. All DOM access
// happens inside functions, so this module can be imported in Node (tests)
// without crashing.

import { state, emit } from '../core/state.js';
import { flattenImage } from '../core/document.js';
import { downloadBlob } from '../core/canvasUtils.js';

let upngPromise = null;
function loadUpng() {
  if (!upngPromise) upngPromise = import('../../vendor/upng-js/index.js');
  return upngPromise;
}

function toBlob(canvas, type) {
  return new Promise((resolve) => canvas.toBlob(resolve, type));
}

function formatKB(bytes) {
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export async function exportOptimizedPng() {
  const doc = state.doc;
  if (!doc) {
    emit('status:message', { text: 'No document to export' });
    return;
  }

  emit('status:message', { text: 'Optimizing PNG…' });
  const { encode } = await loadUpng();

  const canvas = flattenImage();
  const ctx = canvas.getContext('2d');
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

  // Encode both versions before downloading so the status message can show
  // the size win. UPNG.encode with cnum=256 quantizes to a ≤256-color palette.
  const plainBlob = await toBlob(canvas, 'image/png');
  const buffer = encode([imageData.data.buffer], canvas.width, canvas.height, 256);
  const blob = new Blob([buffer], { type: 'image/png' });

  downloadBlob(blob, 'untitled-optimized.png');

  const pct = plainBlob.size > 0 ? Math.round((1 - blob.size / plainBlob.size) * 100) : 0;
  emit('status:message', {
    text: `Optimized PNG: ${formatKB(plainBlob.size)} → ${formatKB(blob.size)} (${pct}% smaller)`,
  });
}
