// js/core/history.js — snapshot-based undo/redo (cap 25).
// Stack mechanics live in the pure, DOM-free SnapshotStack class (Node-testable).
// Canvas snapshot/restore are thin wrappers around it.
// NOTE: this module never imports document.js (it restores state.doc directly),
// so document.js -> history.js creates no import cycle.
//
// v2: snapshots round-trip BOTH layer kinds — pixel layers (cloned canvas,
// cloned mask canvas + enabled flag) and adjustment layers (deep-copied
// adjustment object). Restore rebuilds ctx objects for both.
// v5: smart layers round-trip too — cloned source canvas, JSON-deep-copied
// transform, mask exactly like pixel layers.

import { state, emit } from './state.js';
import { cloneCanvas, docColorSpace } from './canvasUtils.js';

export class SnapshotStack {
  constructor(limit = 25) {
    this.limit = limit;
    this.undoStack = [];
    this.redoStack = [];
  }

  // Push an entry (any payload) onto the undo stack; clears the redo stack;
  // enforces the size cap by dropping the oldest entries.
  push(entry) {
    this.undoStack.push(entry);
    while (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  // Moves `current` onto the redo stack and returns the entry to restore,
  // or null when there is nothing to undo.
  undo(current) {
    if (this.undoStack.length === 0) return null;
    this.redoStack.push(current);
    return this.undoStack.pop();
  }

  // Moves `current` onto the undo stack and returns the entry to restore,
  // or null when there is nothing to redo.
  redo(current) {
    if (this.redoStack.length === 0) return null;
    this.undoStack.push(current);
    return this.redoStack.pop();
  }

  canUndo() {
    return this.undoStack.length > 0;
  }

  canRedo() {
    return this.redoStack.length > 0;
  }

  peekUndo() {
    return this.undoStack.length ? this.undoStack[this.undoStack.length - 1] : null;
  }

  peekRedo() {
    return this.redoStack.length ? this.redoStack[this.redoStack.length - 1] : null;
  }

  clear() {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }

  // { entries: undo-stack labels oldest→newest, index: number of applicable
  // undos } — the position a history panel highlights.
  list() {
    return { entries: this.undoStack.map((e) => e.label), index: this.undoStack.length };
  }

  // Pure jump: moves entries between the stacks (no snapshotting) so exactly
  // `index` entries remain on the undo stack. Clamped to [0, total entries].
  jumpTo(index) {
    const total = this.undoStack.length + this.redoStack.length;
    let target = Math.trunc(Number(index));
    if (!Number.isFinite(target)) target = this.undoStack.length;
    target = Math.max(0, Math.min(target, total));
    while (this.undoStack.length > target) this.redoStack.push(this.undoStack.pop());
    while (this.undoStack.length < target) this.undoStack.push(this.redoStack.pop());
    return target;
  }
}

// --- Thin DOM wrappers: snapshot/restore the current document ---

function snapshotMask(mask) {
  return mask ? { canvas: cloneCanvas(mask.canvas), enabled: mask.enabled } : null;
}

function snapshotLayer(l) {
  const base = {
    id: l.id,
    type: l.type || 'pixel',
    name: l.name,
    visible: l.visible,
    opacity: l.opacity,
    blendMode: l.blendMode,
  };
  if (base.type === 'adjustment') {
    return { ...base, adjustment: l.adjustment ? JSON.parse(JSON.stringify(l.adjustment)) : null };
  }
  if (base.type === 'smart') {
    return {
      ...base,
      source: cloneCanvas(l.source),
      transform: l.transform ? JSON.parse(JSON.stringify(l.transform)) : null,
      mask: snapshotMask(l.mask),
    };
  }
  return {
    ...base,
    canvas: cloneCanvas(l.canvas),
    mask: snapshotMask(l.mask),
  };
}

function restoreMask(sMask) {
  if (!sMask) return null;
  const maskCanvas = cloneCanvas(sMask.canvas);
  return {
    canvas: maskCanvas,
    ctx: maskCanvas.getContext('2d', { willReadFrequently: true, colorSpace: docColorSpace() }),
    enabled: sMask.enabled,
  };
}

function restoreLayer(s) {
  const base = {
    id: s.id,
    type: s.type || 'pixel',
    name: s.name,
    visible: s.visible,
    opacity: s.opacity,
    blendMode: s.blendMode,
  };
  if (base.type === 'adjustment') {
    return { ...base, adjustment: s.adjustment ? JSON.parse(JSON.stringify(s.adjustment)) : null };
  }
  if (base.type === 'smart') {
    return {
      ...base,
      source: cloneCanvas(s.source), // clone again: snapshot stays immutable
      transform: s.transform ? JSON.parse(JSON.stringify(s.transform)) : null,
      mask: restoreMask(s.mask),
    };
  }
  const canvas = cloneCanvas(s.canvas); // clone again: snapshot stays immutable
  const ctx = canvas.getContext('2d', { willReadFrequently: true, colorSpace: docColorSpace() });
  return { ...base, canvas, ctx, mask: restoreMask(s.mask) };
}

function snapshotDoc() {
  const doc = state.doc;
  if (!doc) return null;
  return {
    width: doc.width,
    height: doc.height,
    background: doc.background,
    colorSpace: doc.colorSpace || 'srgb',
    activeLayerId: doc.activeLayerId,
    layers: doc.layers.map(snapshotLayer),
  };
}

function restoreDoc(snap) {
  state.doc = {
    width: snap.width,
    height: snap.height,
    background: snap.background,
    colorSpace: snap.colorSpace || 'srgb',
    layers: snap.layers.map(restoreLayer),
    activeLayerId: snap.activeLayerId,
  };
  state.activeTarget = 'layer';
}

function emitRestored() {
  emit('doc:changed');
  emit('layers:changed');
  emit('layer:content');
  emit('history:changed');
}

const stack = new SnapshotStack(25);

export const history = {
  push(label) {
    if (!state.doc) return;
    stack.push({ label, snap: snapshotDoc() });
    emit('history:changed');
  },

  undo() {
    const top = stack.peekUndo();
    if (!state.doc || !top) return;
    const entry = stack.undo({ label: top.label, snap: snapshotDoc() });
    if (!entry) return;
    restoreDoc(entry.snap);
    emitRestored();
  },

  redo() {
    const top = stack.peekRedo();
    if (!state.doc || !top) return;
    const entry = stack.redo({ label: top.label, snap: snapshotDoc() });
    if (!entry) return;
    restoreDoc(entry.snap);
    emitRestored();
  },

  canUndo() {
    return stack.canUndo();
  },

  canRedo() {
    return stack.canRedo();
  },

  undoLabel() {
    const e = stack.peekUndo();
    return e ? e.label : null;
  },

  redoLabel() {
    const e = stack.peekRedo();
    return e ? e.label : null;
  },

  // { entries: [label,...] oldest→newest, index: number of applicable undos }.
  list() {
    return stack.list();
  },

  // Jumps so exactly `index` undos remain, via repeated undo()/redo()
  // (bounded by the total number of entries; each step snapshots normally).
  jumpTo(index) {
    if (!state.doc) return;
    const total = stack.undoStack.length + stack.redoStack.length;
    let target = Math.trunc(Number(index));
    if (!Number.isFinite(target)) return;
    target = Math.max(0, Math.min(target, total));
    let guard = total + 1;
    while (stack.undoStack.length !== target && guard-- > 0) {
      if (stack.undoStack.length > target) {
        if (!stack.canUndo()) break;
        history.undo();
      } else {
        if (!stack.canRedo()) break;
        history.redo();
      }
    }
  },

  clear() {
    stack.clear();
    emit('history:changed');
  },
};
