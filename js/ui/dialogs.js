// js/ui/dialogs.js — promise-based modal dialogs rendered into #dialog-root.
// Only one dialog at a time: opening a new one resolves the previous with null.
// Esc key or backdrop click cancels (resolve null). Enter submits. First input
// is focused on open.

import { state } from '../core/state.js';
import { curves } from '../filters/filters.js';

const FONT_CHOICES = ['Arial', 'Georgia', 'Courier New', 'Times New Roman', 'Verdana', 'Impact'];

const DOC_PRESETS = [
  { label: 'Custom', w: 0, h: 0 },
  { label: '1280 × 800', w: 1280, h: 800 },
  { label: '1920 × 1080', w: 1920, h: 1080 },
  { label: '800 × 800', w: 800, h: 800 },
  { label: '2480 × 3508 (A4 @ 300 dpi)', w: 2480, h: 3508 },
];

const ANCHOR_ORDER = ['tl', 't', 'tr', 'l', 'center', 'r', 'bl', 'b', 'br'];

let closeCurrent = null; // fn(result): tears down the open dialog and resolves its promise

function dismiss(result = null) {
  if (!closeCurrent) return;
  const close = closeCurrent;
  closeCurrent = null;
  close(result);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function fieldRow(labelText, input) {
  const row = el('label', 'dialog-field');
  row.append(el('span', 'dialog-field-label', labelText), input);
  return row;
}

function numberInput(value, { min, max, step } = {}) {
  const input = el('input', 'dialog-input');
  input.type = 'number';
  if (min !== undefined) input.min = min;
  if (max !== undefined) input.max = max;
  input.step = step !== undefined ? step : 1;
  input.value = value;
  return input;
}

// Read + validate a bounded integer input. Toggles the 'invalid' class and
// returns {ok, value}.
function readDim(input) {
  const value = Math.round(Number(input.value));
  const ok = Number.isFinite(value) && value >= 1 && value <= 16384;
  input.classList.toggle('invalid', !ok);
  return { ok, value };
}

// Generic modal. buildBody(body) fills the form body; collect() returns the
// resolve value, or `false` to signal validation failure (dialog stays open).
function openDialog({ title, okLabel = 'OK', showCancel = true, buildBody, collect }) {
  dismiss(null);
  const root = document.getElementById('dialog-root');
  if (!root) return Promise.resolve(null);
  root.innerHTML = '';

  return new Promise((resolve) => {
    const overlay = el('div', 'dialog-overlay');
    const card = el('form', 'dialog-card');
    card.setAttribute('role', 'dialog');
    card.noValidate = true;

    card.append(el('div', 'dialog-title', title));
    const body = el('div', 'dialog-body');
    buildBody(body);
    card.append(body);

    const footer = el('div', 'dialog-footer');
    const cancel = el('button', 'dialog-button', showCancel ? 'Cancel' : '');
    if (showCancel) {
      cancel.type = 'button';
      cancel.addEventListener('click', () => finish(null));
      footer.append(cancel);
    }
    const ok = el('button', 'dialog-button primary', okLabel);
    ok.type = 'submit';
    footer.append(ok);
    card.append(footer);

    overlay.append(card);
    root.append(overlay);

    function finish(result) {
      window.removeEventListener('keydown', onKey, true);
      overlay.remove();
      resolve(result);
    }

    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        finish(null);
      }
    };

    closeCurrent = finish;

    overlay.addEventListener('pointerdown', (e) => {
      if (e.target === overlay) finish(null);
    });
    card.addEventListener('submit', (e) => {
      e.preventDefault();
      const values = collect();
      if (values === false) return; // validation failed — stay open
      finish(values);
    });
    window.addEventListener('keydown', onKey, true);

    const first = body.querySelector('input, select, textarea');
    if (first) {
      first.focus();
      if (first.select) first.select();
    }
  });
}

export function alert(message) {
  return openDialog({
    title: 'nomistakeshop',
    okLabel: 'OK',
    showCancel: false,
    buildBody(body) {
      body.append(el('p', 'dialog-message', message));
    },
    collect: () => ({}),
  }).then(() => undefined);
}

export function confirm(message) {
  return openDialog({
    title: 'Confirm',
    buildBody(body) {
      body.append(el('p', 'dialog-message', message));
    },
    collect: () => true,
  }).then((v) => v === true);
}

