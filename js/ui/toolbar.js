// js/ui/toolbar.js — vertical tool palette rendered into #toolbar.
// Buttons come from toolManager.getTools(); active tool highlighted on
// 'tool:changed'.

import { state, on, setTool } from '../core/state.js';
import { toolManager } from '../tools/toolManager.js';

// Keyboard shortcuts from the architecture contract (used for tooltips when a
// tool module doesn't declare its own `shortcut`).
const SHORTCUTS = {
  move: 'V',
  selectRect: 'M',
  lasso: 'L',
  crop: 'C',
  eyedropper: 'I',
  brush: 'B',
  eraser: 'E',
  fill: 'G',
  gradient: 'R',
  text: 'T',
  shapes: 'U',
  hand: 'H',
  zoom: 'Z',
};

export function initToolbar() {
  const root = document.getElementById('toolbar');
  if (!root) return;

  const buttons = new Map(); // toolId -> button

  for (const tool of toolManager.getTools()) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tool-button';
    btn.textContent = tool.icon;
    const shortcut = tool.shortcut || SHORTCUTS[tool.id];
    btn.title = shortcut ? `${tool.label} (${shortcut})` : tool.label;
    btn.addEventListener('click', () => setTool(tool.id));
    root.append(btn);
    buttons.set(tool.id, btn);
  }

  function updateActive() {
    for (const [id, btn] of buttons) {
      btn.classList.toggle('active', id === state.activeTool);
    }
  }

  on('tool:changed', updateActive);
  updateActive();
}
