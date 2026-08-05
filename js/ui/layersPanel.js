// js/ui/layersPanel.js — layer stack UI rendered into #layers-panel.
// Header: blend-mode select + opacity slider for the ACTIVE layer (both
// pixel and adjustment layers).
// List: state.doc.layers reversed (topmost layer first), per-row eye toggle,
// 48x36 thumbnail, double-click rename, click to activate.
// v2: adjustment layers show a '◐' icon (never touch layer.canvas) and open
// their edit dialog on row double-click; pixel layers with a mask show a
// second mask thumbnail — clicking thumbnails switches state.activeTarget.
// Footer: New / Duplicate / Delete / Mask / Adj (adjustment-layer popup).
// Full rebuild on 'layers:changed' and 'doc:changed'; thumbnails redrawn on
// 'layer:content'.

import { state, on, setActiveTarget } from '../core/state.js';
import { BLEND_MODES } from '../core/blendmodes.js';
import {
  getActiveLayer,
  updateLayerProps,
  setActiveLayer,
  addLayer,
  duplicateLayer,
  removeLayer,
  addLayerMask,
  addAdjustmentLayer,
  setAdjustment,
} from '../core/document.js';
import { FILTER_LIST, ADJUSTABLE_FILTERS } from '../filters/filterRegistry.js';
import * as dialogs from './dialogs.js';

const THUMB_W = 48;
const THUMB_H = 36;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function drawThumb(canvas, srcCanvas) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!srcCanvas || !srcCanvas.width || !srcCanvas.height) return;
  const scale = Math.min(canvas.width / srcCanvas.width, canvas.height / srcCanvas.height);
  const w = Math.max(1, srcCanvas.width * scale);
  const h = Math.max(1, srcCanvas.height * scale);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(srcCanvas, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
}

// Default params for a new adjustment layer of the given FILTER_LIST entry.
function defaultAdjustmentParams(entry) {
  if (entry.custom === 'levels') {
    return { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 };
  }
  if (entry.custom === 'curves') return { points: [[0, 0], [255, 255]] };
  const params = {};
  for (const p of entry.params || []) params[p.key] = p.default;
  return params;
}

