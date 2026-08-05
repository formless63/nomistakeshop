// nomistakeshop bootstrap — wires every module together.
import { state, setTool } from './core/state.js';
import { renderer } from './core/renderer.js';
import { history } from './core/history.js';
import { createDocument } from './core/document.js';

import { toolManager } from './tools/toolManager.js';
import move from './tools/move.js';
import selectRect from './tools/selectRect.js';
import selectEllipse from './tools/selectEllipse.js';
import lasso from './tools/lasso.js';
import wand from './tools/wand.js';
import crop from './tools/crop.js';
import eyedropper from './tools/eyedropper.js';
import brush from './tools/brush.js';
import eraser from './tools/eraser.js';
import clone from './tools/clone.js';
import dodgeBurn from './tools/dodgeBurn.js';
import fill from './tools/fill.js';
import gradient from './tools/gradient.js';
import text from './tools/text.js';
import shapes from './tools/shapes.js';
import hand from './tools/hand.js';
import zoom from './tools/zoom.js';

import { io } from './io/io.js';
import * as autosave from './io/autosave.js';

import { initMenuBar } from './ui/menuBar.js';
import { initToolbar } from './ui/toolbar.js';
import { initOptionsBar } from './ui/optionsBar.js';
import { initLayersPanel } from './ui/layersPanel.js';
import { initColorPanel } from './ui/colorPanel.js';
import { initStatusBar } from './ui/statusBar.js';
import { initHistoryPanel } from './ui/historyPanel.js';
import { initMobileBar } from './ui/mobileBar.js';
import * as dialogs from './ui/dialogs.js';

async function boot() {
  const displayCanvas = document.getElementById('display-canvas');

  // Order matters: renderer first so it subscribes to events before
  // anything can emit them.
  renderer.init(displayCanvas);

  for (const tool of [move, selectRect, selectEllipse, lasso, wand, crop,
    eyedropper, brush, eraser, clone, dodgeBurn, fill, gradient, text,
    shapes, hand, zoom]) {
    toolManager.register(tool);
  }
  toolManager.init(displayCanvas);

  io.init();
  io.initDragDrop();
  io.initPaste();
  initMenuBar();
  initToolbar();
  initOptionsBar();
  initLayersPanel();
  initColorPanel();
  initStatusBar();
  initHistoryPanel();
  initMobileBar();

  setTool('brush');
  autosave.scheduleAutosave();

  // Restore an autosaved session if one exists; otherwise offer a fresh doc.
  let restored = false;
  try {
    const saved = await autosave.loadAutosave();
    if (saved) {
      restored = await dialogs.confirm('Restore autosaved session?');
      if (restored) {
        await io.loadProjectData(saved);
        await autosave.clearAutosave();
      } else {
        await autosave.clearAutosave();
      }
    }
  } catch (err) {
    console.warn('Autosave restore failed', err);
    restored = false;
  }

  if (!restored) {
    // Start with a fresh document; offer the New Document dialog on first load.
    createDocument(1280, 800, '#ffffff');
    renderer.fitToScreen();
    dialogs.newDocument().then((res) => {
      if (res) {
        createDocument(res.width, res.height, res.background, res.colorSpace);
        renderer.fitToScreen();
      }
    });
  }
}

if (typeof document !== 'undefined') {
  // Test/debug hook: lets e2e smoke tests and the console drive the app internals.
  window.__nms = { state, renderer, history, toolManager, io, autosave, createDocument, dialogs };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
}
