// js/ui/mobileBar.js — mobile drawer controls (ARCHITECTURE v3 §4).
// Injects a '☰ Layers' toggle into #options-bar and a '✕' close button at
// the top of #side-panel. Clicking the toggle flips body.panel-open (CSS at
// <= 800px turns #side-panel into a fixed right drawer); tapping the
// viewport or the #panel-backdrop closes it. All visibility is CSS-driven
// via media queries, so this is a visual no-op on desktop.

import { on } from '../core/state.js';

let initialized = false;

export function initMobileBar() {
  if (initialized) return;
  initialized = true;

  const optionsBar = document.getElementById('options-bar');
  const sidePanel = document.getElementById('side-panel');
  const viewport = document.getElementById('viewport');
  const backdrop = document.getElementById('panel-backdrop');
  if (!optionsBar || !sidePanel) return;

  const close = () => document.body.classList.remove('panel-open');

  // --- Toggle button in the options bar (right-aligned via CSS) ---
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'mobile-panel-toggle';
  toggle.textContent = '☰ Layers';
  toggle.setAttribute('aria-label', 'Toggle layers panel');
  toggle.addEventListener('click', () => {
    document.body.classList.toggle('panel-open');
  });
  optionsBar.append(toggle);

  // optionsBar re-renders (innerHTML = '') on every 'tool:changed', wiping
  // the toggle. Re-append it after each rebuild; queueMicrotask makes this
  // robust regardless of listener registration order.
  const ensureToggle = () => {
    if (toggle.parentNode !== optionsBar) optionsBar.append(toggle);
  };
  on('tool:changed', () => queueMicrotask(ensureToggle));

  // --- Close affordance at the top of the drawer ---
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'mobile-panel-close';
  closeBtn.textContent = '✕';
  closeBtn.setAttribute('aria-label', 'Close panel');
  closeBtn.addEventListener('click', close);
  sidePanel.prepend(closeBtn);

  // --- Tapping the viewport or the backdrop closes the drawer ---
  if (viewport) {
    viewport.addEventListener('pointerdown', () => {
      if (document.body.classList.contains('panel-open')) close();
    });
  }
  if (backdrop) {
    backdrop.addEventListener('pointerdown', close);
  }
}
