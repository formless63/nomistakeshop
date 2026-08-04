// js/core/canvasUtils.js — shared canvas helpers.
// DOM is only touched inside functions; importing this module in Node is safe.

export function createCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return { canvas, ctx };
}

export function cloneCanvas(src) {
  const { canvas, ctx } = createCanvas(src.width, src.height);
  ctx.drawImage(src, 0, 0);
  return canvas;
}

export function hexToRgb(hex) {
  let h = String(hex).trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex(r, g, b) {
  const part = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

export function getLayerImageData(layer) {
  return layer.ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height);
}

export function putLayerImageData(layer, imageData) {
  layer.ctx.putImageData(imageData, 0, 0);
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}
