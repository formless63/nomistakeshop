// js/ui/menuBar.js — application menu bar rendered into #menu-bar.
// Dropdowns: click to open, hover to switch while one is open, close on
// outside click or Esc. Undo/Redo labels + disabled state refresh on
// 'history:changed'; selection-dependent items on 'selection:changed';
// layer-dependent items on 'layers:changed'; Grid check on 'view:changed'.
// v2: Edit gains clipboard Cut/Copy/Paste (via js/io/clipboard.js, loaded
// dynamically); Select All/Deselect move to the NEW top-level Select menu
// (Invert / Feather…); Layer gains mask + adjustment-layer + transform
// items; File gains Export WebP; View gains a Grid toggle.

import { state, on, emit } from '../core/state.js';
import { history } from '../core/history.js';
import { renderer } from '../core/renderer.js';
import * as doc from '../core/document.js';
import * as transform from '../ops/transform.js';
import { FILTER_LIST, ADJUSTABLE_FILTERS, applyFilterToActiveLayer } from '../filters/filterRegistry.js';
import { invertSelection, featherSelection } from '../tools/selectionPath.js';
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

// Active layer when it is a pixel layer, else null.
function activePixelLayer() {
  const layer = doc.getActiveLayer();
  return layer && layer.type === 'pixel' ? layer : null;
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
        { label: 'Export WebP', action: () => io.exportImage('webp') },
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
        {
          label: 'Cut',
          shortcut: 'Ctrl+X',
          disabled: () => !activePixelLayer(),
          action() {
            import('../io/clipboard.js').then((m) => m.cutSelection()).catch(() => {});
          },
        },
        {
          label: 'Copy',
          shortcut: 'Ctrl+C',
          disabled: () => !activePixelLayer(),
          action() {
            import('../io/clipboard.js').then((m) => m.copySelection()).catch(() => {});
          },
        },
        {
          label: 'Paste as New Layer',
          shortcut: 'Ctrl+V',
          disabled: () => !menuClipboard || !menuClipboard.hasClipboard(),
          action() {
            if (menuClipboard) menuClipboard.pasteAsNewLayer();
          },
        },
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
        { separator: true },
        {
          label: 'Add Layer Mask (White)',
          disabled: () => !activePixelLayer() || !!activePixelLayer().mask,
          action: () => doc.addLayerMask(activeLayerId(), 'white'),
        },
        {
          label: 'Add Layer Mask (Black)',
          disabled: () => !activePixelLayer() || !!activePixelLayer().mask,
          action: () => doc.addLayerMask(activeLayerId(), 'black'),
        },
        {
          label: 'Add Layer Mask (from Selection)',
          disabled: () => !activePixelLayer() || !!activePixelLayer().mask || !state.selection,
          action: () => doc.addLayerMask(activeLayerId(), 'selection'),
        },
        {
          label: 'Delete Layer Mask',
          disabled: () => !activePixelLayer() || !activePixelLayer().mask,
          action: () => doc.removeLayerMask(activeLayerId(), false),
        },
        {
          label: 'Apply Layer Mask',
          disabled: () => !activePixelLayer() || !activePixelLayer().mask,
          action: () => doc.removeLayerMask(activeLayerId(), true),
        },
        { separator: true },
        {
          label: 'New Adjustment Layer',
          submenu: ADJUSTABLE_FILTERS.map((f) => ({
            label: f.label.replace(/…$/, ''),
            action: () => doc.addAdjustmentLayer(f.id, defaultAdjustmentParams(f), f.label.replace(/…$/, '')),
          })),
        },
        { separator: true },
        {
          label: 'Transform Layer…',
          disabled: () => !activePixelLayer(),
          action() {
            dialogs.transformLayerDialog().then((v) => {
              if (v) transform.transformActiveLayer(v);
            });
          },
        },
      ],
    },
    {
      label: 'Select',
      items: [
        { label: 'Select All', shortcut: 'Ctrl+A', action: () => doc.selectAll() },
        { label: 'Deselect', shortcut: 'Ctrl+D', action: () => doc.deselect() },
        { separator: true },
        {
          label: 'Invert',
          disabled: () => !state.selection,
          action: () => invertSelection(),
        },
        {
          label: 'Feather…',
          disabled: () => !state.selection,
          action() {
            dialogs
              .promptNumber({
                title: 'Feather Selection',
                fields: [{ key: 'radius', label: 'Radius (px)', min: 0, max: 250, default: 10 }],
              })
              .then((v) => {
                if (v) featherSelection(v.radius);
              });
          },
        },
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
        { separator: true },
        {
          labelFn: () => (state.grid && state.grid.enabled ? '✓ Grid' : 'Grid'),
          action: () => renderer.setGrid(!(state.grid && state.grid.enabled)),
        },
      ],
    },
  ];
}

// Cached clipboard module (dynamic import: avoids core->io cycles and keeps
// hasClipboard() synchronous for menu disabled-state checks).
let menuClipboard = null;

export function initMenuBar() {
  const root = document.getElementById('menu-bar');
  if (!root) return;

  const itemRefs = []; // { el, def } for dynamic label/disabled refresh
  let openWrap = null; // .menu element whose dropdown is open

  import('../io/clipboard.js')
    .then((m) => {
      menuClipboard = m;
      refreshStates();
    })
    .catch(() => {}); // clipboard.js may not exist yet — Paste stays disabled

  function refreshStates() {
    for (const { el: item, def } of itemRefs) {
      item.firstChild.textContent = def.labelFn ? def.labelFn() : def.label;
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

  // Leaf menu item (button). First child is always the label span so
  // refreshStates can rewrite labels without clobbering shortcut hints.
  function buildItem(def, container) {
    const item = el('button', 'menu-item');
    item.type = 'button';
    item.append(el('span', 'menu-item-label', def.labelFn ? def.labelFn() : def.label));
    if (def.shortcut) item.append(el('span', 'menu-shortcut', def.shortcut));
    itemRefs.push({ el: item, def });
    item.addEventListener('click', () => {
      if (def.disabled && def.disabled()) return;
      closeMenus();
      def.action();
    });
    container.append(item);
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
      if (def.submenu) {
        // Flyout parent: hover opens the nested submenu (see CSS).
        const parent = el('div', 'menu-item has-submenu');
        parent.append(el('span', 'menu-item-label', def.label), el('span', 'menu-submenu-arrow', '▸'));
        const sub = el('div', 'menu-submenu');
        for (const subDef of def.submenu) buildItem(subDef, sub);
        parent.append(sub);
        drop.append(parent);
        continue;
      }
      buildItem(def, drop);
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
  on('layers:changed', refreshStates);
  on('view:changed', refreshStates);
  refreshStates();
}
