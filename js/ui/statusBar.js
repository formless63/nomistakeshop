// js/ui/statusBar.js — status bar rendered into #status-bar.
// Left: document dimensions ('W x H px') on 'doc:changed'.
// Middle: zoom percentage on 'view:changed'.
// Right: transient 'status:message' text (~3s) + live cursor doc position
// tracked from pointermove on #display-canvas (blank when outside).

import { state, on } from '../core/state.js';
import { renderer } from '../core/renderer.js';

const MESSAGE_MS = 3000;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function initStatusBar() {
  const root = document.getElementById('status-bar');
  if (!root) return;

  const docSpan = el('span', 'status-doc');
  const zoomSpan = el('span', 'status-zoom');
  const msgSpan = el('span', 'status-message');
  const posSpan = el('span', 'status-pos');
  const right = el('span', 'status-right');
  right.append(msgSpan, posSpan);
  root.append(docSpan, zoomSpan, right);

  let msgTimer = null;

  function refreshDoc() {
    docSpan.textContent = state.doc ? `${state.doc.width} x ${state.doc.height} px` : 'No document';
  }

  function refreshZoom() {
    zoomSpan.textContent = `${Math.round(state.zoom * 100)}%`;
  }

  on('doc:changed', refreshDoc);
  on('view:changed', refreshZoom);
  on('status:message', (payload) => {
    msgSpan.textContent = payload && payload.text ? payload.text : '';
    if (msgTimer) clearTimeout(msgTimer);
    msgTimer = setTimeout(() => {
      msgSpan.textContent = '';
      msgTimer = null;
    }, MESSAGE_MS);
  });

  const displayCanvas = document.getElementById('display-canvas');
  if (displayCanvas) {
    displayCanvas.addEventListener('pointermove', (e) => {
      if (!state.doc) {
        posSpan.textContent = '';
        return;
      }
      const pt = renderer.screenToDoc(e.offsetX, e.offsetY);
      posSpan.textContent = `${Math.round(pt.x)}, ${Math.round(pt.y)}`;
    });
    displayCanvas.addEventListener('pointerleave', () => {
      posSpan.textContent = '';
    });
  }

  refreshDoc();
  refreshZoom();
}
