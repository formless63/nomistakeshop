// tests/e2e.smoke.mjs — headless-browser smoke test for nomistakeshop.
// Serves the project statically, drives the real app in headless Chrome via
// puppeteer, and exercises the full smoke checklist from end to end.
//
// Run: node tests/e2e.smoke.mjs   (or: npm run test:e2e)
// Exits 0 when every check passes, 1 otherwise.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Puppeteer resolution: local devDependency (puppeteer-core, CI) first,
// then a global puppeteer install (local dev machines).
function loadPuppeteer() {
  const localRequire = createRequire(path.join(ROOT, 'package.json'));
  try {
    return localRequire('puppeteer-core');
  } catch { /* not installed locally */ }
  const globalRoot = process.env.NPM_GLOBAL_ROOT
    || '/home/wicaso/.nvm/versions/node/v25.8.1/lib/node_modules';
  const globalRequire = createRequire(path.join(globalRoot, 'x.js'));
  return globalRequire('puppeteer');
}
const puppeteer = loadPuppeteer();

// Chrome resolution: CHROME_PATH env (CI) -> newest playwright cache build
// (local dev) -> common system locations.
function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const cache = `${process.env.HOME}/.cache/ms-playwright`;
  try {
    const builds = fs.readdirSync(cache)
      .filter((d) => /^chromium-\d+$/.test(d)).sort().reverse();
    for (const b of builds) {
      for (const sub of ['chrome-linux64/chrome', 'chrome-linux/chrome']) {
        const p = path.join(cache, b, sub);
        if (fs.existsSync(p)) return p;
      }
    }
  } catch { /* no playwright cache */ }
  for (const p of ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('No Chrome/Chromium found — set CHROME_PATH');
}
const CHROME = findChrome();

const PORT = 8123;
const BASE = `http://127.0.0.1:${PORT}`;

// ---------------------------------------------------------------------------
// Result tracking
// ---------------------------------------------------------------------------
const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`PASS  ${name}`);
  } catch (err) {
    results.push({ name, ok: false, err });
    console.log(`FAIL  ${name}\n      ${err && err.message ? err.message.split('\n').slice(0, 12).join('\n      ') : err}`);
  }
}

