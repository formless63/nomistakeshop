// js/ui/colorPanel.js — foreground/background color UI rendered into #color-panel.
// Overlapping primary/secondary swatches (primary in front), a swap button,
// one hidden <input type="color"> per swatch, and a 16-color preset grid
// (click = primary, alt-click / right-click = secondary).

import { state, on, setColor, swapColors } from '../core/state.js';

const PRESET_COLORS = [
  '#000000', '#ffffff', '#404040', '#808080',
  '#c0c0c0', '#ff0000', '#ff8000', '#ffff00',
  '#008000', '#00ff00', '#00ffff', '#0000ff',
  '#800080', '#ff00ff', '#8b4513', '#ffc0cb',
];

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function initColorPanel() {
  const root = document.getElementById('color-panel');
  if (!root) return;

  // --- Overlapping swatches + swap ---
  const swatchArea = el('div', 'color-swatches');
  const secondaryBox = el('button', 'color-swatch secondary');
  const primaryBox = el('button', 'color-swatch primary');
  secondaryBox.type = 'button';
  primaryBox.type = 'button';
  secondaryBox.title = 'Secondary color';
  primaryBox.title = 'Primary color';
  const swapBtn = el('button', 'color-swap', '⇄');
  swapBtn.type = 'button';
  swapBtn.title = 'Swap colors (X)';
  swatchArea.append(secondaryBox, primaryBox, swapBtn);

  const primaryInput = el('input', 'color-input');
  const secondaryInput = el('input', 'color-input');
  primaryInput.type = 'color';
  secondaryInput.type = 'color';

  primaryBox.addEventListener('click', () => primaryInput.click());
  secondaryBox.addEventListener('click', () => secondaryInput.click());
  primaryInput.addEventListener('input', () => setColor('primary', primaryInput.value));
  secondaryInput.addEventListener('input', () => setColor('secondary', secondaryInput.value));
  swapBtn.addEventListener('click', () => swapColors());

  // --- Preset grid ---
  const grid = el('div', 'color-presets');
  for (const hex of PRESET_COLORS) {
    const swatch = el('button', 'color-preset');
    swatch.type = 'button';
    swatch.style.background = hex;
    swatch.title = hex;
    swatch.addEventListener('click', (e) => {
      setColor(e.altKey ? 'secondary' : 'primary', hex);
    });
    swatch.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      setColor('secondary', hex);
    });
    grid.append(swatch);
  }

  root.append(swatchArea, primaryInput, secondaryInput, grid);

  function refresh() {
    primaryBox.style.background = state.primaryColor;
    secondaryBox.style.background = state.secondaryColor;
    primaryInput.value = state.primaryColor;
    secondaryInput.value = state.secondaryColor;
  }

  on('color:changed', refresh);
  refresh();
}
