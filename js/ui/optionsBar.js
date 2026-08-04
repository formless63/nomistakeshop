// js/ui/optionsBar.js — per-tool option controls rendered into #options-bar.
// Rebuilds on 'tool:changed'. Values read via state.getToolOption and written
// via state.setToolOption.

import { state, on, getToolOption, setToolOption } from '../core/state.js';
import { toolManager } from '../tools/toolManager.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function buildOption(tool, opt) {
  const wrap = el('label', 'option');
  wrap.append(el('span', 'option-label', opt.label));
  const value = getToolOption(tool.id, opt.key, opt.default);

  if (opt.type === 'range') {
    const slider = el('input', 'option-range');
    slider.type = 'range';
    slider.min = opt.min;
    slider.max = opt.max;
    slider.step = opt.step !== undefined ? opt.step : 1;
    slider.value = value;

    const num = el('input', 'option-number');
    num.type = 'number';
    num.min = opt.min;
    num.max = opt.max;
    num.step = opt.step !== undefined ? opt.step : 1;
    num.value = value;

    slider.addEventListener('input', () => {
      num.value = slider.value;
      setToolOption(tool.id, opt.key, Number(slider.value));
    });
    num.addEventListener('input', () => {
      const v = Number(num.value);
      if (!Number.isFinite(v)) return;
      const clamped = Math.min(opt.max, Math.max(opt.min, v));
      slider.value = clamped;
      setToolOption(tool.id, opt.key, clamped);
    });
    num.addEventListener('change', () => {
      num.value = slider.value; // snap display back to the clamped value
    });
    wrap.append(slider, num);
  } else if (opt.type === 'select') {
    const sel = el('select', 'option-select');
    for (const choice of opt.choices) {
      const val = typeof choice === 'object' ? choice.value : choice;
      const label = typeof choice === 'object' ? choice.label !== undefined ? choice.label : choice.value : choice;
      const o = el('option', '', label);
      o.value = val;
      sel.append(o);
    }
    sel.value = value;
    sel.addEventListener('change', () => setToolOption(tool.id, opt.key, sel.value));
    wrap.append(sel);
  } else if (opt.type === 'checkbox') {
    const cb = el('input', 'option-checkbox');
    cb.type = 'checkbox';
    cb.checked = !!value;
    cb.addEventListener('change', () => setToolOption(tool.id, opt.key, cb.checked));
    wrap.append(cb);
  } else if (opt.type === 'number') {
    const num = el('input', 'option-number');
    num.type = 'number';
    if (opt.min !== undefined) num.min = opt.min;
    if (opt.max !== undefined) num.max = opt.max;
    num.step = opt.step !== undefined ? opt.step : 1;
    num.value = value;
    num.addEventListener('input', () => {
      const v = Number(num.value);
      if (Number.isFinite(v)) setToolOption(tool.id, opt.key, v);
    });
    wrap.append(num);
  }

  return wrap;
}

export function initOptionsBar() {
  const root = document.getElementById('options-bar');
  if (!root) return;

  function render() {
    root.innerHTML = '';
    const tool = toolManager.getTools().find((t) => t.id === state.activeTool);
    if (!tool || !tool.options || tool.options.length === 0) {
      root.append(el('span', 'options-hint', tool ? tool.label : ''));
      return;
    }
    for (const opt of tool.options) {
      root.append(buildOption(tool, opt));
    }
  }

  on('tool:changed', render);
  render();
}
