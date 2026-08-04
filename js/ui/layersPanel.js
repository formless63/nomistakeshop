// js/ui/layersPanel.js — layer stack UI rendered into #layers-panel.
// Header: blend-mode select + opacity slider for the ACTIVE layer.
// List: state.doc.layers reversed (topmost layer first), per-row eye toggle,
// 48x36 thumbnail, double-click rename, click to activate.
// Footer: New / Duplicate / Delete.
// Full rebuild on 'layers:changed' and 'doc:changed'; thumbnails redrawn on
// 'layer:content'.

import { state, on } from '../core/state.js';
import { BLEND_MODES } from '../core/blendmodes.js';
import {
  getActiveLayer,
  updateLayerProps,
  setActiveLayer,
  addLayer,
  duplicateLayer,
  removeLayer,
} from '../core/document.js';

const THUMB_W = 48;
const THUMB_H = 36;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function drawThumb(canvas, layer) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const scale = Math.min(canvas.width / layer.canvas.width, canvas.height / layer.canvas.height);
  const w = Math.max(1, layer.canvas.width * scale);
  const h = Math.max(1, layer.canvas.height * scale);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(layer.canvas, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
}

export function initLayersPanel() {
  const root = document.getElementById('layers-panel');
  if (!root) return;

  // --- Header: blend mode + opacity for the active layer ---
  const header = el('div', 'layers-header');
  const blendSelect = el('select', 'layers-blend');
  for (const mode of BLEND_MODES) {
    const opt = el('option', '', mode.label);
    opt.value = mode.id;
    blendSelect.append(opt);
  }
  blendSelect.addEventListener('change', () => {
    const active = getActiveLayer();
    if (active) updateLayerProps(active.id, { blendMode: blendSelect.value });
  });

  const opacityWrap = el('div', 'layers-opacity');
  opacityWrap.append(el('span', 'option-label', 'Opacity'));
  const opacityRange = el('input', 'option-range');
  opacityRange.type = 'range';
  opacityRange.min = 0;
  opacityRange.max = 100;
  opacityRange.step = 1;
  const opacityValue = el('span', 'layers-opacity-value', '100');
  opacityRange.addEventListener('input', () => {
    const active = getActiveLayer();
    opacityValue.textContent = opacityRange.value;
    if (active) updateLayerProps(active.id, { opacity: Number(opacityRange.value) / 100 });
  });
  opacityWrap.append(opacityRange, opacityValue);
  header.append(blendSelect, opacityWrap);

  // --- Layer list ---
  const list = el('div', 'layers-list');
  const thumbs = new Map(); // layerId -> thumbnail canvas

  // --- Footer buttons ---
  const footer = el('div', 'layers-footer');
  const newBtn = el('button', 'layers-button', 'New');
  newBtn.type = 'button';
  newBtn.title = 'New Layer';
  newBtn.addEventListener('click', () => addLayer());
  const dupBtn = el('button', 'layers-button', 'Duplicate');
  dupBtn.type = 'button';
  dupBtn.title = 'Duplicate Layer';
  dupBtn.addEventListener('click', () => {
    const active = getActiveLayer();
    if (active) duplicateLayer(active.id);
  });
  const delBtn = el('button', 'layers-button', 'Delete');
  delBtn.type = 'button';
  delBtn.title = 'Delete Layer';
  delBtn.addEventListener('click', () => {
    const active = getActiveLayer();
    if (active) removeLayer(active.id);
  });
  footer.append(newBtn, dupBtn, delBtn);

  root.append(header, list, footer);

  function startRename(layer, nameSpan) {
    const input = el('input', 'layer-rename');
    input.type = 'text';
    input.value = layer.name;
    nameSpan.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      const name = input.value.trim();
      if (commit && name && name !== layer.name) {
        updateLayerProps(layer.id, { name }); // emits layers:changed -> refresh
      } else {
        refresh();
      }
    };
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
    });
  }

  function buildRow(layer) {
    const row = el('div', 'layer-row');
    row.classList.toggle('active', layer.id === state.doc.activeLayerId);

    const eye = el('button', 'layer-eye', layer.visible ? '👁' : '');
    eye.type = 'button';
    eye.title = 'Toggle visibility';
    eye.classList.toggle('hidden-layer', !layer.visible);
    eye.addEventListener('click', (e) => {
      e.stopPropagation();
      updateLayerProps(layer.id, { visible: !layer.visible });
    });

    const thumb = el('canvas', 'layer-thumb');
    thumb.width = THUMB_W;
    thumb.height = THUMB_H;
    drawThumb(thumb, layer);
    thumbs.set(layer.id, thumb);

    const name = el('span', 'layer-name', layer.name);
    name.title = layer.name;
    name.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      startRename(layer, name);
    });

    row.append(eye, thumb, name);
    row.addEventListener('click', () => setActiveLayer(layer.id));
    return row;
  }

  function refresh() {
    const docModel = state.doc;
    const active = getActiveLayer();

    // Header reflects the active layer; don't fight the control being dragged.
    if (document.activeElement !== blendSelect) {
      blendSelect.value = active ? active.blendMode : 'source-over';
    }
    if (document.activeElement !== opacityRange) {
      opacityRange.value = active ? Math.round(active.opacity * 100) : 100;
      opacityValue.textContent = opacityRange.value;
    }

    list.innerHTML = '';
    thumbs.clear();
    if (!docModel) return;
    // Topmost layer (end of the array) first in the list.
    for (let i = docModel.layers.length - 1; i >= 0; i--) {
      list.append(buildRow(docModel.layers[i]));
    }
  }

  on('layers:changed', refresh);
  on('doc:changed', refresh);
  on('layer:content', (payload) => {
    const docModel = state.doc;
    if (!docModel) return;
    if (payload && payload.layerId) {
      const thumb = thumbs.get(payload.layerId);
      const layer = docModel.layers.find((l) => l.id === payload.layerId);
      if (thumb && layer) drawThumb(thumb, layer);
    } else {
      for (const [id, thumb] of thumbs) {
        const layer = docModel.layers.find((l) => l.id === id);
        if (layer) drawThumb(thumb, layer);
      }
    }
  });

  refresh();
}