export function promptNumber({ title, fields }) {
  const entries = [];
  return openDialog({
    title,
    buildBody(body) {
      for (const f of fields) {
        const input = numberInput(f.default, f);
        entries.push({ def: f, input });
        body.append(fieldRow(f.label, input));
      }
    },
    collect() {
      const values = {};
      let valid = true;
      for (const { def, input } of entries) {
        const v = Number(input.value);
        const ok =
          Number.isFinite(v) &&
          (def.min === undefined || v >= def.min) &&
          (def.max === undefined || v <= def.max);
        input.classList.toggle('invalid', !ok);
        if (!ok) valid = false;
        else values[def.key] = v;
      }
      return valid ? values : false;
    },
  });
}

export function promptText({ title, defaults = {} }) {
  let textInput;
  let sizeInput;
  let fontSelect;
  return openDialog({
    title,
    buildBody(body) {
      textInput = el('input', 'dialog-input');
      textInput.type = 'text';
      textInput.value = defaults.text !== undefined ? defaults.text : '';
      textInput.placeholder = 'Text';

      sizeInput = numberInput(defaults.size !== undefined ? defaults.size : 48, { min: 8, max: 400 });

      fontSelect = el('select', 'dialog-input');
      for (const font of FONT_CHOICES) {
        const opt = el('option', '', font);
        opt.value = font;
        fontSelect.append(opt);
      }
      fontSelect.value = defaults.font || 'Arial';

      body.append(fieldRow('Text', textInput), fieldRow('Size', sizeInput), fieldRow('Font', fontSelect));
    },
    collect() {
      const text = textInput.value;
      const size = Number(sizeInput.value);
      const textOk = text.length > 0;
      const sizeOk = Number.isFinite(size) && size >= 1;
      textInput.classList.toggle('invalid', !textOk);
      sizeInput.classList.toggle('invalid', !sizeOk);
      return textOk && sizeOk ? { text, size, font: fontSelect.value } : false;
    },
  });
}

// Range slider + live readout row; reads/writes values[key]. Shared by
// filterParams and levelsDialog.
function sliderRow(body, values, { key, label, min, max, step, start }) {
  values[key] = start;
  const wrap = el('div', 'dialog-slider');
  const slider = el('input');
  slider.type = 'range';
  slider.min = min;
  slider.max = max;
  slider.step = step !== undefined ? step : 1;
  slider.value = start;
  const readout = el('span', 'dialog-slider-value', String(start));
  slider.addEventListener('input', () => {
    values[key] = Number(slider.value);
    readout.textContent = slider.value;
  });
  wrap.append(slider, readout);
  body.append(fieldRow(label, wrap));
}

export function filterParams(filterDef, initial = {}) {
  const values = {};
  return openDialog({
    title: filterDef.label.replace(/…$/, ''),
    buildBody(body) {
      for (const p of filterDef.params) {
        const start = initial[p.key] !== undefined ? initial[p.key] : p.default;
        if (p.type === 'color') {
          values[p.key] = start;
          const input = el('input', 'dialog-color');
          input.type = 'color';
          input.value = start;
          input.addEventListener('input', () => {
            values[p.key] = input.value;
          });
          body.append(fieldRow(p.label, input));
          continue;
        }
        sliderRow(body, values, { key: p.key, label: p.label, min: p.min, max: p.max, step: p.step, start });
      }
    },
    collect: () => ({ ...values }),
  });
}

const LEVELS_FIELDS = [
  { key: 'inBlack', label: 'Input Black', min: 0, max: 254, step: 1 },
  { key: 'inWhite', label: 'Input White', min: 1, max: 255, step: 1 },
  { key: 'gamma', label: 'Gamma', min: 0.1, max: 9.99, step: 0.01 },
  { key: 'outBlack', label: 'Output Black', min: 0, max: 255, step: 1 },
  { key: 'outWhite', label: 'Output White', min: 0, max: 255, step: 1 },
];

const LEVELS_DEFAULTS = { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 };

export function levelsDialog(initial = {}) {
  const start = { ...LEVELS_DEFAULTS, ...initial };
  const values = {};
  return openDialog({
    title: 'Levels',
    buildBody(body) {
      for (const f of LEVELS_FIELDS) {
        sliderRow(body, values, { ...f, start: start[f.key] });
      }
    },
    collect: () => ({ ...values }),
  });
}

export function transformLayerDialog() {
  return promptNumber({
    title: 'Transform Layer',
    fields: [
      { key: 'scaleXPct', label: 'Scale X %', min: 1, max: 1000, default: 100 },
      { key: 'scaleYPct', label: 'Scale Y %', min: 1, max: 1000, default: 100 },
      { key: 'rotateDeg', label: 'Rotate °', min: -360, max: 360, default: 0 },
    ],
  });
}

