// js/core/document.js — document & layer model (v2: pixel + adjustment layers,
// optional layer masks).
// doc.layers[0] is the BOTTOM layer; rendering paints index 0 first.
// Every structural mutation calls history.push(label) BEFORE mutating and
// emits 'layers:changed' after.
//
// Layer shapes:
//   pixel:      { id, type:'pixel', name, visible, opacity, blendMode,
//                 canvas, ctx, mask: null | { canvas, ctx, enabled } }
//   adjustment: { id, type:'adjustment', name, visible, opacity, blendMode,
//                 adjustment: { filterId, params } }  (no canvas/ctx/mask)
// Mask semantics: the mask canvas ALPHA channel is visibility (255 = shown);
// it is applied at composite time (see composite.js), never destructively.

import { state, emit, setSelection } from './state.js';
import { history } from './history.js';
import { createCanvas, cloneCanvas, docColorSpace } from './canvasUtils.js';
import { compositeLayers } from './composite.js';
import { getSelectionMask } from '../tools/selectionPath.js';

let nextLayerId = 1;

function deepCopy(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function maskFromCanvas(canvas, enabled = true) {
  return {
    canvas,
    ctx: canvas.getContext('2d', { willReadFrequently: true, colorSpace: docColorSpace() }),
    enabled,
  };
}

function cloneMask(mask) {
  return maskFromCanvas(cloneCanvas(mask.canvas), mask.enabled);
}

export function makeLayer(name, width, height) {
  const { canvas, ctx } = createCanvas(width, height);
  return {
    id: `layer-${nextLayerId++}`,
    type: 'pixel',
    name,
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    canvas,
    ctx,
    mask: null,
  };
}

export function createDocument(width, height, background = '#ffffff', colorSpace = 'srgb') {
  history.clear();
  const doc = {
    width,
    height,
    layers: [],
    activeLayerId: null,
    background,
    colorSpace: colorSpace === 'display-p3' ? 'display-p3' : 'srgb',
  };
  state.doc = doc;
  state.activeTarget = 'layer';
  const base = makeLayer('Background', width, height);
  if (background !== 'transparent') {
    base.ctx.fillStyle = background;
    base.ctx.fillRect(0, 0, width, height);
  }
  doc.layers.push(base);
  doc.activeLayerId = base.id;
  emit('doc:changed');
  emit('layers:changed');
  emit('history:changed');
  return doc;
}

export function addLayer(name = null, fillCanvas = null) {
  const doc = state.doc;
  if (!doc) return null;
  history.push('New Layer');
  const layer = makeLayer(name || `Layer ${doc.layers.length + 1}`, doc.width, doc.height);
  if (fillCanvas) layer.ctx.drawImage(fillCanvas, 0, 0);
  const idx = doc.layers.findIndex((l) => l.id === doc.activeLayerId);
  const at = idx >= 0 ? idx + 1 : doc.layers.length; // insert above the active layer
  doc.layers.splice(at, 0, layer);
  doc.activeLayerId = layer.id;
  state.activeTarget = 'layer';
  emit('layers:changed');
  return layer;
}

export function addAdjustmentLayer(filterId, params, name = null) {
  const doc = state.doc;
  if (!doc) return null;
  history.push('New Adjustment Layer');
  const layer = {
    id: `layer-${nextLayerId++}`,
    type: 'adjustment',
    name: name || String(filterId),
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    adjustment: { filterId, params: deepCopy(params) },
  };
  const idx = doc.layers.findIndex((l) => l.id === doc.activeLayerId);
  const at = idx >= 0 ? idx + 1 : doc.layers.length; // insert above the active layer
  doc.layers.splice(at, 0, layer);
  doc.activeLayerId = layer.id;
  state.activeTarget = 'layer';
  emit('layers:changed');
  return layer;
}

export function setAdjustment(id, filterId, params) {
  const doc = state.doc;
  if (!doc) return;
  const layer = doc.layers.find((l) => l.id === id);
  if (!layer || layer.type !== 'adjustment') return;
  history.push('Edit Adjustment');
  layer.adjustment = { filterId, params: deepCopy(params) };
  emit('layers:changed');
  emit('layer:content', { layerId: id });
}

export function addLayerMask(id, mode = 'white') {
  const doc = state.doc;
  if (!doc) return;
  const layer = doc.layers.find((l) => l.id === id);
  if (!layer || layer.type === 'adjustment' || layer.mask) return;
  let mask = null;
  if (mode === 'selection') {
    const selMask = getSelectionMask();
    if (!selMask) {
      emit('status:message', { text: 'No active selection — mask not added' });
      return;
    }
    mask = maskFromCanvas(cloneCanvas(selMask));
  } else {
    const { canvas, ctx } = createCanvas(doc.width, doc.height);
    if (mode !== 'black') {
      // 'white': fully visible. 'black' leaves the canvas transparent (hidden).
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, doc.width, doc.height);
    }
    mask = maskFromCanvas(canvas);
  }
  history.push('Add Layer Mask');
  layer.mask = mask;
  emit('layers:changed');
}

