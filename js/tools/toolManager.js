// js/tools/toolManager.js — owns the display canvas pointer/wheel/keyboard
// wiring and routes events to the active tool.
//
// - pointerdown/move/up with setPointerCapture; screen -> doc coords via
//   renderer.screenToDoc; tracks state.isPointerDown.
// - history.push(tool.label) once on pointerdown for destructive tools.
// - wheel: ctrl/meta+wheel zooms around the cursor, plain wheel pans.
// - keyboard shortcuts per ARCHITECTURE.md (ignored while typing in inputs
//   or while a dialog is open in #dialog-root).

import {
  state, on, emit,
  setTool, swapColors, getToolOption, setToolOption,
} from '../core/state.js';
import { history } from '../core/history.js';
import { renderer } from '../core/renderer.js';
import { selectAll, deselect } from '../core/document.js';

const TOOL_KEYS = {
  v: 'move',
  m: 'selectRect',
  l: 'lasso',
  b: 'brush',
  e: 'eraser',
  g: 'fill',
  i: 'eyedropper',
  t: 'text',
  u: 'shapes',
  r: 'gradient',
  c: 'crop',
  h: 'hand',
  z: 'zoom',
};

const tools = new Map(); // id -> tool module (insertion order = toolbar order)
let canvas = null;
let activeTool = null; // tool captured at pointerdown, routes the current stroke
let lastTool = null;   // last active tool, for onDeactivate

function getActiveTool() {
  const tool = tools.get(state.activeTool);
  return tool || null;
}

function toDocPoint(e) {
  return renderer.screenToDoc(e.offsetX, e.offsetY);
}

function isEditableTarget(t) {
  if (!t) return false;
  const tag = t.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    t.isContentEditable === true
  );
}

function isDialogOpen() {
  const root = document.getElementById('dialog-root');
  return !!(root && root.children.length > 0);
}

function adjustBrushSize(dir) {
  const size = getToolOption('brush', 'size', 12);
  const step = size < 10 ? 1 : size < 50 ? 5 : 10;
  const next = Math.min(300, Math.max(1, size + dir * step));
  if (next === size) return;
  setToolOption('brush', 'size', next);
  emit('status:message', { text: `Brush size: ${next}` });
}

function onKeyDown(e) {
  if (isEditableTarget(e.target) || isDialogOpen()) return;
  const mod = e.ctrlKey || e.metaKey;

  if (mod) {
    const key = e.key.toLowerCase();
    if (key === 'z') {
      e.preventDefault();
      if (e.shiftKey) history.redo();
      else history.undo();
    } else if (key === 'y') {
      e.preventDefault();
      history.redo();
    } else if (key === 'a') {
      e.preventDefault();
      if (state.doc) selectAll();
    } else if (key === 'd') {
      e.preventDefault();
      deselect();
    }
    return;
  }
  if (e.altKey) return;

  const key = e.key.toLowerCase();
  if (key === 'x') {
    swapColors();
  } else if (e.key === '[') {
    adjustBrushSize(-1);
  } else if (e.key === ']') {
    adjustBrushSize(1);
  } else if (TOOL_KEYS[key] && tools.has(TOOL_KEYS[key])) {
    setTool(TOOL_KEYS[key]);
  }
}

export const toolManager = {
  init(displayCanvas) {
    canvas = displayCanvas;

    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      state.isPointerDown = true;
      activeTool = getActiveTool();
      if (activeTool) {
        if (activeTool.destructive && state.doc) history.push(activeTool.label);
        if (activeTool.onPointerDown) activeTool.onPointerDown(toDocPoint(e), e);
      }
      e.preventDefault();
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!state.isPointerDown || !activeTool) return;
      if (activeTool.onPointerMove) activeTool.onPointerMove(toDocPoint(e), e);
    });

    const endStroke = (e) => {
      if (!state.isPointerDown) return;
      state.isPointerDown = false;
      if (activeTool && activeTool.onPointerUp) {
        activeTool.onPointerUp(toDocPoint(e), e);
      }
      activeTool = null;
    };
    canvas.addEventListener('pointerup', endStroke);
    canvas.addEventListener('pointercancel', endStroke);

    // Right-click is used by the eyedropper for secondary-color picking.
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const factor = e.deltaY < 0 ? 1.25 : 0.8;
        renderer.zoomAt(factor, e.offsetX, e.offsetY);
      } else {
        renderer.pan(-e.deltaX, -e.deltaY);
      }
    }, { passive: false });

    window.addEventListener('keydown', onKeyDown);

    on('tool:changed', ({ tool } = {}) => {
      const next = getActiveTool();
      if (lastTool && lastTool !== next && lastTool.onDeactivate) lastTool.onDeactivate();
      lastTool = next;
      if (canvas && next) canvas.style.cursor = next.cursor || 'default';
    });

    const initial = getActiveTool();
    lastTool = initial;
    if (canvas && initial) canvas.style.cursor = initial.cursor || 'default';
  },

  register(toolModule) {
    if (!toolModule || !toolModule.id) return;
    tools.set(toolModule.id, toolModule);
  },

  getTools() {
    return [...tools.values()];
  },
};
