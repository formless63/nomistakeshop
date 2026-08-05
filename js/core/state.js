// js/core/state.js — app state singleton + tiny synchronous event bus.
// No DOM access at import time; safe to import from Node for tests.

export const state = {
  doc: null,            // see document.js
  activeTool: 'brush',  // tool id string
  toolOptions: {},      // map toolId -> { optionKey: value }, persisted per tool
  primaryColor: '#000000',
  secondaryColor: '#ffffff',
  zoom: 1,              // display scale factor
  panX: 0, panY: 0,     // viewport pan in screen px
  selection: null,      // null | { type:'rect'|'ellipse', x,y,w,h, invert, feather }
                        // | { type:'lasso', points:[{x,y}...], invert, feather }
                        // | { type:'mask', mask: canvas }  (white alpha = selected)
  activeTarget: 'layer', // 'layer' | 'mask' — what paint tools draw into
  grid: { enabled: false, size: 32 }, // doc-space grid overlay (renderer)
  isPointerDown: false, // managed by toolManager
};

const listeners = new Map(); // event -> Set<fn>

export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => off(event, fn);
}

export function off(event, fn) {
  const set = listeners.get(event);
  if (set) set.delete(fn);
}

export function emit(event, payload) {
  const set = listeners.get(event);
  if (!set) return;
  for (const fn of [...set]) fn(payload);
}

// --- Helpers (each emits the matching event) ---

export function setTool(id) {
  if (state.activeTool === id) return;
  state.activeTool = id;
  emit('tool:changed', { tool: id });
}

export function setColor(which, hex) {
  if (which === 'primary') state.primaryColor = hex;
  else state.secondaryColor = hex;
  emit('color:changed', { which });
}

export function swapColors() {
  const tmp = state.primaryColor;
  state.primaryColor = state.secondaryColor;
  state.secondaryColor = tmp;
  emit('color:changed', { which: 'primary' });
  emit('color:changed', { which: 'secondary' });
}

export function setSelection(sel) {
  state.selection = sel;
  emit('selection:changed', sel);
}

export function setActiveTarget(t) {
  const target = t === 'mask' ? 'mask' : 'layer';
  if (state.activeTarget === target) return;
  state.activeTarget = target;
  emit('layers:changed');
}

export function getToolOption(toolId, key, fallback) {
  const opts = state.toolOptions[toolId];
  if (opts && key in opts) return opts[key];
  return fallback;
}

export function setToolOption(toolId, key, value) {
  if (!state.toolOptions[toolId]) state.toolOptions[toolId] = {};
  state.toolOptions[toolId][key] = value;
}