// ---------------------------------------------------------------------------
// Static server
// ---------------------------------------------------------------------------
function startServer() {
  const proc = spawn('python3', ['-m', 'http.server', String(PORT)], {
    cwd: ROOT,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  proc.stderr.on('data', (d) => { stderr += d; });
  proc.on('exit', (code) => {
    if (code && code !== 0 && !proc.killed) {
      console.error(`[server] exited early with code ${code}: ${stderr.trim()}`);
    }
  });
  return proc;
}

async function waitForServer(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/index.html`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`static server did not come up on port ${PORT}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
let server = null;
let browser = null;

async function main() {
  server = startServer();
  await waitForServer();

  browser = await puppeteer.launch({
    headless: true,
    executablePath: CHROME,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !/favicon/i.test(msg.text())) consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(String(err)));

  // --- helpers -------------------------------------------------------------
  const ev = (fn, arg) => page.evaluate(fn, arg);

  const docToClient = (x, y) => ev(({ x, y }) => {
    const p = window.__nms.renderer.docToScreen(x, y);
    const r = document.getElementById('display-canvas').getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  }, { x, y });

  async function dragDoc(x1, y1, x2, y2, steps = 12) {
    const a = await docToClient(x1, y1);
    const b = await docToClient(x2, y2);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps);
    }
    await page.mouse.up();
  }

  async function clickDoc(x, y) {
    const p = await docToClient(x, y);
    await page.mouse.click(p.x, p.y);
  }

  // Pixel of the ACTIVE layer at doc coords.
  const sampleLayer = (x, y) => ev(({ x, y }) => {
    const doc = window.__nms.state.doc;
    const layer = doc.layers.find((l) => l.id === doc.activeLayerId);
    const d = layer.ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
    return [d[0], d[1], d[2], d[3]];
  }, { x, y });

  // Pixels of the display canvas over a doc-space rect (flattened to rgba rows).
  const displayRect = (x, y, w, h) => ev(({ x, y, w, h }) => {
    const c = document.getElementById('display-canvas');
    const ctx = c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const a = window.__nms.renderer.docToScreen(x, y);
    const b = window.__nms.renderer.docToScreen(x + w, y + h);
    const sx = Math.round(a.x * dpr), sy = Math.round(a.y * dpr);
    const sw = Math.max(1, Math.round((b.x - a.x) * dpr));
    const sh = Math.max(1, Math.round((b.y - a.y) * dpr));
    return Array.from(ctx.getImageData(sx, sy, sw, sh).data);
  }, { x, y, w, h });

  const countDark = (rgba) => {
    let n = 0;
    for (let i = 0; i < rgba.length; i += 4) {
      if (rgba[i] < 80 && rgba[i + 1] < 80 && rgba[i + 2] < 80 && rgba[i + 3] > 200) n++;
    }
    return n;
  };

  // Count dark pixels on the active layer inside a doc-space rect.
  const layerDarkCount = (x, y, w, h) => ev(({ x, y, w, h }) => {
    const doc = window.__nms.state.doc;
    const layer = doc.layers.find((l) => l.id === doc.activeLayerId);
    const d = layer.ctx.getImageData(x, y, w, h).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] < 80 && d[i + 1] < 80 && d[i + 2] < 80 && d[i + 3] > 200) n++;
    }
    return n;
  }, { x, y, w, h });

  async function clickMenu(menuLabel, itemMatch) {
    await ev(({ menuLabel, itemMatch }) => {
      const btn = [...document.querySelectorAll('#menu-bar .menu-button')]
        .find((b) => b.textContent.trim() === menuLabel);
      if (!btn) throw new Error(`menu not found: ${menuLabel}`);
      btn.click();
      const items = [...btn.parentElement.querySelectorAll('.menu-item')];
      const item = items.find((i) => i.textContent.trim().startsWith(itemMatch));
      if (!item) throw new Error(`menu item not found: ${menuLabel} > ${itemMatch}`);
      if (item.classList.contains('disabled')) throw new Error(`menu item disabled: ${itemMatch}`);
      item.click();
    }, { menuLabel, itemMatch });
  }

  // Click a leaf item inside a flyout submenu (e.g. Layer > New Adjustment
  // Layer > Invert). The submenu parent is matched by prefix, the leaf by
  // exact label text.
  async function clickSubMenu(menuLabel, parentMatch, itemText) {
    await ev(({ menuLabel, parentMatch, itemText }) => {
      const btn = [...document.querySelectorAll('#menu-bar .menu-button')]
        .find((b) => b.textContent.trim() === menuLabel);
      if (!btn) throw new Error(`menu not found: ${menuLabel}`);
      btn.click();
      const parent = [...btn.parentElement.querySelectorAll('.menu-item.has-submenu')]
        .find((i) => i.textContent.trim().startsWith(parentMatch));
      if (!parent) throw new Error(`submenu not found: ${menuLabel} > ${parentMatch}`);
      const item = [...parent.querySelectorAll('.menu-submenu .menu-item')]
        .find((i) => i.textContent.trim() === itemText);
      if (!item) throw new Error(`submenu item not found: ${parentMatch} > ${itemText}`);
      item.click();
    }, { menuLabel, parentMatch, itemText });
  }

  // Reset to a clean 1280x800 white document (no selection, black primary).
  const freshDoc = () => ev(() => {
    window.__nms.state.selection = null;
    window.__nms.createDocument(1280, 800, '#ffffff');
    window.__nms.renderer.fitToScreen();
    window.__nms.state.primaryColor = '#000000';
  });

  async function key(code, mods = []) {
    for (const m of mods) await page.keyboard.down(m);
    await page.keyboard.press(code);
    for (const m of [...mods].reverse()) await page.keyboard.up(m);
  }
  const undo = () => key('KeyZ', ['Control']);
  const redo = () => key('KeyZ', ['Control', 'Shift']);

  const waitDialog = () => page.waitForSelector('.dialog-overlay', { visible: true, timeout: 5000 });
  const waitDialogGone = () => page.waitForFunction(
    () => !document.querySelector('.dialog-overlay'), { timeout: 5000 });
  const confirmDialog = async () => {
    await page.click('.dialog-overlay .dialog-button.primary');
    await waitDialogGone();
  };

  // --- load ----------------------------------------------------------------
  // Guarantee a clean autosave state before app scripts run (the boot flow
  // prompts to restore an autosaved session when one exists).
  await page.evaluateOnNewDocument(() => {
    try { indexedDB.deleteDatabase('nomistakeshop'); } catch { /* no IDB */ }
  });
  await page.goto(`${BASE}/index.html`, { waitUntil: 'load' });

  // Check 2: New Document dialog on load -> confirm -> 1280x800, 1 layer.
  await check('2. New Document dialog confirms to 1280x800 / 1 layer', async () => {
    await waitDialog();
    let title = await ev(() => document.querySelector('.dialog-overlay .dialog-title').textContent);
    if (title !== 'New Document') {
      // An autosave restore prompt appeared — decline it and wait for the
      // New Document dialog that follows.
      await page.click('.dialog-overlay .dialog-button:not(.primary)');
      await waitDialog();
      title = await ev(() => document.querySelector('.dialog-overlay .dialog-title').textContent);
    }
    assert.equal(title, 'New Document');
    await confirmDialog();
    const info = await ev(() => ({
      w: window.__nms.state.doc.width,
      h: window.__nms.state.doc.height,
      layers: window.__nms.state.doc.layers.length,
    }));
    assert.deepEqual(info, { w: 1280, h: 800, layers: 1 });
  });

  // Check 3: toolbar has 17 buttons; brush button activates.
  await check('3. Toolbar has 17 buttons; brush activates', async () => {
    const count = await ev(() => document.querySelectorAll('#toolbar .tool-button').length);
    assert.equal(count, 17);
    await ev(() => {
      const btn = [...document.querySelectorAll('#toolbar .tool-button')]
        .find((b) => b.title.startsWith('Brush'));
      btn.click();
    });
    const active = await ev(() => ({
      cls: [...document.querySelectorAll('#toolbar .tool-button')]
        .find((b) => b.title.startsWith('Brush')).classList.contains('active'),
      tool: window.__nms.state.activeTool,
    }));
    assert.ok(active.cls, 'brush button lacks .active class');
    assert.equal(active.tool, 'brush');
  });

  // Check 4: layers panel add/delete via real buttons.
  await check('4. Layers panel: 1 row -> New -> 2 rows -> Delete -> 1 row', async () => {
    const rows = () => ev(() => document.querySelectorAll('#layers-panel .layer-row').length);
    assert.equal(await rows(), 1);
    await ev(() => document.querySelector('#layers-panel button[title="New Layer"]').click());
    await page.waitForFunction(
      () => document.querySelectorAll('#layers-panel .layer-row').length === 2, { timeout: 3000 });
    assert.equal(await ev(() => window.__nms.state.doc.layers.length), 2);
    await ev(() => document.querySelector('#layers-panel button[title="Delete Layer"]').click());
    await page.waitForFunction(
      () => document.querySelectorAll('#layers-panel .layer-row').length === 1, { timeout: 3000 });
    assert.equal(await ev(() => window.__nms.state.doc.layers.length), 1);
  });

  // Check 5: brush stroke leaves dark pixels on the display canvas.
  await check('5. Brush stroke paints dark pixels', async () => {
    await ev(() => {
      window.__nms.history.clear(); // isolate this check's undo stack
      window.__nms.state.primaryColor = '#000000';
    });
    await dragDoc(300, 400, 980, 400);
    const dark = countDark(await displayRect(320, 390, 640, 20));
    assert.ok(dark > 50, `expected dark stroke pixels on display canvas, got ${dark}`);
  });

  // Check 6: Ctrl+Z removes stroke (canUndo false); Ctrl+Shift+Z restores it.
  await check('6. Keyboard undo/redo of the stroke', async () => {
    await undo();
    let dark = countDark(await displayRect(320, 390, 640, 20));
    assert.equal(dark, 0, 'stroke pixels still visible after undo');
    assert.equal(await ev(() => window.__nms.history.canUndo()), false);
    await redo();
    dark = countDark(await displayRect(320, 390, 640, 20));
    assert.ok(dark > 50, 'stroke pixels did not come back after redo');
  });

  // Check 7: fill tool via 'g' + click; undo via Edit menu.
  await check('7. Fill tool fills layer; Edit > Undo reverts', async () => {
    await undo(); // drop the redone stroke -> white canvas
    await ev(() => window.__nms.history.clear());
    await key('KeyG');
    assert.equal(await ev(() => window.__nms.state.activeTool), 'fill');
    await clickDoc(200, 200);
    assert.deepEqual((await sampleLayer(200, 200)).slice(0, 3), [0, 0, 0], 'fill did not paint black');
    await clickMenu('Edit', 'Undo');
    assert.deepEqual((await sampleLayer(200, 200)).slice(0, 3), [255, 255, 255], 'undo did not restore white');
  });

  // Check 8: Filter > Invert via real menus; undo.
  await check('8. Filter > Invert inverts layer; undo reverts', async () => {
    await clickMenu('Filter', 'Invert');
    assert.deepEqual((await sampleLayer(100, 100)).slice(0, 3), [0, 0, 0], 'invert did not turn white to black');
    await undo();
    assert.deepEqual((await sampleLayer(100, 100)).slice(0, 3), [255, 255, 255], 'undo of invert failed');
  });

  // Check 9: rect select + Image > Crop to Selection.
  await check('9. Rect select + Crop to Selection shrinks doc', async () => {
    await key('KeyM');
    assert.equal(await ev(() => window.__nms.state.activeTool), 'selectRect');
    await dragDoc(400, 300, 600, 450);
    const sel = await ev(() => window.__nms.state.selection);
    assert.ok(sel && sel.type === 'rect', 'no rect selection after drag');
    assert.ok(Math.abs(sel.x - 400) <= 2 && Math.abs(sel.y - 300) <= 2, `bad selection origin ${sel.x},${sel.y}`);
    assert.ok(Math.abs(sel.w - 200) <= 2 && Math.abs(sel.h - 150) <= 2, `bad selection size ${sel.w}x${sel.h}`);
    await clickMenu('Image', 'Crop to Selection');
    const size = await ev(() => ({ w: window.__nms.state.doc.width, h: window.__nms.state.doc.height }));
    assert.ok(Math.abs(size.w - 200) <= 2 && Math.abs(size.h - 150) <= 2, `doc is ${size.w}x${size.h}, expected ~200x150`);
    await undo();
    const restored = await ev(() => ({ w: window.__nms.state.doc.width, h: window.__nms.state.doc.height }));
    assert.deepEqual(restored, { w: 1280, h: 800 }, 'undo did not restore 1280x800');
    await key('KeyD', ['Control']); // deselect stale selection
  });

  // Check 10: Brightness param dialog — confirm changes pixels, Esc does not.
  await check('10. Brightness… dialog: confirm applies, Esc cancels', async () => {
    const before = await sampleLayer(100, 100);
    await clickMenu('Filter', 'Brightness');
    await waitDialog();
    await ev(() => {
      const s = document.querySelector('.dialog-overlay input[type="range"]');
      s.value = '-50';
      s.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await confirmDialog();
    const after = await sampleLayer(100, 100);
    assert.ok(after[0] < before[0] - 30, `brightness not applied: ${before[0]} -> ${after[0]}`);
    // Cancel path: reopen, move slider, Esc -> no change.
    await clickMenu('Filter', 'Brightness');
    await waitDialog();
    await ev(() => {
      const s = document.querySelector('.dialog-overlay input[type="range"]');
      s.value = '90';
      s.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.keyboard.press('Escape');
    await waitDialogGone();
    const afterCancel = await sampleLayer(100, 100);
    assert.deepEqual(afterCancel, after, 'cancelled brightness changed pixels');
  });

  // Check 11: text tool dialog draws pixels.
  await check('11. Text tool draws typed text', async () => {
    await undo(); // revert the applied brightness -> white canvas
    await ev(() => { window.__nms.history.clear(); window.__nms.state.primaryColor = '#000000'; });
    await key('KeyT');
    assert.equal(await ev(() => window.__nms.state.activeTool), 'text');
    await clickDoc(150, 150);
    await waitDialog();
    await page.keyboard.type('Hi');
    await page.keyboard.press('Enter');
    await waitDialogGone();
    const dark = await layerDarkCount(140, 140, 300, 100);
    assert.ok(dark > 0, 'no dark pixels near text click point');
  });

  // Check 12: project save/load round trip.
  await check('12. Project save/load round trip', async () => {
    const json = await ev(async () => {
      let href = null;
      const orig = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () { href = this.href; };
      try {
        await window.__nms.io.saveProject();
      } finally {
        HTMLAnchorElement.prototype.click = orig;
      }
      if (!href) throw new Error('saveProject did not trigger an anchor download');
      return (await fetch(href)).text();
    });
    const proj = JSON.parse(json);
    assert.equal(proj.version, 1);
    assert.ok(Array.isArray(proj.layers) && proj.layers.length >= 1, 'project has no layers');
    // Dirty the doc, then reload the saved JSON.
    await key('KeyB');
    await dragDoc(300, 500, 900, 500);
    assert.ok((await layerDarkCount(400, 490, 400, 20)) > 0, 'stroke missing before load');
    await ev(async (payload) => {
      await window.__nms.io.loadProjectFile(new File([payload], 'x.nmsproject', { type: 'application/json' }));
    }, json);
    const after = await ev(() => ({
      layers: window.__nms.state.doc.layers.length,
      w: window.__nms.state.doc.width,
      h: window.__nms.state.doc.height,
    }));
    assert.equal(after.layers, proj.layers.length, 'layer count mismatch after load');
    assert.equal(after.w, proj.width);
    assert.equal(after.h, proj.height);
    assert.equal(await layerDarkCount(400, 490, 400, 20), 0, 'stroke still present after project load');
  });

  // Check 13: zoom to 200% reflected in the status bar.
  await check('13. setZoom(2) shows 200% in status bar', async () => {
    await ev(() => window.__nms.renderer.setZoom(2));
    const text = await ev(() => document.querySelector('#status-bar .status-zoom').textContent);
    assert.equal(text.trim(), '200%');
    await ev(() => window.__nms.renderer.fitToScreen());
  });

  // Check 14: deep undo/redo chain (new layer, stroke, fill).
  await check('14. Undo 3x restores blank doc; redo 3x reapplies', async () => {
    await ev(() => { window.__nms.history.clear(); window.__nms.state.primaryColor = '#000000'; });
    await ev(() => document.querySelector('#layers-panel button[title="New Layer"]').click());
    await key('KeyB');
    await dragDoc(300, 400, 700, 400);
    await key('KeyG');
    await clickDoc(100, 100); // fills the (transparent) new layer black
    assert.equal(await ev(() => window.__nms.state.doc.layers.length), 2);
    assert.deepEqual((await sampleLayer(100, 100)).slice(0, 3), [0, 0, 0]);
    await undo(); await undo(); await undo();
    const blank = await ev(() => window.__nms.state.doc.layers.length);
    assert.equal(blank, 1, 'expected 1 layer after 3 undos');
    assert.deepEqual((await sampleLayer(400, 400)).slice(0, 3), [255, 255, 255], 'layer not white after undos');
    assert.equal(await ev(() => window.__nms.history.canUndo()), false);
    await redo(); await redo(); await redo();
    assert.equal(await ev(() => window.__nms.state.doc.layers.length), 2, 'expected 2 layers after 3 redos');
    assert.deepEqual((await sampleLayer(100, 100)).slice(0, 3), [0, 0, 0], 'fill not restored after redos');
  });

  // Check 15: layer mask — painting black into the mask hides stroke pixels.
  await check('15. Layer mask: black paint hides pixels; undo restores', async () => {
    await freshDoc();
    await key('KeyB');
    await dragDoc(300, 400, 700, 400); // black stroke on the white Background
    let dark = countDark(await displayRect(300, 390, 400, 20));
    assert.ok(dark > 50, `stroke missing before mask: ${dark} dark px`);
    await clickMenu('Layer', 'Add Layer Mask (White)');
    const hasMaskThumb = await ev(() => !!document.querySelector('#layers-panel .mask-thumb'));
    assert.ok(hasMaskThumb, 'no mask thumbnail in the layers panel');
    // Click the mask thumbnail to target the mask, then paint black over the stroke.
    await ev(() => document.querySelector('#layers-panel .mask-thumb').click());
    assert.equal(await ev(() => window.__nms.state.activeTarget), 'mask');
    await dragDoc(300, 400, 700, 400); // black into the mask -> hide the stroke
    dark = countDark(await displayRect(300, 390, 400, 20));
    assert.ok(dark <= 5, `masked stroke still visible: ${dark} dark px`);
    await undo(); // undo the mask paint stroke
    dark = countDark(await displayRect(300, 390, 400, 20));
    assert.ok(dark > 50, `undo did not bring the stroke back: ${dark} dark px`);
  });

  // Check 16: adjustment layer (Invert) recolors the composite; undo reverts.
  await check('16. Adjustment layer Invert darkens composite; undo reverts', async () => {
    await freshDoc();
    const darkNow = async () => countDark(await displayRect(100, 100, 200, 200));
    assert.equal(await darkNow(), 0, 'fresh doc is not white');
    await clickSubMenu('Layer', 'New Adjustment Layer', 'Invert');
    assert.ok((await darkNow()) > 5000, 'invert adjustment did not darken the composite');
    const hasIcon = await ev(() => {
      const icon = document.querySelector('#layers-panel .layer-adjust-icon');
      return !!icon && icon.textContent.includes('◐');
    });
    assert.ok(hasIcon, 'adjustment layer row lacks the ◐ icon');
    await undo();
    assert.equal(await darkNow(), 0, 'undo did not remove the invert effect');
    // Re-add (dialog-free path) — composite must go black again.
    await clickSubMenu('Layer', 'New Adjustment Layer', 'Invert');
    assert.ok((await darkNow()) > 5000, 're-added adjustment did not darken the composite');
  });

  // Check 17: magic wand selects the uniform canvas; Ctrl+D clears.
  await check('17. Magic wand selects whole uniform doc; Ctrl+D clears', async () => {
    await freshDoc();
    await key('KeyW');
    assert.equal(await ev(() => window.__nms.state.activeTool), 'wand');
    await clickDoc(640, 400);
    const info = await ev(() => {
      const sel = window.__nms.state.selection;
      if (!sel || sel.type !== 'mask') return { type: sel && sel.type, frac: 0 };
      const d = sel.mask.getContext('2d').getImageData(0, 0, sel.mask.width, sel.mask.height).data;
      let on = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) on++;
      return { type: sel.type, frac: on / (sel.mask.width * sel.mask.height) };
    });
    assert.equal(info.type, 'mask', 'wand did not produce a mask selection');
    assert.ok(info.frac > 0.99, `wand selected only ${(info.frac * 100).toFixed(1)}% of the doc`);
    await key('KeyD', ['Control']);
    assert.equal(await ev(() => window.__nms.state.selection), null, 'Ctrl+D did not deselect');
  });

  // Check 18: clone stamp duplicates a dot at the drag location.
  await check('18. Clone stamp copies the dot to the drag location', async () => {
    // Doc is fresh white from check 17; primary is black.
    await key('KeyB');
    await clickDoc(400, 400); // source dot
    assert.ok((await layerDarkCount(390, 390, 20, 20)) > 0, 'source dot missing');
    await key('KeyS');
    assert.equal(await ev(() => window.__nms.state.activeTool), 'clone');
    await page.keyboard.down('Alt');
    await clickDoc(400, 400); // record the clone source on the dot
    await page.keyboard.up('Alt');
    await dragDoc(600, 600, 760, 600); // stamp: source + (pt - strokeStart)
    assert.ok((await layerDarkCount(585, 585, 30, 30)) > 0, 'no cloned dot at the drag location');
    assert.ok((await layerDarkCount(390, 390, 20, 20)) > 0, 'source dot was destroyed');
  });

  // Check 19: cut/copy/paste internal round trip via keyboard shortcuts.
  await check('19. Cut/Copy/Paste internal round trip', async () => {
    await freshDoc();
    await key('KeyB');
    await dragDoc(300, 600, 500, 600); // black stroke
    await key('KeyM');
    await dragDoc(280, 580, 520, 620); // rect select around the stroke
    await key('KeyC', ['Control']);
    await page.waitForFunction(
      () => import('/js/io/clipboard.js').then((m) => m.hasClipboard()),
      { timeout: 5000 },
    );
    await key('KeyX', ['Control']);
    await page.waitForFunction(() => {
      const doc = window.__nms.state.doc;
      const layer = doc.layers.find((l) => l.id === doc.activeLayerId);
      return layer.ctx.getImageData(400, 600, 1, 1).data[3] === 0;
    }, { timeout: 5000 });
    await key('KeyV', ['Control']);
    await page.waitForFunction(
      () => window.__nms.state.doc.layers.length === 2, { timeout: 5000 });
    const pasted = await ev(() => {
      const doc = window.__nms.state.doc;
      const layer = doc.layers.find((l) => l.id === doc.activeLayerId);
      const d = layer.ctx.getImageData(0, 0, doc.width, doc.height).data;
      let dark = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] < 80 && d[i + 1] < 80 && d[i + 2] < 80 && d[i + 3] > 200) dark++;
      }
      return { name: layer.name, dark };
    });
    assert.equal(pasted.name, 'Pasted', 'pasted layer is not named/active "Pasted"');
    assert.ok(pasted.dark > 50, `pasted layer has only ${pasted.dark} dark px`);
  });

  // Check 20: WebP export produces an image/webp blob.
  await check('20. WebP export produces an image/webp blob', async () => {
    const type = await ev(async () => {
      let href = null;
      const orig = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () { href = this.href; };
      try {
        await window.__nms.io.exportImage('webp');
      } finally {
        HTMLAnchorElement.prototype.click = orig;
      }
      if (!href) throw new Error('exportImage did not trigger an anchor download');
      const blob = await (await fetch(href)).blob();
      return blob.type;
    });
    assert.equal(type, 'image/webp');
  });

  // Check 21: Levels via the Filter menu — identity keeps pixels; inBlack=128
  // clips a painted mid-gray to black.
  await check('21. Levels dialog: identity no-op; inBlack=128 clips gray', async () => {
    await freshDoc();
    await ev(() => { window.__nms.state.primaryColor = '#808080'; });
    await key('KeyB');
    await clickDoc(640, 400);
    const before = await sampleLayer(640, 400);
    assert.ok(Math.abs(before[0] - 128) <= 8, `expected mid-gray dab, got ${before[0]}`);
    await clickMenu('Filter', 'Levels');
    await waitDialog();
    const sliders = await ev(() => document.querySelectorAll('.dialog-overlay input[type="range"]').length);
    assert.equal(sliders, 5, `expected 5 levels sliders, got ${sliders}`);
    await confirmDialog();
    assert.deepEqual(await sampleLayer(640, 400), before, 'identity levels changed pixels');
    await clickMenu('Filter', 'Levels');
    await waitDialog();
    await ev(() => {
      const s = document.querySelector('.dialog-overlay input[type="range"]'); // first row = inBlack
      s.value = '128';
      s.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await confirmDialog();
    const after = await sampleLayer(640, 400);
    assert.ok(after[0] <= 8, `inBlack=128 did not clip gray to black: ${after[0]}`);
  });

  // Check 22: autosave data path — serializeProject captures the stroke,
  // loadProjectData restores it; loadAutosave() resolves on a fresh profile.
  await check('22. serializeProject/loadProjectData round trip; loadAutosave resolves', async () => {
    await freshDoc();
    const blank = await ev(() => window.__nms.io.serializeProject());
    await key('KeyB');
    await dragDoc(300, 600, 700, 600);
    const withStroke = await ev(() => window.__nms.io.serializeProject());
    assert.notEqual(withStroke.layers[0].png, blank.layers[0].png, 'serializeProject missed the stroke');
    // Dirty the doc (fill it black), then restore from the serialized data.
    await key('KeyG');
    await clickDoc(100, 100);
    assert.deepEqual((await sampleLayer(100, 100)).slice(0, 3), [0, 0, 0], 'fill missing before load');
    const ok = await ev(async (data) => window.__nms.io.loadProjectData(data), withStroke);
    assert.equal(ok, true, 'loadProjectData rejected its own serializeProject output');
    const after = await ev(() => ({
      layers: window.__nms.state.doc.layers.length,
      w: window.__nms.state.doc.width,
      h: window.__nms.state.doc.height,
    }));
    assert.deepEqual(after, { layers: 1, w: 1280, h: 800 }, 'doc shape mismatch after load');
    assert.deepEqual((await sampleLayer(500, 600)).slice(0, 3), [0, 0, 0], 'stroke pixel not restored');
    assert.deepEqual((await sampleLayer(100, 100)).slice(0, 3), [255, 255, 255], 'fill not reverted by load');
    const autosaved = await ev(() => window.__nms.autosave.loadAutosave());
    assert.ok(autosaved === null || autosaved.version === 1, 'loadAutosave returned an unexpected value');
  });

  // Check 23: history panel rows drive history.jumpTo both directions.
  await check('23. History panel: rows render; clicking jumps history', async () => {
    await freshDoc();
    assert.ok(await ev(() => !!document.getElementById('history-panel')), '#history-panel missing');
    await ev(() => document.querySelector('#layers-panel button[title="New Layer"]').click());
    await key('KeyB');
    await dragDoc(300, 300, 600, 300); // stroke B
    await dragDoc(300, 500, 600, 500); // stroke C
    const rows = await ev(() =>
      [...document.querySelectorAll('#history-panel .history-row')].map((r) => r.textContent));
    assert.equal(rows.length, 3, `expected 3 history rows, got ${rows.length}: ${rows.join(',')}`);
    assert.equal(rows[0], 'New Layer', `unexpected oldest row: ${rows[0]}`);
    // Click the newest row -> exactly 2 undos remain (stroke C undone).
    await ev(() => {
      const rs = document.querySelectorAll('#history-panel .history-row');
      rs[rs.length - 1].click();
    });
    assert.ok((await layerDarkCount(300, 290, 300, 20)) > 0, 'stroke B missing after jump');
    assert.equal(await layerDarkCount(300, 490, 300, 20), 0, 'stroke C still present after jump');
    // Click the oldest row -> jumpTo(0): everything undone, 1 layer left.
    await ev(() => document.querySelector('#history-panel .history-row').click());
    assert.equal(await ev(() => window.__nms.state.doc.layers.length), 1, 'jumpTo(0) did not restore 1 layer');
  });

  // Check 24: Shift+M ellipse select; Select > Invert; Select > Feather….
  await check('24. Ellipse select + Invert + Feather', async () => {
    await freshDoc();
    await key('KeyM', ['Shift']);
    assert.equal(await ev(() => window.__nms.state.activeTool), 'selectEllipse');
    await dragDoc(300, 300, 520, 440);
    const sel = await ev(() => window.__nms.state.selection);
    assert.ok(sel && sel.type === 'ellipse', `expected ellipse selection, got ${sel && sel.type}`);
    await clickMenu('Select', 'Invert');
    assert.equal((await ev(() => window.__nms.state.selection)).invert, true, 'invert flag not set');
    await clickMenu('Select', 'Feather');
    await waitDialog();
    await ev(() => {
      const input = document.querySelector('.dialog-overlay input[type="number"]');
      input.value = '10';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await confirmDialog();
    assert.equal((await ev(() => window.__nms.state.selection)).feather, 10, 'feather not applied');
  });

  // Check 25: PSD import — 2 layers with names/blend modes; the multiply
  // composite renders dark purple ((200,30,30) x (30,30,200) -> ~(24,4,24)).
  await check('25. PSD import: layers, multiply blend, dark composite', async () => {
    const info = await ev(async () => {
      const buf = await (await fetch('/tests/fixtures/two-layer.psd')).arrayBuffer();
      const m = await import('/js/io/psd.js');
      await m.openPsdFile(new File([buf], 'two-layer.psd'));
      const doc = window.__nms.state.doc;
      return {
        w: doc.width,
        h: doc.height,
        layers: doc.layers.map((l) => ({ name: l.name, blendMode: l.blendMode })),
      };
    });
    assert.deepEqual({ w: info.w, h: info.h }, { w: 8, h: 8 }, 'PSD doc size mismatch');
    assert.equal(info.layers.length, 2, `expected 2 layers, got ${info.layers.length}`);
    assert.equal(info.layers[0].name, 'Bottom Red', `bottom layer: ${info.layers[0].name}`);
    assert.equal(info.layers[1].name, 'Top Multiply Blue', `top layer: ${info.layers[1].name}`);
    assert.equal(info.layers[1].blendMode, 'multiply', `top blendMode: ${info.layers[1].blendMode}`);
    const px = await displayRect(0, 0, 8, 8);
    let n = 0; let r = 0; let g = 0; let b = 0;
    for (let i = 0; i < px.length; i += 4) {
      r += px[i]; g += px[i + 1]; b += px[i + 2]; n++;
    }
    r /= n; g /= n; b /= n;
    assert.ok(r > 5 && r < 60, `composite red ${r.toFixed(1)} not multiply-dark`);
    assert.ok(g < 30, `composite green ${g.toFixed(1)} too high for multiply`);
    assert.ok(b > 5 && b < 60, `composite blue ${b.toFixed(1)} not multiply-dark`);
    assert.ok(Math.abs(r - b) < 20, `composite r/b imbalance: ${r.toFixed(1)} vs ${b.toFixed(1)}`);
  });

  // Check 26: PSD export round trip — readPsd (in page context) sees the same
  // layer stack that was imported in check 25.
  await check('26. PSD export round trip preserves the layer stack', async () => {
    const names = await ev(async () => {
      let href = null;
      const orig = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () { href = this.href; };
      try {
        await (await import('/js/io/psd.js')).exportPsd();
      } finally {
        HTMLAnchorElement.prototype.click = orig;
      }
      if (!href) throw new Error('exportPsd did not trigger an anchor download');
      const buf = await (await fetch(href)).arrayBuffer();
      const { readPsd } = await import('/vendor/ag-psd/index.js');
      const back = readPsd(buf);
      return (back.children || []).map((c) => c.name);
    });
    assert.deepEqual(names, ['Bottom Red', 'Top Multiply Blue']);
  });

  // Check 27: Content-Aware Fill removes a black dot. The first call
  // lazy-loads the multi-MB OpenCV runtime — generous 90s budget.
  await check('27. Content-Aware Fill via Edit menu removes the dot', async () => {
    await freshDoc();
    await key('KeyB');
    await clickDoc(640, 400); // black dot
    assert.ok((await sampleLayer(640, 400))[0] < 80, 'dot missing before fill');
    await key('KeyM');
    await dragDoc(600, 360, 680, 440); // rect select around the dot
    assert.ok(await ev(() => window.__nms.state.selection), 'no selection before fill');
    await clickMenu('Edit', 'Content-Aware Fill');
    await page.waitForFunction(() => {
      const doc = window.__nms.state.doc;
      const layer = doc.layers.find((l) => l.id === doc.activeLayerId);
      if (!layer || !layer.ctx) return false;
      const d = layer.ctx.getImageData(640, 400, 1, 1).data;
      return d[0] > 200 && d[1] > 200 && d[2] > 200;
    }, { timeout: 90000, polling: 1000 });
    const after = await sampleLayer(640, 400);
    assert.ok(after[0] > 200 && after[1] > 200 && after[2] > 200,
      `dot still present after fill: ${after.slice(0, 3)}`);
  });

  // Check 28: HEIC routing — garbage bytes route to the HEIC decoder and fail
  // gracefully via status:message, with no uncaught exception.
  await check('28. .heic routes to HEIC decoder and fails gracefully', async () => {
    const res = await ev(async () => {
      const stateMod = await import('/js/core/state.js');
      const msgs = [];
      const off = stateMod.on('status:message', (p) => msgs.push(p.text));
      let threw = null;
      try {
        const m = await import('/js/io/formats.js');
        await m.openByExtension(
          new File([new Uint8Array([0, 1, 2, 3])], 'x.heic', { type: 'image/heic' }), true);
      } catch (err) {
        threw = String(err);
      } finally {
        off();
      }
      return { msgs, threw };
    });
    assert.equal(res.threw, null, `openByExtension threw: ${res.threw}`);
    assert.ok(res.msgs.some((t) => /Decoding HEIC/.test(t)),
      `no 'Decoding HEIC' status: ${JSON.stringify(res.msgs)}`);
    assert.ok(res.msgs.some((t) => /Could not decode HEIC/.test(t)),
      `no graceful failure status: ${JSON.stringify(res.msgs)}`);
  });

  // Check 29: RAW routing — same pattern with a .dng of garbage bytes.
  await check('29. .dng routes to RAW decoder and fails gracefully', async () => {
    const res = await ev(async () => {
      const stateMod = await import('/js/core/state.js');
      const msgs = [];
      const off = stateMod.on('status:message', (p) => msgs.push(p.text));
      let threw = null;
      try {
        const m = await import('/js/io/formats.js');
        await m.openByExtension(
          new File([new Uint8Array([0, 1, 2, 3])], 'x.dng', { type: 'image/x-adobe-dng' }), true);
      } catch (err) {
        threw = String(err);
      } finally {
        off();
      }
      return { msgs, threw };
    });
    assert.equal(res.threw, null, `openByExtension threw: ${res.threw}`);
    assert.ok(res.msgs.some((t) => /Decoding RAW/.test(t)),
      `no 'Decoding RAW' status: ${JSON.stringify(res.msgs)}`);
    assert.ok(res.msgs.some((t) => /Could not decode RAW file/.test(t)),
      `no graceful failure status: ${JSON.stringify(res.msgs)}`);
  });

  // Check 30: mobile 390x844 on a second page — drawer starts off-screen,
  // the toggle opens it, a viewport tap closes it, and a stroke still paints.
  await check('30. Mobile 390x844: drawer toggle, tap-close, stroke paints', async () => {
    const mpage = await browser.newPage();
    try {
      await mpage.setViewport({ width: 390, height: 844 });
      mpage.on('console', (msg) => {
        if (msg.type() === 'error' && !/favicon/i.test(msg.text())) consoleErrors.push(msg.text());
      });
      mpage.on('pageerror', (err) => pageErrors.push(String(err)));
      await mpage.goto(`${BASE}/index.html`, { waitUntil: 'load' });
      // Dismiss the New Document dialog (declining an autosave prompt first).
      await mpage.waitForSelector('.dialog-overlay', { visible: true, timeout: 5000 });
      const title = await mpage.evaluate(() =>
        document.querySelector('.dialog-overlay .dialog-title').textContent);
      if (title !== 'New Document') {
        await mpage.click('.dialog-overlay .dialog-button:not(.primary)');
        await mpage.waitForSelector('.dialog-overlay', { visible: true, timeout: 5000 });
      }
      await mpage.click('.dialog-overlay .dialog-button.primary');
      await mpage.waitForFunction(
        () => !document.querySelector('.dialog-overlay'), { timeout: 5000 });

      const panelBox = () => mpage.evaluate(() => {
        const r = document.getElementById('side-panel').getBoundingClientRect();
        return { left: r.left, right: r.right };
      });
      const settle = () => new Promise((r) => setTimeout(r, 450)); // 0.25s CSS transition

      let box = await panelBox();
      assert.ok(box.left >= 389, `side panel not hidden off-screen: left=${box.left}`);

      await mpage.click('.mobile-panel-toggle');
      await settle();
      box = await panelBox();
      assert.ok(box.left >= 0 && box.right <= 392,
        `open drawer not within viewport: ${JSON.stringify(box)}`);

      // Tapping the visible sliver of the viewport (left of the open drawer;
      // the backdrop receives the tap there) closes it again.
      const vp = await mpage.evaluate(() => {
        const r = document.getElementById('viewport').getBoundingClientRect();
        return { x: r.left + 12, y: r.top + r.height / 2 };
      });
      await mpage.mouse.click(vp.x, vp.y);
      await settle();
      box = await panelBox();
      assert.ok(box.left >= 389, `tap did not close the drawer: left=${box.left}`);

      // A mouse-drawn brush stroke must still land dark pixels on the layer.
      const pt = (x, y) => mpage.evaluate(({ x, y }) => {
        const p = window.__nms.renderer.docToScreen(x, y);
        const r = document.getElementById('display-canvas').getBoundingClientRect();
        return { x: r.left + p.x, y: r.top + p.y };
      }, { x, y });
      const a = await pt(200, 400);
      const bpt = await pt(1000, 400);
      await mpage.mouse.move(a.x, a.y);
      await mpage.mouse.down();
      for (let i = 1; i <= 10; i++) {
        await mpage.mouse.move(a.x + ((bpt.x - a.x) * i) / 10, a.y + ((bpt.y - a.y) * i) / 10);
      }
      await mpage.mouse.up();
      const dark = await mpage.evaluate(() => {
        const doc = window.__nms.state.doc;
        const layer = doc.layers.find((l) => l.id === doc.activeLayerId);
        const d = layer.ctx.getImageData(200, 395, 800, 10).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i] < 80 && d[i + 1] < 80 && d[i + 2] < 80 && d[i + 3] > 200) n++;
        }
        return n;
      });
      assert.ok(dark > 50, `mobile stroke left only ${dark} dark px`);
    } finally {
      await mpage.close().catch(() => {});
      await page.bringToFront().catch(() => {});
    }
  });

  // Check 31: Display-P3 document — colorSpace on the doc and the layer ctx,
  // and it survives a paint + undo cycle.
  await check('31. Display-P3 doc: colorSpace on doc + ctx, survives undo', async () => {
    await ev(() => {
      window.__nms.createDocument(64, 64, '#ffffff', 'display-p3');
      window.__nms.renderer.fitToScreen();
      window.__nms.state.primaryColor = '#000000';
    });
    assert.equal(await ev(() => window.__nms.state.doc.colorSpace), 'display-p3');
    const ctxCs = await ev(() => {
      const doc = window.__nms.state.doc;
      const layer = doc.layers.find((l) => l.id === doc.activeLayerId);
      return layer.ctx.getContextAttributes().colorSpace;
    });
    assert.equal(ctxCs, 'display-p3', `layer ctx colorSpace is ${ctxCs}`);
    await key('KeyB');
    await clickDoc(32, 32);
    assert.ok((await sampleLayer(32, 32))[0] < 80, 'P3 stroke did not paint');
    await ev(() => window.__nms.history.undo());
    assert.equal(await ev(() => window.__nms.state.doc.colorSpace), 'display-p3',
      'doc colorSpace lost after undo');
    await freshDoc(); // back to srgb 1280x800 for cleanliness
  });

  // Check 32: Image menu > Image Info… — modal lists dimensions and color
  // space; Esc closes it.
  await check('32. Image Info dialog shows 1280x800 / sRGB; Esc closes', async () => {
    await clickMenu('Image', 'Image Info');
    await waitDialog();
    const text = await ev(() => document.querySelector('.dialog-overlay').textContent);
    assert.ok(text.includes('1280'), `dialog lacks width: ${text.slice(0, 200)}`);
    assert.ok(text.includes('800'), `dialog lacks height: ${text.slice(0, 200)}`);
    assert.ok(text.includes('sRGB'), `dialog lacks color space: ${text.slice(0, 200)}`);
    await page.keyboard.press('Escape');
    await waitDialogGone();
  });

  // Check 33: Extract Palette to Swatches — red/blue halves yield reddish and
  // bluish swatches; clicking the reddish one sets primaryColor.
  await check('33. Extract Palette: red+blue swatches; click sets primary', async () => {
    await freshDoc();
    await ev(() => {
      const doc = window.__nms.state.doc;
      const layer = doc.layers.find((l) => l.id === doc.activeLayerId);
      layer.ctx.fillStyle = '#ff0000';
      layer.ctx.fillRect(0, 0, 640, 800);
      layer.ctx.fillStyle = '#0000ff';
      layer.ctx.fillRect(640, 0, 640, 800);
    });
    await clickMenu('Image', 'Extract Palette to Swatches');
    await page.waitForFunction(
      () => document.querySelectorAll('#color-panel .color-presets .color-preset').length >= 2,
      { timeout: 15000 },
    );
    const swatches = await ev(() =>
      [...document.querySelectorAll('#color-panel .color-presets .color-preset')].map((s, i) => {
        const m = getComputedStyle(s).backgroundColor.match(/\d+/g).map(Number);
        return { i, r: m[0], g: m[1], b: m[2] };
      }));
    const reddish = swatches.find((s) => s.r > 150 && s.g < 100 && s.b < 100);
    const bluish = swatches.find((s) => s.b > 150 && s.r < 100);
    assert.ok(reddish, `no reddish swatch in ${JSON.stringify(swatches)}`);
    assert.ok(bluish, `no bluish swatch in ${JSON.stringify(swatches)}`);
    await ev((i) => {
      document.querySelectorAll('#color-panel .color-presets .color-preset')[i].click();
    }, reddish.i);
    const primary = await ev(() => window.__nms.state.primaryColor);
    const pm = primary.match(/\w\w/g).map((h) => parseInt(h, 16));
    assert.ok(pm[0] > 150 && pm[1] < 100 && pm[2] < 100,
      `primaryColor not reddish after swatch click: ${primary}`);
  });

  // Check 34: File > Export Optimized PNG — captured blob is a decodable PNG
  // at doc dimensions, smaller than a plain toBlob PNG of the same flatten.
  await check('34. Export Optimized PNG: valid PNG, smaller than plain', async () => {
    // High-entropy content so 256-color quantization genuinely wins.
    await ev(() => {
      const doc = window.__nms.state.doc;
      const layer = doc.layers.find((l) => l.id === doc.activeLayerId);
      for (let i = 0; i < 6000; i++) {
        layer.ctx.fillStyle = `rgb(${(i * 73) % 256},${(i * 151) % 256},${(i * 211) % 256})`;
        layer.ctx.fillRect((i * 37) % 1272, (i * 91) % 792, 8, 8);
      }
    });
    await ev(() => {
      window.__capHref = null;
      HTMLAnchorElement.prototype.__origClick = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () { window.__capHref = this.href; };
    });
    try {
      await clickMenu('File', 'Export Optimized PNG');
      await page.waitForFunction(() => !!window.__capHref, { timeout: 30000 });
    } finally {
      await ev(() => {
        HTMLAnchorElement.prototype.click = HTMLAnchorElement.prototype.__origClick;
        delete HTMLAnchorElement.prototype.__origClick;
      });
    }
    const info = await ev(async () => {
      const blob = await (await fetch(window.__capHref)).blob();
      const bmp = await createImageBitmap(blob);
      const { flattenImage } = await import('/js/core/document.js');
      const plain = await new Promise((r) => flattenImage().toBlob(r, 'image/png'));
      return { type: blob.type, size: blob.size, w: bmp.width, h: bmp.height, plainSize: plain.size };
    });
    assert.equal(info.type, 'image/png', `bad blob type: ${info.type}`);
    assert.deepEqual({ w: info.w, h: info.h }, { w: 1280, h: 800 }, 'decoded PNG size mismatch');
    assert.ok(info.size < info.plainSize,
      `optimized ${info.size} not smaller than plain ${info.plainSize}`);
  });

  // Check 35: AI Upscale ×2 twice on a tiny 48x32 doc (SwiftShader WebGL is
  // far too slow at 1280px) — 96x64 with real content and edge blending,
  // then 192x128 (shared Upscaler instance reuse). 240s budget per pass.
  await check('35. AI Upscale ×2 twice: 48x32 -> 96x64 -> 192x128', async () => {
    await ev(() => {
      window.__nms.createDocument(48, 32, '#ffffff');
      window.__nms.renderer.fitToScreen();
      const doc = window.__nms.state.doc;
      const layer = doc.layers.find((l) => l.id === doc.activeLayerId);
      for (let x = 0; x < 48; x += 8) {
        layer.ctx.fillStyle = (x / 8) % 2 === 0 ? '#ff0000' : '#0000ff';
        layer.ctx.fillRect(x, 0, 8, 32);
      }
    });
    const waitWidth = (w) => page.waitForFunction((target) => {
      const doc = window.__nms.state.doc;
      const layer = doc && doc.layers.find((l) => l.id === doc.activeLayerId);
      return !!layer && layer.canvas.width === target;
    }, { timeout: 240000, polling: 1000 }, w);

    await ev(() => {
      import('/js/ops/upscale.js').then((m) => m.upscaleActiveLayer(2));
    });
    await waitWidth(96);

    const stats = await ev(() => {
      const doc = window.__nms.state.doc;
      const layer = doc.layers.find((l) => l.id === doc.activeLayerId);
      const d = layer.ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height).data;
      let red = 0; let blue = 0; let mixed = 0;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i]; const g = d[i + 1]; const b = d[i + 2]; const a = d[i + 3];
        if (a < 200) continue;
        if (r > 200 && g < 80 && b < 80) red++;
        else if (b > 200 && r < 80 && g < 80) blue++;
        else if (r > 60 && b > 60) mixed++;
      }
      return { w: layer.canvas.width, h: layer.canvas.height, red, blue, mixed };
    });
    assert.deepEqual({ w: stats.w, h: stats.h }, { w: 96, h: 64 }, 'first upscale size mismatch');
    assert.ok(stats.red > 100, `red content lost: ${stats.red} red px`);
    assert.ok(stats.blue > 100, `blue content lost: ${stats.blue} blue px`);
    assert.ok(stats.mixed > 0, 'no intermediate values at the stripe edges');

    await ev(() => {
      import('/js/ops/upscale.js').then((m) => m.upscaleActiveLayer(2));
    });
    await waitWidth(192);
    const size2 = await ev(() => {
      const doc = window.__nms.state.doc;
      const layer = doc.layers.find((l) => l.id === doc.activeLayerId);
      return { w: layer.canvas.width, h: layer.canvas.height };
    });
    assert.deepEqual(size2, { w: 192, h: 128 }, 'second upscale size mismatch');
    await freshDoc(); // back to srgb 1280x800 for cleanliness
  });

  // Check 1 (asserted last): zero console errors / pageerrors across the run.
  await check('1. Zero console errors and zero pageerrors', async () => {
    assert.deepEqual(pageErrors, [], `pageerrors:\n${pageErrors.join('\n')}`);
    assert.deepEqual(consoleErrors, [], `console errors:\n${consoleErrors.map((e) => JSON.stringify(e)).join('\n')}`);
  });
}

let exitCode = 0;
try {
  await main();
} catch (err) {
  console.error(`FATAL  ${err && err.stack ? err.stack : err}`);
  exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) server.kill();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length > 0 || exitCode !== 0) {
  for (const f of failed) console.log(`  FAILED: ${f.name}`);
  process.exit(1);
}
console.log('SMOKE SUITE PASSED');