// Opens the appropriate edit dialog for an adjustment layer, prefilled with
// its current params; commits via setAdjustment on confirm.
async function editAdjustment(layer) {
  if (!layer.adjustment) return;
  const entry = FILTER_LIST.find((f) => f.id === layer.adjustment.filterId);
  if (!entry) return;
  const current = layer.adjustment.params || {};
  let params = null;
  if (entry.custom === 'levels') params = await dialogs.levelsDialog(current);
  else if (entry.custom === 'curves') params = await dialogs.curvesDialog(current);
  else params = await dialogs.filterParams(entry, current);
  if (params) setAdjustment(layer.id, entry.id, params);
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
  const thumbs = new Map(); // layerId -> { layer: canvas, mask: canvas|null }

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
  const maskBtn = el('button', 'layers-button', 'Mask');
  maskBtn.type = 'button';
  maskBtn.title = 'Add Layer Mask (white)';
  maskBtn.addEventListener('click', () => {
    const active = getActiveLayer();
    if (active) addLayerMask(active.id, 'white');
  });
  const adjBtn = el('button', 'layers-button', 'Adj');
  adjBtn.type = 'button';
  adjBtn.title = 'New Adjustment Layer';
  footer.append(newBtn, dupBtn, delBtn, maskBtn, adjBtn);

  // --- Adj popup: small menu listing ADJUSTABLE_FILTERS ---
  let adjPopup = null;
  function closeAdjPopup() {
    if (adjPopup) {
      adjPopup.remove();
      adjPopup = null;
    }
  }
  adjBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (adjPopup) {
      closeAdjPopup();
      return;
    }
    adjPopup = el('div', 'adj-popup');
    for (const entry of ADJUSTABLE_FILTERS) {
      const label = entry.label.replace(/…$/, '');
      const item = el('button', 'adj-popup-item', label);
      item.type = 'button';
      item.addEventListener('click', () => {
        closeAdjPopup();
        addAdjustmentLayer(entry.id, defaultAdjustmentParams(entry), label);
      });
      adjPopup.append(item);
    }
    footer.append(adjPopup);
  });
  document.addEventListener('pointerdown', (e) => {
    if (adjPopup && !adjPopup.contains(e.target) && e.target !== adjBtn) closeAdjPopup();
  });

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

  function makeThumb(className, srcCanvas, title) {
    const thumb = el('canvas', className);
    thumb.width = THUMB_W;
    thumb.height = THUMB_H;
    thumb.title = title;
    drawThumb(thumb, srcCanvas);
    return thumb;
  }

  function buildRow(layer) {
    const row = el('div', 'layer-row');
    const isActive = layer.id === state.doc.activeLayerId;
    row.classList.toggle('active', isActive);

    const eye = el('button', 'layer-eye', layer.visible ? '👁' : '');
    eye.type = 'button';
    eye.title = 'Toggle visibility';
    eye.classList.toggle('hidden-layer', !layer.visible);
    eye.addEventListener('click', (e) => {
      e.stopPropagation();
      updateLayerProps(layer.id, { visible: !layer.visible });
    });

    const name = el('span', 'layer-name', layer.name);
    name.title = layer.name;
    name.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      startRename(layer, name);
    });

    if (layer.type === 'adjustment') {
      // No pixel canvas on adjustment layers — show an icon instead.
      const icon = el('div', 'layer-adjust-icon', '◐');
      icon.title = 'Adjustment layer — double-click to edit';
      row.append(eye, icon, name);
      // Double-click on the row body (not the name) opens the edit dialog.
      row.addEventListener('dblclick', () => editAdjustment(layer));
    } else {
      // Smart layers have no doc-size canvas — thumbnail their pristine source.
      const isSmart = layer.type === 'smart';
      const thumbSrc = isSmart ? layer.source : layer.canvas;
      const thumb = makeThumb('layer-thumb', thumbSrc, 'Layer content — click to edit pixels');
      thumb.classList.toggle('target-active', isActive && state.activeTarget !== 'mask');
      thumb.addEventListener('click', (e) => {
        e.stopPropagation();
        setActiveLayer(layer.id);
        setActiveTarget('layer');
      });
      const entry = { layer: thumb, mask: null };
      row.append(eye, thumb);
      if (isSmart) {
        const badge = el('span', 'layer-smart-badge', '✦');
        badge.title = 'Smart layer — transforms are non-destructive';
        row.append(badge);
      }
      if (layer.mask) {
        const maskThumb = makeThumb('layer-thumb mask-thumb', layer.mask.canvas, 'Layer mask — click to edit mask');
        maskThumb.classList.toggle('target-active', isActive && state.activeTarget === 'mask');
        maskThumb.addEventListener('click', (e) => {
          e.stopPropagation();
          setActiveLayer(layer.id);
          setActiveTarget('mask');
        });
        entry.mask = maskThumb;
        row.append(maskThumb);
      }
      thumbs.set(layer.id, entry);
      row.append(name);
    }

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
    maskBtn.disabled = !active || active.type === 'adjustment' || !!active.mask;

    closeAdjPopup();
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
    const redraw = (id) => {
      const entry = thumbs.get(id);
      const layer = docModel.layers.find((l) => l.id === id);
      if (!entry || !layer || layer.type === 'adjustment') return;
      const src = layer.type === 'smart' ? layer.source : layer.canvas;
      if (entry.layer && src) drawThumb(entry.layer, src);
      if (entry.mask && layer.mask) drawThumb(entry.mask, layer.mask.canvas);
    };
    if (payload && payload.layerId) {
      redraw(payload.layerId);
    } else {
      for (const id of thumbs.keys()) redraw(id);
    }
  });

  refresh();
}
