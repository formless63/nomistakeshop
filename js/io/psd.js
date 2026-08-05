// js/io/psd.js — PSD import/export via vendored ag-psd (vendor/ag-psd/).
// The vendor lib is loaded lazily via dynamic import() (cached promise) so
// first paint never pays for it. All DOM access happens inside functions, so
// this module can be imported in Node (tests) without crashing.
//
// Empirical facts about ag-psd 31.x that this module relies on (verified
// against the vendored build, see tests/fixtures/make-psd.mjs):
// - psd.children[0] is the BOTTOM layer — same orientation as doc.layers.
// - layer.blendMode is a LONG name ('multiply', 'color dodge', ...), not the
//   historical 4-char PSD key; writePsd accepts the same long names.
// - layer.opacity is 0..1 on BOTH read and write (values >1 clamp to 1).
// - Visibility is the `hidden` boolean (there is no `visible` field).
// - Browser builds produce layer.canvas automatically (ag-psd initializes
//   its canvas factory from document.createElement when `document` exists).
// - Masks: read gives a grayscale canvas (mask value in RGB, alpha 255);
//   writePsd takes the mask value from the RED channel. Our mask model uses
//   ALPHA as visibility, so both directions convert channels.

import { state, emit } from '../core/state.js';
import { history } from '../core/history.js';
import { createDocument, makeLayer } from '../core/document.js';
import { createCanvas, cloneCanvas, downloadBlob } from '../core/canvasUtils.js';
import { FILTER_FNS } from '../core/composite.js';
import { renderer } from '../core/renderer.js';

// ag-psd long blend name (or legacy 4-char key) -> our BLEND_MODES id.
const PSD_BLEND_MAP = {
  normal: 'source-over',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  darken: 'darken',
  lighten: 'lighten',
  'color dodge': 'color-dodge',
  'color burn': 'color-burn',
  'hard light': 'hard-light',
  'soft light': 'soft-light',
  difference: 'difference',
  exclusion: 'exclusion',
  hue: 'hue',
  saturation: 'saturation',
  color: 'color',
  luminosity: 'luminosity',
  // legacy 4-char PSD keys (incl. trailing-space variants)
  norm: 'source-over',
  mul: 'multiply',
  'mul ': 'multiply',
  scrn: 'screen',
  over: 'overlay',
  dark: 'darken',
  lite: 'lighten',
  div: 'color-dodge',
  'div ': 'color-dodge',
  idiv: 'color-burn',
  hLit: 'hard-light',
  sLit: 'soft-light',
  diff: 'difference',
  smud: 'exclusion',
  'hue ': 'hue',
  sat: 'saturation',
  'sat ': 'saturation',
  colr: 'color',
  lum: 'luminosity',
  'lum ': 'luminosity',
};

// Our BLEND_MODES id -> ag-psd long blend name (reverse of the map above,
// only for our 16 ids).
const OUR_BLEND_TO_PSD = {
  'source-over': 'normal',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  darken: 'darken',
  lighten: 'lighten',
  'color-dodge': 'color dodge',
  'color-burn': 'color burn',
  'hard-light': 'hard light',
  'soft-light': 'soft light',
  difference: 'difference',
  exclusion: 'exclusion',
  hue: 'hue',
  saturation: 'saturation',
  color: 'color',
  luminosity: 'luminosity',
};

// Object-param filters take their params object as one argument; all other
// filters take positional scalars (mirrors applyFilter in core/composite.js).
const OBJECT_PARAM_FILTERS = new Set(['levels', 'curves', 'hueSaturation', 'gradientMap']);

let agPsdPromise = null;
function loadAgPsd() {
  if (!agPsdPromise) agPsdPromise = import('../../vendor/ag-psd/index.js');
  return agPsdPromise;
}

function mapBlendMode(psdBlendMode, stats) {
  if (!psdBlendMode || psdBlendMode === 'pass through') return 'source-over';
  const mapped = PSD_BLEND_MAP[psdBlendMode];
  if (mapped) return mapped;
  stats.remappedBlends++;
  return 'source-over';
}

function mapOpacity(rawOpacity) {
  const raw = rawOpacity == null ? 1 : rawOpacity;
  // ag-psd reports 0..1; tolerate a legacy 0..255 scale defensively.
  return Math.min(1, Math.max(0, raw > 1 ? raw / 255 : raw));
}

// PSD mask canvas (grayscale RGB, alpha 255, sized to the mask rect) ->
// our mask: doc-sized canvas whose ALPHA channel is visibility.
function importMask(psdMask, width, height) {
  const { canvas, ctx } = createCanvas(width, height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height); // outside the mask rect = fully visible
  ctx.drawImage(psdMask.canvas, psdMask.left || 0, psdMask.top || 0);
  const imageData = ctx.getImageData(0, 0, width, height);
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) d[i + 3] = d[i]; // red -> alpha
  ctx.putImageData(imageData, 0, 0);
  return { canvas, ctx, enabled: !psdMask.disabled };
}

// Our mask (ALPHA = visibility) -> PSD mask canvas (visibility in the red
// channel, which is what writePsd reads).
function exportMask(mask, width, height) {
  const { canvas, ctx } = createCanvas(width, height);
  ctx.drawImage(mask.canvas, 0, 0);
  const imageData = ctx.getImageData(0, 0, width, height);
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    d[i] = a;
    d[i + 1] = a;
    d[i + 2] = a;
    d[i + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);
  return { canvas, disabled: !mask.enabled };
}

