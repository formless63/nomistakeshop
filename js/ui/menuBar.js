// js/ui/menuBar.js — application menu bar rendered into #menu-bar.
// Dropdowns: click to open, hover to switch while one is open, close on
// outside click or Esc. Undo/Redo labels + disabled state refresh on
// 'history:changed'; 'Crop to Selection' disabled state on 'selection:changed'.

import { state, on, emit } from '../core/state.js';
import { history } from '../core/history.js';
import { renderer } from '../core/renderer.js';
import * as doc from '../core/document.js';
import * as transform from '../ops/transform.js';
import { FILTER_LIST, applyFilterToActiveLayer } from '../filters/filterRegistry.js';
import { io } from '../io/io.js';
import * as dialogs from './dialogs.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function activeLayerId() {
  return state.doc ? state.doc.activeLayerId : null;
}

function zoomAtCenter(factor) {
  const viewport = document.getElementById('viewport');
  if (!viewport) return;
  const rect = viewport.getBoundingClientRect();
  renderer.zoomAt(factor, rect.width / 2, rect.height / 2);
}

async function flattenDocument() {
  if (!state.doc) return;
  const ok = await dialogs.confirm('Flatten all layers into a single layer?');
  if (!ok) return;
  const composite = doc.flattenImage();
  if (!composite) return;
  history.push('Flatten Image');
  const d = state.doc;
  const base = d.layers[0];
  base.ctx.clearRect(0, 0, d.width, d.height);
  base.ctx.drawImage(composite, 0, 0);
  base.name = 'Background';
  base.visible = true;
  base.opacity = 1;
  base.blendMode = 'source-over';
  d.layers.length = 1;
  d.activeLayerId = base.id;
  emit('layers:changed');
  emit('layer:content', { layerId: base.id });
}

function buildMenus() {
  return [
    {
      label: 'File',
      items: [
        {
          label: 'New Document…',
          action() {
            dialogs.newDocument().then((v) => {
              if (!v) return;
              doc.createDocument(v.width, v.height, v.background);
              renderer.fitToScreen();
            });
          },
        },
        { label: 'Open Image…', action: () => io.openImageDialog() },
        { label: 'Open Image as Layer…', action: () => io.openImageAsLayerDialog() },
        { separator: true },
        { label: 'Save Project', action: () => io.saveProject() },
        { label: 'Load Project…', action: () => io.loadProjectDialog() },
        { separator: true },
        { label: 'Export PNG', action: () => io.exportImage('png') },
        { label: 'Export JPEG', action: () => io.exportImage('jpeg') },
      ],
    },
    {
      label: 'Edit',
      items: [
        {
          labelFn: () => (history.undoLabel() ? `Undo ${history.undoLabel()}` : 'Undo'),
          disabled: () => !history.canUndo(),
          action: () => history.undo(),
        },
        {
          labelFn: () => (history.redoLabel() ? `Redo ${history.redoLabel()}` : 'Redo'),
          disabled: () => !history.canRedo(),
          action: () => history.redo(),
        },
        { separator: true },
        { label: 'Select All', action: () => doc.selectAll() },
        { label: 'Deselect', action: () => doc.deselect() },
      ],
    },
    {
      label: 'Image',
      items: [
        {
          label: 'Image Size…',
          action() {
            dialogs.imageSize().then((v) => {
              if (v) transform.resizeImage(v.width, v.height);
            });
          },
        },
        {
          label: 'Canvas Size…',
          action() {
            dialogs.canvasSize().then((v) => {
              if (v) transform.resizeCanvas(v.width, v.height, v.anchor);
            });
          },
        },
        { separator: true },
        { label: 'Rotate 90° CW', action: () => transform.rotate90(1) },
        { label: 'Rotate 90° CCW', action: () => transform.rotate90(-1) },
        { label: 'Rotate 180°', action: () => transform.rotate180() },
        { separator: true },
        { label: 'Flip Horizontal', action: () => transform.flipCanvasHorizontal() },
        { label: 'Flip Vertical', action: () => transform.flipCanvasVertical() },
        { separator: true },
        {
          label: 'Crop to Selection',
          disabled: () => !state.selection || state.selection.type !== 'rect',
          action: () => transform.cropToRect(state.selection),
        },
      ],
    },
    {
      label: 'Layer',
      items: [
        { label: 'New Layer', action: () => doc.addLayer() },
        { label: 'Duplicate Layer', action: () => doc.duplicateLayer(activeLayerId()) },
        { label: 'Delete Layer', action: () => doc.removeLayer(activeLayerId()) },
        { separator: true },
        { label: 'Merge Down', action: () => doc.mergeDown(activeLayerId()) },
        { label: 'Flatten Image…', action: () => flattenDocument() },
        { separator: true },
        { label: 'Flip Layer H', action: () => transform.flipLayerHorizontal(activeLayerId()) },
        { label: 'Flip Layer V', action: () => transform.flipLayerVertical(activeLayerId()) },
      ],
    },
    {
      label: 'Filter',
      items: FILTER_LIST.map((f) => ({
        label: f.label,
        action: () => {
          applyFilterToActiveLayer(f.id); // async — intentionally not awaited
        },
      })),
    },
    {
      label: 'View',
      items: [
        { label: 'Zoom In', action: () => zoomAtCenter(1.25) },
        { label: 'Zoom Out', action: () => zoomAtCenter(0.8) },
        { label: 'Fit to Screen', action: () => renderer.fitToScreen() },
        { label: 'Actual Pixels', action: () => renderer.setZoom(1) },
      ],
    },
  ];
}

export function initMenuBar() {
  const root = document.getElementById('menu-bar');
  if (!root) return;

  const itemRefs = []; // { el, def } for dynamic label/disabled refresh
  let openWrap = null; // .menu element whose dropdown is open

  function refreshStates() {
    for (const { el: item, def } of itemRefs) {
      item.textContent = def.labelFn ? def.labelFn() : def.label;
      item.classList.toggle('disabled', !!(def.disabled && def.disabled()));
    }
  }

  function closeMenus() {
    if (openWrap) {
      openWrap.classList.remove('open');
      openWrap = null;
    }
  }

  function openMenu(wrap) {
    closeMenus();
    refreshStates();
    wrap.classList.add('open');
    openWrap = wrap;
  }

  for (const menu of buildMenus()) {
    const wrap = el('div', 'menu');
    const btn = el('button', 'menu-button', menu.label);
    btn.type = 'button';
    const drop = el('div', 'menu-dropdown');

    for (const def of menu.items) {
      if (def.separator) {
        drop.append(el('div', 'menu-separator'));
        continue;
      }
      const item = el('button', 'menu-item');
      item.type = 'button';
      itemRefs.push({ el: item, def });
      item.addEventListener('click', () => {
        if (def.disabled && def.disabled()) return;
        closeMenus();
        def.action();
      });
      drop.append(item);
    }

    btn.addEventListener('click', () => {
      if (openWrap === wrap) closeMenus();
      else openMenu(wrap);
    });
    btn.addEventListener('mouseenter', () => {
      if (openWrap && openWrap !== wrap) openMenu(wrap);
    });

    wrap.append(btn, drop);
    root.append(wrap);
  }

  document.addEventListener('pointerdown', (e) => {
    if (!root.contains(e.target)) closeMenus();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenus();
  });

  on('history:changed', refreshStates);
  on('selection:changed', refreshStates);
  refreshStates();
}