// --- Curves editor ---------------------------------------------------------
// 256x256 canvas, origin bottom-left (y flipped onto the canvas). Control
// points are draggable, click empty space adds one (kept x-sorted),
// right-click removes one (min 2 points). The preview curve uses the SAME
// interpolation as filters.curves: a synthetic [0..255] ramp ImageData is
// run through curves() and the red channel read back as the LUT.

const CURVES_SIZE = 256;
const CURVES_IDENTITY = [[0, 0], [255, 255]];

function curvesLut(points) {
  const ramp = { data: new Uint8ClampedArray(CURVES_SIZE * 4), width: CURVES_SIZE, height: 1 };
  for (let i = 0; i < CURVES_SIZE; i++) {
    ramp.data[i * 4] = i;
    ramp.data[i * 4 + 1] = i;
    ramp.data[i * 4 + 2] = i;
    ramp.data[i * 4 + 3] = 255;
  }
  curves(ramp, { points });
  const lut = new Uint8ClampedArray(CURVES_SIZE);
  for (let i = 0; i < CURVES_SIZE; i++) lut[i] = ramp.data[i * 4];
  return lut;
}

export function curvesDialog(initial = {}) {
  let points =
    Array.isArray(initial.points) && initial.points.length >= 2
      ? initial.points.map((p) => [Number(p[0]) || 0, Number(p[1]) || 0])
      : CURVES_IDENTITY.map((p) => [...p]);
  points.sort((a, b) => a[0] - b[0]);

  let canvas;
  let ctx;
  let dragIndex = -1;

  const clamp01 = (v) => Math.min(255, Math.max(0, v));

  function draw() {
    const S = CURVES_SIZE;
    ctx.clearRect(0, 0, S, S);
    // Grid (4x4) + diagonal baseline.
    ctx.strokeStyle = '#3a3a3a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let g = 64; g < S; g += 64) {
      ctx.moveTo(g + 0.5, 0);
      ctx.lineTo(g + 0.5, S);
      ctx.moveTo(0, g + 0.5);
      ctx.lineTo(S, g + 0.5);
    }
    ctx.stroke();
    ctx.strokeStyle = '#565656';
    ctx.beginPath();
    ctx.moveTo(0, S - 1);
    ctx.lineTo(S - 1, 0);
    ctx.stroke();
    // Live curve preview via the filters.curves interpolation.
    const lut = curvesLut(points);
    ctx.strokeStyle = '#4c8dff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let x = 0; x < S; x++) {
      const y = S - 1 - lut[x];
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    // Control points.
    for (let i = 0; i < points.length; i++) {
      const cx = points[i][0];
      const cy = S - 1 - points[i][1];
      ctx.beginPath();
      ctx.arc(cx, cy, 4, 0, Math.PI * 2);
      ctx.fillStyle = i === dragIndex ? '#4c8dff' : '#d6d6d6';
      ctx.fill();
      ctx.strokeStyle = '#141414';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  function toData(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * (CURVES_SIZE - 1),
      y: (CURVES_SIZE - 1) - ((e.clientY - rect.top) / rect.height) * (CURVES_SIZE - 1),
    };
  }

  function hitTest(x, y) {
    for (let i = points.length - 1; i >= 0; i--) {
      const dx = points[i][0] - x;
      const dy = points[i][1] - y;
      if (dx * dx + dy * dy <= 64) return i; // ~8px radius in data units
    }
    return -1;
  }

  // Move point i to (x, y), clamped between its neighbours (±1) and 0..255.
  function clampDrag(i, x, y) {
    const min = i > 0 ? points[i - 1][0] + 1 : 0;
    const max = i < points.length - 1 ? points[i + 1][0] - 1 : CURVES_SIZE - 1;
    if (min > max) return; // neighbours are adjacent — no room to move in x
    points[i][0] = Math.min(max, Math.max(min, x));
    points[i][1] = clamp01(y);
  }

  return openDialog({
    title: 'Curves',
    buildBody(body) {
      canvas = el('canvas', 'curves-canvas');
      canvas.width = CURVES_SIZE;
      canvas.height = CURVES_SIZE;
      ctx = canvas.getContext('2d');
      body.append(canvas);

      const resetBtn = el('button', 'dialog-button curves-reset', 'Reset');
      resetBtn.type = 'button';
      resetBtn.addEventListener('click', () => {
        points = CURVES_IDENTITY.map((p) => [...p]);
        dragIndex = -1;
        draw();
      });
      body.append(resetBtn);

      canvas.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const { x, y } = toData(e);
        let i = hitTest(x, y);
        if (i === -1) {
          // Click on empty space adds a point, kept x-sorted.
          const p = [Math.round(clamp01(x)), Math.round(clamp01(y))];
          i = points.findIndex((q) => q[0] > p[0]);
          if (i === -1) i = points.length;
          points.splice(i, 0, p);
        }
        dragIndex = i;
        canvas.setPointerCapture(e.pointerId);
        draw();
      });
      canvas.addEventListener('pointermove', (e) => {
        if (dragIndex === -1) return;
        const { x, y } = toData(e);
        clampDrag(dragIndex, x, y);
        draw();
      });
      canvas.addEventListener('pointerup', () => {
        if (dragIndex === -1) return;
        // Snap to integers on release.
        clampDrag(dragIndex, Math.round(points[dragIndex][0]), Math.round(points[dragIndex][1]));
        dragIndex = -1;
        draw();
      });
      canvas.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (points.length <= 2) return; // keep at least 2 points
        const { x, y } = toData(e);
        const i = hitTest(x, y);
        if (i === -1) return;
        points.splice(i, 1);
        dragIndex = -1;
        draw();
      });

      draw();
    },
    collect() {
      const pts = points
        .map(([x, y]) => [Math.round(clamp01(x)), Math.round(clamp01(y))])
        .sort((a, b) => a[0] - b[0]);
      return { points: pts };
    },
  });
}

