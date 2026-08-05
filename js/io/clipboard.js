// js/io/clipboard.js — copy/cut/paste for selections.
// Keeps an internal module-level clipboard canvas (exact round trip) and also
// mirrors copies to the system clipboard best-effort. Imports io's siblings
// from core only; toolManager/main.js wire this module in (io.js must not
// import it — no cycles).

import { state, emit } from '../core/state.js';
import { addLayer, getActiveLayer, flattenImage } from '../core/document.js';
import { history } from '../core/history.js';
import { createCanvas } from '../core/canvasUtils.js';
import { getSelectionMask } from '../tools/selectionPath.js';

let clipboardCanvas = null;

function statusMessage(text) {
  emit('status:message', { text });
}

// Tight bounding box of the mask's selected pixels (red channel > 0),
// or null when nothing is selected.
function maskContentBounds(maskData, width, height) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  const d = maskData.data;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (d[(y * width + x) * 4] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

// Best-effort mirror of the internal clipboard onto the system clipboard.
// Fire and forget — never blocks or fails the caller.
function mirrorToSystemClipboard(canvas) {
  try {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    if (typeof navigator.clipboard.write !== 'function') return;
    if (typeof ClipboardItem === 'undefined') return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      try {
        navigator.clipboard
          .write([new ClipboardItem({ 'image/png': blob })])
          .catch(() => {});
      } catch {
        /* system clipboard write unsupported */
      }
    }, 'image/png');
  } catch {
    /* system clipboard unavailable */
  }
}

// Copies the flattened composite — full doc, or the selection-bounded region
// (mask red channel becomes the output alpha, so feathered edges survive).
export function copySelection() {
  const doc = state.doc;
  if (!doc) {
    statusMessage('No document to copy from');
    return;
  }
  const flat = flattenImage();
  if (!flat) return;

  const flatCtx = flat.getContext('2d', { willReadFrequently: true });
  const src = flatCtx.getImageData(0, 0, doc.width, doc.height);

  let maskData = null;
  let bx = 0;
  let by = 0;
  let bw = doc.width;
  let bh = doc.height;
  if (state.selection) {
    const mask = getSelectionMask();
    if (mask) {
      const maskCtx = mask.getContext('2d', { willReadFrequently: true });
      maskData = maskCtx.getImageData(0, 0, doc.width, doc.height);
      const bounds = maskContentBounds(maskData, doc.width, doc.height);
      if (!bounds) {
        statusMessage('Nothing to copy');
        return;
      }
      bx = bounds.x;
      by = bounds.y;
      bw = bounds.w;
      bh = bounds.h;
    }
  }

  const { canvas, ctx } = createCanvas(bw, bh);
  const out = ctx.createImageData(bw, bh);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const si = ((by + y) * doc.width + (bx + x)) * 4;
      const di = (y * bw + x) * 4;
      out.data[di] = src.data[si];
      out.data[di + 1] = src.data[si + 1];
      out.data[di + 2] = src.data[si + 2];
      out.data[di + 3] = maskData
        ? Math.round((src.data[si + 3] * maskData.data[si]) / 255)
        : src.data[si + 3];
    }
  }
  ctx.putImageData(out, 0, 0);
  clipboardCanvas = canvas;
  mirrorToSystemClipboard(canvas);
  statusMessage('Copied');
}

// Copy, then erase the copied region from the active pixel layer.
export function cutSelection() {
  const layer = getActiveLayer();
  if (!layer || layer.type === 'adjustment') {
    statusMessage('Cut needs an active pixel layer');
    return;
  }
  copySelection();

  const doc = state.doc;
  history.push('Cut');
  const img = layer.ctx.getImageData(0, 0, doc.width, doc.height);
  if (state.selection) {
    const mask = getSelectionMask();
    if (mask) {
      const maskCtx = mask.getContext('2d', { willReadFrequently: true });
      const md = maskCtx.getImageData(0, 0, doc.width, doc.height).data;
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        d[i + 3] = Math.round(d[i + 3] * (1 - md[i] / 255));
      }
      layer.ctx.putImageData(img, 0, 0);
      emit('layer:content', { layerId: layer.id });
      statusMessage('Cut');
      return;
    }
  }
  // No selection: clear the whole layer.
  layer.ctx.clearRect(0, 0, doc.width, doc.height);
  emit('layer:content', { layerId: layer.id });
  statusMessage('Cut');
}

// Stamps `source` onto a doc-sized canvas, centered (per the v2 contract:
// paste lands in the middle of the document, not at the top-left corner).
function centeredDocCanvas(source) {
  const doc = state.doc;
  const { canvas, ctx } = createCanvas(doc.width, doc.height);
  const dx = Math.round((doc.width - source.width) / 2);
  const dy = Math.round((doc.height - source.height) / 2);
  ctx.drawImage(source, dx, dy);
  return canvas;
}

// Pastes the internal clipboard as a new layer; falls back to reading an
// image from the system clipboard when the internal one is empty.
export async function pasteAsNewLayer() {
  if (!state.doc) {
    statusMessage('No document to paste into');
    return;
  }
  if (clipboardCanvas) {
    addLayer('Pasted', centeredDocCanvas(clipboardCanvas)); // pushes history + emits
    emit('layer:content');
    statusMessage('Pasted as new layer');
    return;
  }
  try {
    if (
      typeof navigator === 'undefined' ||
      !navigator.clipboard ||
      typeof navigator.clipboard.read !== 'function'
    ) {
      statusMessage('Nothing to paste');
      return;
    }
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const type = (item.types || []).find((t) => t.startsWith('image/'));
      if (!type) continue;
      const blob = await item.getType(type);
      const bmp = await createImageBitmap(blob);
      const { canvas, ctx } = createCanvas(bmp.width, bmp.height);
      ctx.drawImage(bmp, 0, 0);
      if (typeof bmp.close === 'function') bmp.close();
      addLayer('Pasted', centeredDocCanvas(canvas));
      emit('layer:content');
      statusMessage('Pasted as new layer');
      return;
    }
    statusMessage('No image on the clipboard');
  } catch {
    statusMessage('Clipboard paste not available');
  }
}

export function hasClipboard() {
  return clipboardCanvas !== null;
}
