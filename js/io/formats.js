// js/io/formats.js — extra import formats: HEIC/HEIF (via vendored heic2any,
// libheif WASM inside) and camera RAW (via vendored libraw-wasm).
//
// Vendor bundles are lazy-loaded via dynamic import() on first use and the
// promise is cached, so first paint never pays for them.
// Static imports are core-only; everything else (psd.js, io.js) is dynamic so
// this module imports cleanly in Node and can't break if a sibling is absent.
// DOM is touched inside functions only.

import { state, emit } from '../core/state.js';
import { createDocument, addLayer, getActiveLayer } from '../core/document.js';
import { history } from '../core/history.js';
import { renderer } from '../core/renderer.js';
import { createCanvas } from '../core/canvasUtils.js';

const RAW_EXTENSIONS = ['.cr2', '.cr3', '.nef', '.arw', '.dng', '.orf', '.rw2', '.pef', '.srw', '.raw', '.raf', '.x3f'];

let heic2anyPromise = null;
let librawPromise = null;

function loadHeic2any() {
  if (!heic2anyPromise) {
    heic2anyPromise = import('../../vendor/heic2any/heic2any.esm.js').then((m) => m.default);
  }
  return heic2anyPromise;
}

function loadLibRaw() {
  if (!librawPromise) {
    librawPromise = import('../../vendor/libraw-wasm/index.js').then((m) => m.default);
  }
  return librawPromise;
}

// Stamps a decoded image (ImageBitmap or canvas) into the app:
// as a new document, or as a new layer on top of the active one.
function stampDecoded(source, width, height, name, asNewDoc) {
  if (asNewDoc || !state.doc) {
    createDocument(width, height, 'transparent');
    history.push('Open Image');
    getActiveLayer().ctx.drawImage(source, 0, 0);
    emit('layer:content');
  } else {
    const { canvas, ctx } = createCanvas(width, height);
    ctx.drawImage(source, 0, 0);
    addLayer(name, canvas);
  }
  renderer.fitToScreen();
}

export async function openHeicFile(file, asNewDoc) {
  emit('status:message', { text: 'Decoding HEIC…' });
  try {
    const heic2any = await loadHeic2any();
    const result = await heic2any({ blob: file, toType: 'image/png' });
    // Multi-image HEIC yields Blob[] — take the first image.
    const blob = Array.isArray(result) ? result[0] : result;
    const bmp = await createImageBitmap(blob);
    stampDecoded(bmp, bmp.width, bmp.height, file.name, asNewDoc);
    emit('status:message', { text: `Opened ${file.name}` });
  } catch (err) {
    console.warn('HEIC decode failed:', err);
    emit('status:message', { text: 'Could not decode HEIC' });
  }
}

export async function openRawFile(file, asNewDoc) {
  emit('status:message', { text: 'Decoding RAW…' });
  let raw = null;
  try {
    const LibRaw = await loadLibRaw();
    raw = new LibRaw();
    await raw.open(new Uint8Array(await file.arrayBuffer()), {});
    const img = await raw.imageData();
    if (!img || !img.width || !img.height || !img.data) throw new Error('no image data');

    // LibRaw hands back interleaved RGB (colors=3, occasionally 1 or 4),
    // 8-bit (Uint8Array) or 16-bit (Uint16Array) — normalize to RGBA8.
    const { width, height, colors, bits } = img;
    const px = width * height;
    const rgba = new Uint8ClampedArray(px * 4);
    const src = img.data;
    const hiByte = bits > 8;
    for (let i = 0; i < px; i++) {
      const s = i * colors;
      const d = i * 4;
      if (colors === 1) {
        const g = hiByte ? src[s] >> 8 : src[s];
        rgba[d] = rgba[d + 1] = rgba[d + 2] = g;
        rgba[d + 3] = 255;
      } else {
        rgba[d] = hiByte ? src[s] >> 8 : src[s];
        rgba[d + 1] = hiByte ? src[s + 1] >> 8 : src[s + 1];
        rgba[d + 2] = hiByte ? src[s + 2] >> 8 : src[s + 2];
        rgba[d + 3] = colors === 4 ? (hiByte ? src[s + 3] >> 8 : src[s + 3]) : 255;
      }
    }

    const { canvas, ctx } = createCanvas(width, height);
    ctx.putImageData(new ImageData(rgba, width, height), 0, 0);
    stampDecoded(canvas, width, height, file.name, asNewDoc);
    emit('status:message', { text: `Opened ${file.name}` });
  } catch (err) {
    console.warn('RAW decode failed:', err);
    emit('status:message', { text: 'Could not decode RAW file' });
  } finally {
    if (raw) raw.dispose();
  }
}

// Single router for every importable file type; io.openImageFile delegates here.
export async function openByExtension(file, asNewDoc) {
  const name = (file.name || '').toLowerCase();
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot) : '';
  if (ext === '.psd') {
    const m = await import('./psd.js');
    return m.openPsdFile(file);
  }
  if (ext === '.heic' || ext === '.heif') {
    return openHeicFile(file, asNewDoc);
  }
  if (RAW_EXTENSIONS.includes(ext)) {
    return openRawFile(file, asNewDoc);
  }
  const m = await import('./io.js');
  return m.io.openImageFile(file, asNewDoc);
}
