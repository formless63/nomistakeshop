// tests/history.test.mjs — pure SnapshotStack stack-mechanics tests (no DOM).
import test from 'node:test';
import assert from 'node:assert/strict';
import { SnapshotStack } from '../js/core/history.js';

test('starts empty', () => {
  const s = new SnapshotStack();
  assert.equal(s.canUndo(), false);
  assert.equal(s.canRedo(), false);
  assert.equal(s.undo('current'), null);
  assert.equal(s.redo('current'), null);
  assert.equal(s.peekUndo(), null);
  assert.equal(s.peekRedo(), null);
});

test('push makes entries undoable in LIFO order', () => {
  const s = new SnapshotStack();
  s.push({ label: 'a', value: 1 });
  s.push({ label: 'b', value: 2 });
  assert.equal(s.canUndo(), true);
  assert.equal(s.peekUndo().label, 'b');

  const first = s.undo({ label: 'b', value: 'after-b' });
  assert.equal(first.value, 2);
  const second = s.undo({ label: 'a', value: 'after-a' });
  assert.equal(second.value, 1);
  assert.equal(s.canUndo(), false);
  assert.equal(s.undo('x'), null);
});

test('undo moves current to redo stack; redo restores it', () => {
  const s = new SnapshotStack();
  s.push({ label: 'a', value: 1 });
  s.push({ label: 'b', value: 2 });

  s.undo({ label: 'b', value: 'live' }); // undo "b"; live goes to redo
  assert.equal(s.canRedo(), true);
  assert.equal(s.peekRedo().value, 'live');

  const redone = s.redo({ label: 'b', value: 1 }); // current (value 1) back to undo
  assert.equal(redone.value, 'live');
  assert.equal(s.canRedo(), false);
  assert.equal(s.canUndo(), true);
  assert.equal(s.peekUndo().value, 1);
});

test('push clears the redo stack', () => {
  const s = new SnapshotStack();
  s.push({ label: 'a', value: 1 });
  s.undo({ label: 'a', value: 'live' });
  assert.equal(s.canRedo(), true);
  s.push({ label: 'c', value: 3 });
  assert.equal(s.canRedo(), false);
  assert.equal(s.redo('x'), null);
});

test('enforces the 25-snapshot cap by dropping the oldest', () => {
  const s = new SnapshotStack(25);
  for (let i = 0; i < 30; i++) s.push({ label: `op-${i}`, value: i });
  assert.equal(s.undoStack.length, 25);
  // Oldest 5 dropped; oldest remaining is op-5, newest is op-29.
  assert.equal(s.undoStack[0].label, 'op-5');
  assert.equal(s.peekUndo().label, 'op-29');

  // Exactly 25 undos possible.
  let count = 0;
  while (s.canUndo()) {
    s.undo({ label: 'x', value: 'live' });
    count++;
  }
  assert.equal(count, 25);
});

test('custom limit is respected', () => {
  const s = new SnapshotStack(3);
  for (let i = 0; i < 5; i++) s.push({ label: `op-${i}`, value: i });
  assert.equal(s.undoStack.length, 3);
  assert.equal(s.undoStack[0].label, 'op-2');
});

test('clear empties both stacks', () => {
  const s = new SnapshotStack();
  s.push({ label: 'a', value: 1 });
  s.undo({ label: 'a', value: 'live' });
  s.clear();
  assert.equal(s.canUndo(), false);
  assert.equal(s.canRedo(), false);
});

test('undo/redo round trip preserves full sequence', () => {
  const s = new SnapshotStack();
  s.push('s1');
  s.push('s2');
  s.push('s3');
  assert.equal(s.undo('live'), 's3');
  assert.equal(s.undo('s3'), 's2');
  assert.equal(s.redo('s2'), 's3');
  assert.equal(s.redo('s3'), 'live');
  assert.equal(s.canRedo(), false);
});