export function removeLayerMask(id, apply = false) {
  const doc = state.doc;
  if (!doc) return;
  const layer = doc.layers.find((l) => l.id === id);
  if (!layer || layer.type === 'adjustment' || !layer.mask) return;
  history.push(apply ? 'Apply Layer Mask' : 'Delete Layer Mask');
  if (apply && layer.mask.enabled) {
    layer.ctx.save();
    layer.ctx.globalCompositeOperation = 'destination-in';
    layer.ctx.drawImage(layer.mask.canvas, 0, 0);
    layer.ctx.restore();
  }
  layer.mask = null;
  if (doc.activeLayerId === id) state.activeTarget = 'layer';
  emit('layers:changed');
  emit('layer:content', { layerId: id });
}

export function toggleLayerMask(id) {
  const doc = state.doc;
  if (!doc) return;
  const layer = doc.layers.find((l) => l.id === id);
  if (!layer || !layer.mask) return;
  layer.mask.enabled = !layer.mask.enabled;
  emit('layers:changed');
  emit('layer:content', { layerId: id });
}

// The ctx painting tools should draw into: the mask ctx when the user is
// targeting an enabled mask, else the layer's own pixel ctx.
export function getPaintTarget() {
  const layer = getActiveLayer();
  if (!layer || layer.type === 'adjustment') return null;
  if (state.activeTarget === 'mask' && layer.mask && layer.mask.enabled) {
    return { layer, ctx: layer.mask.ctx, isMask: true };
  }
  return { layer, ctx: layer.ctx, isMask: false };
}

export function removeLayer(id) {
  const doc = state.doc;
  if (!doc) return;
  if (doc.layers.length <= 1) return; // always keep at least one layer
  const idx = doc.layers.findIndex((l) => l.id === id);
  if (idx === -1) return;
  history.push('Delete Layer');
  doc.layers.splice(idx, 1);
  if (doc.activeLayerId === id) {
    const next = doc.layers[Math.min(idx, doc.layers.length - 1)];
    doc.activeLayerId = next.id;
    state.activeTarget = 'layer';
  }
  emit('layers:changed');
}

export function duplicateLayer(id) {
  const doc = state.doc;
  if (!doc) return null;
  const idx = doc.layers.findIndex((l) => l.id === id);
  if (idx === -1) return null;
  history.push('Duplicate Layer');
  const src = doc.layers[idx];
  let copy;
  if (src.type === 'adjustment') {
    copy = {
      id: `layer-${nextLayerId++}`,
      type: 'adjustment',
      name: `${src.name} copy`,
      visible: src.visible,
      opacity: src.opacity,
      blendMode: src.blendMode,
      adjustment: deepCopy(src.adjustment),
    };
  } else {
    copy = makeLayer(`${src.name} copy`, doc.width, doc.height);
    copy.visible = src.visible;
    copy.opacity = src.opacity;
    copy.blendMode = src.blendMode;
    copy.ctx.drawImage(src.canvas, 0, 0); // deep-clone the pixels
    if (src.mask) copy.mask = cloneMask(src.mask);
  }
  doc.layers.splice(idx + 1, 0, copy);
  doc.activeLayerId = copy.id;
  state.activeTarget = 'layer';
  emit('layers:changed');
  return copy;
}

