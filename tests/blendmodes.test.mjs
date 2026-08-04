// tests/blendmodes.test.mjs — BLEND_MODES list integrity (no DOM).
import test from 'node:test';
import assert from 'node:assert/strict';
import { BLEND_MODES } from '../js/core/blendmodes.js';

// Valid CanvasRenderingContext2D.globalCompositeOperation values
// (compositing ops + CSS blend modes).
const VALID_COMPOSITE_OPS = new Set([
  'source-over', 'source-in', 'source-out', 'source-atop',
  'destination-over', 'destination-in', 'destination-out', 'destination-atop',
  'lighter', 'copy', 'xor',
  'multiply', 'screen', 'overlay', 'darken', 'lighten',
  'color-dodge', 'color-burn', 'hard-light', 'soft-light',
  'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity',
]);

test('BLEND_MODES is a non-empty array', () => {
  assert.ok(Array.isArray(BLEND_MODES));
  assert.ok(BLEND_MODES.length > 0);
});

test('every entry has a string id and label', () => {
  for (const mode of BLEND_MODES) {
    assert.equal(typeof mode.id, 'string');
    assert.equal(typeof mode.label, 'string');
    assert.ok(mode.id.length > 0);
    assert.ok(mode.label.length > 0);
  }
});

test('ids are unique', () => {
  const ids = BLEND_MODES.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('every id is a valid globalCompositeOperation value', () => {
  for (const mode of BLEND_MODES) {
    assert.ok(
      VALID_COMPOSITE_OPS.has(mode.id),
      `"${mode.id}" is not a valid globalCompositeOperation value`,
    );
  }
});

test('includes Normal (source-over) as the default first entry', () => {
  assert.equal(BLEND_MODES[0].id, 'source-over');
});