function applyAdjustmentParams(fn, filterId, imageData, params) {
  if (OBJECT_PARAM_FILTERS.has(filterId)) return fn(imageData, params || {});
  if (params == null) return fn(imageData);
  if (Array.isArray(params)) return fn(imageData, ...params);
  if (typeof params === 'object') return fn(imageData, ...Object.values(params));
  return fn(imageData, params);
}

export async function openPsdFile(file) {
  const { readPsd } = await loadAgPsd();
  const buffer = await file.arrayBuffer();
  const psd = readPsd(buffer);

  const width = psd.width;
  const height = psd.height;
  createDocument(width, height, 'transparent');
  const doc = state.doc;
  doc.layers = []; // drop the default base layer; PSD layers replace it

  const stats = { groups: 0, skipped: 0, remappedBlends: 0 };

  const importChildren = (children, prefix) => {
    for (const child of children || []) {
      // Groups: recursively flatten into our flat layer list.
      if (child.children) {
        stats.groups++;
        importChildren(child.children, `${prefix}Group: ${child.name || 'Group'} / `);
        continue;
      }
      // Text/vector/smart-object/adjustment layers without a rendered canvas
      // cannot be represented — skip + count.
      if (!child.canvas) {
        stats.skipped++;
        continue;
      }
      const layer = makeLayer(prefix + (child.name || 'Layer'), width, height);
      layer.ctx.drawImage(child.canvas, child.left || 0, child.top || 0);
      layer.visible = child.hidden !== true && child.visible !== false;
      layer.opacity = mapOpacity(child.opacity);
      layer.blendMode = mapBlendMode(child.blendMode, stats);
      if (child.mask && child.mask.canvas) {
        layer.mask = importMask(child.mask, width, height);
      }
      doc.layers.push(layer);
    }
  };
  importChildren(psd.children, '');

  if (doc.layers.length === 0) doc.layers.push(makeLayer('Background', width, height));
  doc.activeLayerId = doc.layers[doc.layers.length - 1].id;

  history.clear();
  emit('doc:changed');
  emit('layers:changed');
  renderer.fitToScreen();

  if (stats.groups || stats.skipped || stats.remappedBlends) {
    const parts = [];
    if (stats.groups) parts.push(`${stats.groups} group${stats.groups === 1 ? '' : 's'} flattened`);
    if (stats.skipped) parts.push(`${stats.skipped} layer${stats.skipped === 1 ? '' : 's'} skipped`);
    if (stats.remappedBlends) parts.push(`${stats.remappedBlends} blend mode${stats.remappedBlends === 1 ? '' : 's'} mapped to Normal`);
    emit('status:message', { text: `Imported PSD — ${parts.join(', ')}` });
  }
  return doc;
}

export async function exportPsd() {
  const doc = state.doc;
  if (!doc) {
    emit('status:message', { text: 'No document to export' });
    return;
  }
  const { writePsd } = await loadAgPsd();
  const { width, height } = doc;
  const stats = { baked: 0, skipped: 0 };

  // Clone every pixel layer's canvas so adjustment baking never mutates the
  // real document.
  const clones = doc.layers.map((layer) =>
    layer.type === 'adjustment' ? null : cloneCanvas(layer.canvas),
  );

  const children = [];
  doc.layers.forEach((layer, i) => {
    if (layer.type === 'adjustment') {
      // PSD has no equivalent for our adjustment layers: bake the filter into
      // the nearest pixel layer BELOW (its clone); skip + count if none.
      let target = -1;
      for (let j = i - 1; j >= 0; j--) {
        if (doc.layers[j].type !== 'adjustment') {
          target = j;
          break;
        }
      }
      if (target === -1) {
        stats.skipped++;
        return;
      }
      const fn = FILTER_FNS[layer.adjustment && layer.adjustment.filterId];
      if (typeof fn === 'function') {
        const canvas = clones[target];
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const imageData = ctx.getImageData(0, 0, width, height);
        applyAdjustmentParams(fn, layer.adjustment.filterId, imageData, layer.adjustment.params);
        ctx.putImageData(imageData, 0, 0);
        stats.baked++;
      } else {
        stats.skipped++;
      }
      return;
    }
    children.push({
      name: layer.name,
      canvas: clones[i],
      top: 0,
      left: 0,
      opacity: Math.min(1, Math.max(0, layer.opacity == null ? 1 : layer.opacity)),
      hidden: !layer.visible,
      blendMode: OUR_BLEND_TO_PSD[layer.blendMode] || 'normal',
      mask: layer.mask ? exportMask(layer.mask, width, height) : undefined,
    });
  });

  const buffer = writePsd({ width, height, children });
  downloadBlob(new Blob([buffer], { type: 'image/vnd.adobe.photoshop' }), 'untitled.psd');

  if (stats.baked || stats.skipped) {
    const parts = [];
    if (stats.baked) parts.push(`${stats.baked} adjustment${stats.baked === 1 ? '' : 's'} baked into pixels`);
    if (stats.skipped) parts.push(`${stats.skipped} adjustment${stats.skipped === 1 ? '' : 's'} skipped`);
    emit('status:message', { text: `Exported PSD — ${parts.join(', ')}` });
  }
}
