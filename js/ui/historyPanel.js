// js/ui/historyPanel.js — undo-stack UI rendered into #history-panel.
// Rows come from history.list() -> { entries, index }: undo-stack labels
// oldest→newest, rendered newest-at-bottom. Clicking row i calls
// history.jumpTo(i) so exactly i undos remain. The entry that would be
// undone next (entries[index - 1]) is highlighted as the current position.
// Rebuilds on 'history:changed' and 'doc:changed'. No-op when the host
// element is missing (the orchestrator adds #history-panel to index.html).

import { on } from '../core/state.js';
import { history } from '../core/history.js';

const MAX_ROWS = 25;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function initHistoryPanel() {
  const root = document.getElementById('history-panel');
  if (!root) return;

  root.append(el('div', 'history-header', 'History'));
  const list = el('div', 'history-list');
  root.append(list);

  function refresh() {
    list.innerHTML = '';
    const { entries, index } = history.list();
    if (!entries || entries.length === 0) {
      list.append(el('div', 'history-empty', 'No history yet'));
      return;
    }
    // Display cap: keep the newest MAX_ROWS entries.
    const offset = Math.max(0, entries.length - MAX_ROWS);
    // The entry that would be undone next marks the current position.
    const current = index - 1;
    for (let i = offset; i < entries.length; i++) {
      const row = el('button', 'history-row', entries[i]);
      row.type = 'button';
      if (i === current) row.classList.add('current');
      if (i >= index) row.classList.add('undone'); // defensive: entries past the boundary
      const target = i; // row i click -> history.jumpTo(i)
      row.addEventListener('click', () => history.jumpTo(target));
      list.append(row);
    }
    // Keep the newest entries in view.
    list.scrollTop = list.scrollHeight;
  }

  on('history:changed', refresh);
  on('doc:changed', refresh);
  refresh();
}
