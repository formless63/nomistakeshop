// tests/history.test.mjs — pure SnapshotStack stack-mechanics tests (no DOM).
import test from 'node:test';
import assert from 'node:assert/strict';
import { SnapshotStack, history } from '../js/core/history.js';

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

test('list() reports undo-stack labels oldest→newest and the current index', () => {
  const s = new SnapshotStack();
  assert.deepEqual(s.list(), { entries: [], index: 0 });
  s.push({ label: 'a' });
  s.push({ label: 'b' });
  s.push({ label: 'c' });
  assert.deepEqual(s.list(), { entries: ['a', 'b', 'c'], index: 3 });
  s.undo({ label: 'c', value: 'live' });
  assert.deepEqual(s.list(), { entries: ['a', 'b'], index: 2 });
  s.redo({ label: 'c', value: 1 }); // 'current' label follows the restored entry
  assert.deepEqual(s.list(), { entries: ['a', 'b', 'c'], index: 3 });
});

test('jumpTo() moves entries between stacks so exactly index undos remain', () => {
  const s = new SnapshotStack();
  ['a', 'b', 'c', 'd'].forEach((label) => s.push({ label }));

  assert.equal(s.jumpTo(1), 1); // 3 entries move to the redo stack
  assert.deepEqual(s.list(), { entries: ['a'], index: 1 });
  assert.equal(s.redoStack.length, 3);
  assert.equal(s.peekRedo().label, 'b'); // nearest redo is the closest entry

  assert.equal(s.jumpTo(3), 3); // jump forward again
  assert.deepEqual(s.list(), { entries: ['a', 'b', 'c'], index: 3 });
  assert.equal(s.redoStack.length, 1);

  assert.equal(s.jumpTo(4), 4); // exact current position: no movement
  assert.equal(s.canRedo(), false);
});

test('jumpTo() clamps out-of-range and non-numeric indices', () => {
  const s = new SnapshotStack();
  ['a', 'b'].forEach((label) => s.push({ label }));
  assert.equal(s.jumpTo(99), 2); // clamped to total entries
  assert.equal(s.canRedo(), false);
  assert.equal(s.jumpTo(-5), 0); // clamped to 0
  assert.equal(s.canUndo(), false);
  assert.equal(s.redoStack.length, 2);
  assert.equal(s.jumpTo('nonsense'), 0); // stays put: no valid target
  assert.equal(s.redoStack.length, 2);
});

test('push after jumpTo() truncates the redo future', () => {
  const s = new SnapshotStack();
  ['a', 'b', 'c'].forEach((label) => s.push({ label }));
  s.jumpTo(1);
  assert.equal(s.canRedo(), true);
  s.push({ label: 'x' });
  assert.equal(s.canRedo(), false);
  assert.deepEqual(s.list(), { entries: ['a', 'x'], index: 2 });
});

test('history.list()/jumpTo() are safe with no document', () => {
  history.clear();
  assert.deepEqual(history.list(), { entries: [], index: 0 });
  history.jumpTo(0); // no doc -> no-op, must not throw
  history.jumpTo(3);
  assert.equal(history.canUndo(), false);
  assert.equal(history.canRedo(), false);
});