export function moveLayer(id, newIndex) {
  const doc = state.doc;
  if (!doc) return;
  const idx = doc.layers.findIndex((l) => l.id === id);
  if (idx === -1) return;
  const to = Math.max(0, Math.min(doc.layers.length - 1, newIndex));
  if (to === idx) return;
  history.push('Move Layer');
  const [layer] = doc.layers.splice(idx, 1);
  doc.layers.splice(to, 0, layer);
  emit('layers:changed');
}

export function setActiveLayer(id) {
  const doc = state.doc;
  if (!doc) return;
  if (doc.activeLayerId === id) return;
  if (!doc.layers.some((l) => l.id === id)) return;
  doc.activeLayerId = id;
  state.activeTarget = 'layer'; // switching layers always drops mask targeting
  emit('layers:changed');
}

export function getActiveLayer() {
  const doc = state.doc;
  if (!doc) return null;
  return doc.layers.find((l) => l.id === doc.activeLayerId) || null;
}

export function updateLayerProps(id, props) {
  const doc = state.doc;
  if (!doc) return;
  const layer = doc.layers.find((l) => l.id === id);
  if (!layer) return;
  if (props.name !== undefined) layer.name = props.name;
  if (props.visible !== undefined) layer.visible = !!props.visible;
  if (props.opacity !== undefined) layer.opacity = Math.max(0, Math.min(1, props.opacity));
  if (props.blendMode !== undefined) layer.blendMode = props.blendMode;
  emit('layers:changed');
}

export function mergeDown(id) {
  const doc = state.doc;
  if (!doc) return;
  const idx = doc.layers.findIndex((l) => l.id === id);
  if (idx <= 0) return; // bottom layer (or missing) cannot merge down
  const upper = doc.layers[idx];
  const lower = doc.layers[idx - 1];
  if (upper.type === 'adjustment' || lower.type === 'adjustment') {
    emit('status:message', { text: 'Adjustment layers cannot be merged' });
    return;
  }
  history.push('Merge Down');
  // Bake the lower layer's mask into its pixels first.
  if (lower.mask) {
    if (lower.mask.enabled) {
      lower.ctx.save();
      lower.ctx.globalCompositeOperation = 'destination-in';
      lower.ctx.drawImage(lower.mask.canvas, 0, 0);
      lower.ctx.restore();
    }
    lower.mask = null;
  }
  if (upper.visible) {
    // Respect the upper layer's mask: composite its pixels through the mask.
    let srcCanvas = upper.canvas;
    if (upper.mask && upper.mask.enabled) {
      const temp = createCanvas(doc.width, doc.height);
      temp.ctx.drawImage(upper.canvas, 0, 0);
      temp.ctx.globalCompositeOperation = 'destination-in';
      temp.ctx.drawImage(upper.mask.canvas, 0, 0);
      srcCanvas = temp.canvas;
    }
    lower.ctx.save();
    lower.ctx.globalAlpha = upper.opacity;
    lower.ctx.globalCompositeOperation = upper.blendMode;
    lower.ctx.drawImage(srcCanvas, 0, 0);
    lower.ctx.restore();
  }
  doc.layers.splice(idx, 1);
  if (doc.activeLayerId === id) {
    doc.activeLayerId = lower.id;
    state.activeTarget = 'layer';
  }
  emit('layers:changed');
  emit('layer:content', { layerId: lower.id });
}

export function flattenImage() {
  const doc = state.doc;
  if (!doc) return null;
  return compositeLayers(doc.width, doc.height, doc.layers);
}

export function selectAll() {
  const doc = state.doc;
  if (!doc) return;
  setSelection({ type: 'rect', x: 0, y: 0, w: doc.width, h: doc.height, invert: false, feather: 0 });
}

export function deselect() {
  setSelection(null);
}
