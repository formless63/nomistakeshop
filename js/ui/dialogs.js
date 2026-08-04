// js/ui/dialogs.js — promise-based modal dialogs rendered into #dialog-root.
// Only one dialog at a time: opening a new one resolves the previous with null.
// Esc key or backdrop click cancels (resolve null). Enter submits. First input
// is focused on open.

import { state } from '../core/state.js';

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
    title: 'NoMistakeShop',
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

export function filterParams(filterDef) {
  const values = {};
  return openDialog({
    title: filterDef.label.replace(/…$/, ''),
    buildBody(body) {
      for (const p of filterDef.params) {
        values[p.key] = p.default;
        const wrap = el('div', 'dialog-slider');
        const slider = el('input');
        slider.type = 'range';
        slider.min = p.min;
        slider.max = p.max;
        slider.step = p.step !== undefined ? p.step : 1;
        slider.value = p.default;
        const readout = el('span', 'dialog-slider-value', String(p.default));
        slider.addEventListener('input', () => {
          values[p.key] = Number(slider.value);
          readout.textContent = slider.value;
        });
        wrap.append(slider, readout);
        body.append(fieldRow(p.label, wrap));
      }
    },
    collect: () => ({ ...values }),
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
