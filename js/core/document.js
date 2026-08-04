// js/core/document.js — document & layer model.
// doc.layers[0] is the BOTTOM layer; rendering paints index 0 first.
// Every structural mutation calls history.push(label) BEFORE mutating and
// emits 'layers:changed' after.

import { state, emit, setSelection } from './state.js';
import { history } from './history.js';
import { createCanvas } from './canvasUtils.js';

let nextLayerId = 1;

export function makeLayer(name, width, height) {
  const { canvas, ctx } = createCanvas(width, height);
  return {
    id: `layer-${nextLayerId++}`,
    name,
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    canvas,
    ctx,
  };
}

export function createDocument(width, height, background = '#ffffff') {
  history.clear();
  const doc = {
    width,
    height,
    layers: [],
    activeLayerId: null,
    background,
  };
  state.doc = doc;
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
  emit('layers:changed');
  return layer;
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
  const copy = makeLayer(`${src.name} copy`, doc.width, doc.height);
  copy.visible = src.visible;
  copy.opacity = src.opacity;
  copy.blendMode = src.blendMode;
  copy.ctx.drawImage(src.canvas, 0, 0); // deep-clone the pixels
  doc.layers.splice(idx + 1, 0, copy);
  doc.activeLayerId = copy.id;
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
  history.push('Merge Down');
  const upper = doc.layers[idx];
  const lower = doc.layers[idx - 1];
  if (upper.visible) {
    lower.ctx.save();
    lower.ctx.globalAlpha = upper.opacity;
    lower.ctx.globalCompositeOperation = upper.blendMode;
    lower.ctx.drawImage(upper.canvas, 0, 0);
    lower.ctx.restore();
  }
  doc.layers.splice(idx, 1);
  if (doc.activeLayerId === id) doc.activeLayerId = lower.id;
  emit('layers:changed');
  emit('layer:content', { layerId: lower.id });
}

export function flattenImage() {
  const doc = state.doc;
  if (!doc) return null;
  const { canvas, ctx } = createCanvas(doc.width, doc.height);
  for (const layer of doc.layers) {
    if (!layer.visible) continue;
    ctx.save();
    ctx.globalAlpha = layer.opacity;
    ctx.globalCompositeOperation = layer.blendMode;
    ctx.drawImage(layer.canvas, 0, 0);
    ctx.restore();
  }
  return canvas;
}

export function selectAll() {
  const doc = state.doc;
  if (!doc) return;
  setSelection({ type: 'rect', x: 0, y: 0, w: doc.width, h: doc.height });
}

export function deselect() {
  setSelection(null);
}
