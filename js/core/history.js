// js/core/history.js — snapshot-based undo/redo (cap 25).
// Stack mechanics live in the pure, DOM-free SnapshotStack class (Node-testable).
// Canvas snapshot/restore are thin wrappers around it.
// NOTE: this module never imports document.js (it restores state.doc directly),
// so document.js -> history.js creates no import cycle.

import { state, emit } from './state.js';
import { cloneCanvas } from './canvasUtils.js';

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
}

// --- Thin DOM wrappers: snapshot/restore the current document ---

function snapshotDoc() {
  const doc = state.doc;
  if (!doc) return null;
  return {
    width: doc.width,
    height: doc.height,
    background: doc.background,
    activeLayerId: doc.activeLayerId,
    layers: doc.layers.map((l) => ({
      id: l.id,
      name: l.name,
      visible: l.visible,
      opacity: l.opacity,
      blendMode: l.blendMode,
      canvas: cloneCanvas(l.canvas),
    })),
  };
}

function restoreDoc(snap) {
  const layers = snap.layers.map((s) => {
    const canvas = cloneCanvas(s.canvas); // clone again: snapshot stays immutable
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    return {
      id: s.id,
      name: s.name,
      visible: s.visible,
      opacity: s.opacity,
      blendMode: s.blendMode,
      canvas,
      ctx,
    };
  });
  state.doc = {
    width: snap.width,
    height: snap.height,
    background: snap.background,
    layers,
    activeLayerId: snap.activeLayerId,
  };
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

  clear() {
    stack.clear();
    emit('history:changed');
  },
};