export function newDocument() {
  let wInput;
  let hInput;
  let presetSelect;
  let bgSelect;
  return openDialog({
    title: 'New Document',
    buildBody(body) {
      presetSelect = el('select', 'dialog-input');
      DOC_PRESETS.forEach((p, i) => {
        const opt = el('option', '', p.label);
        opt.value = String(i);
        presetSelect.append(opt);
      });
      presetSelect.value = '1'; // 1280 × 800

      wInput = numberInput(1280, { min: 1, max: 16384 });
      hInput = numberInput(800, { min: 1, max: 16384 });

      presetSelect.addEventListener('change', () => {
        const p = DOC_PRESETS[Number(presetSelect.value)];
        if (p.w) {
          wInput.value = p.w;
          hInput.value = p.h;
        }
      });
      const markCustom = () => {
        presetSelect.value = '0';
      };
      wInput.addEventListener('input', markCustom);
      hInput.addEventListener('input', markCustom);

      bgSelect = el('select', 'dialog-input');
      for (const [value, label] of [
        ['white', 'White'],
        ['transparent', 'Transparent'],
        ['black', 'Black'],
      ]) {
        const opt = el('option', '', label);
        opt.value = value;
        bgSelect.append(opt);
      }

      body.append(
        fieldRow('Preset', presetSelect),
        fieldRow('Width', wInput),
        fieldRow('Height', hInput),
        fieldRow('Background', bgSelect),
      );
    },
    collect() {
      const w = readDim(wInput);
      const h = readDim(hInput);
      if (!w.ok || !h.ok) return false;
      const background =
        bgSelect.value === 'white' ? '#ffffff' : bgSelect.value === 'black' ? '#000000' : 'transparent';
      return { width: w.value, height: h.value, background };
    },
  });
}

export function imageSize() {
  const doc = state.doc;
  return promptNumber({
    title: 'Image Size',
    fields: [
      { key: 'width', label: 'Width', min: 1, max: 16384, default: doc ? doc.width : 1 },
      { key: 'height', label: 'Height', min: 1, max: 16384, default: doc ? doc.height : 1 },
    ],
  }).then((v) => (v ? { width: Math.round(v.width), height: Math.round(v.height) } : null));
}

export function canvasSize() {
  const doc = state.doc;
  let anchor = 'center';
  let wInput;
  let hInput;
  return openDialog({
    title: 'Canvas Size',
    buildBody(body) {
      wInput = numberInput(doc ? doc.width : 1, { min: 1, max: 16384 });
      hInput = numberInput(doc ? doc.height : 1, { min: 1, max: 16384 });
      body.append(fieldRow('Width', wInput), fieldRow('Height', hInput));

      const grid = el('div', 'anchor-grid');
      for (const a of ANCHOR_ORDER) {
        const cell = el('button', 'anchor-cell');
        cell.type = 'button';
        cell.dataset.anchor = a;
        cell.title = a;
        if (a === anchor) cell.classList.add('selected');
        cell.addEventListener('click', () => {
          anchor = a;
          for (const c of grid.querySelectorAll('.anchor-cell')) {
            c.classList.toggle('selected', c === cell);
          }
        });
        grid.append(cell);
      }
      body.append(fieldRow('Anchor', grid));
    },
    collect() {
      const w = readDim(wInput);
      const h = readDim(hInput);
      if (!w.ok || !h.ok) return false;
      return { width: w.value, height: h.value, anchor };
    },
  });
}
