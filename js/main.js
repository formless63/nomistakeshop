// NoMistakeShop bootstrap — wires every module together.
import { state, setTool } from './core/state.js';
import { renderer } from './core/renderer.js';
import { history } from './core/history.js';
import { createDocument } from './core/document.js';

import { toolManager } from './tools/toolManager.js';
import move from './tools/move.js';
import selectRect from './tools/selectRect.js';
import lasso from './tools/lasso.js';
import crop from './tools/crop.js';
import eyedropper from './tools/eyedropper.js';
import brush from './tools/brush.js';
import eraser from './tools/eraser.js';
import fill from './tools/fill.js';
import gradient from './tools/gradient.js';
import text from './tools/text.js';
import shapes from './tools/shapes.js';
import hand from './tools/hand.js';
import zoom from './tools/zoom.js';

import { io } from './io/io.js';

import { initMenuBar } from './ui/menuBar.js';
import { initToolbar } from './ui/toolbar.js';
import { initOptionsBar } from './ui/optionsBar.js';
import { initLayersPanel } from './ui/layersPanel.js';
import { initColorPanel } from './ui/colorPanel.js';
import { initStatusBar } from './ui/statusBar.js';
import * as dialogs from './ui/dialogs.js';

function boot() {
  const displayCanvas = document.getElementById('display-canvas');

  // Order matters: renderer first so it subscribes to events before
  // anything can emit them.
  renderer.init(displayCanvas);

  for (const tool of [move, selectRect, lasso, crop, eyedropper, brush,
    eraser, fill, gradient, text, shapes, hand, zoom]) {
    toolManager.register(tool);
  }
  toolManager.init(displayCanvas);

  io.init();
  initMenuBar();
  initToolbar();
  initOptionsBar();
  initLayersPanel();
  initColorPanel();
  initStatusBar();

  setTool('brush');

  // Start with a fresh document; offer the New Document dialog on first load.
  createDocument(1280, 800, '#ffffff');
  renderer.fitToScreen();
  dialogs.newDocument().then((res) => {
    if (res) {
      createDocument(res.width, res.height, res.background);
      renderer.fitToScreen();
    }
  });
}

if (typeof document !== 'undefined') {
  // Test/debug hook: lets e2e smoke tests and the console drive the app internals.
  window.__nms = { state, renderer, history, toolManager, io, createDocument, dialogs };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
}
