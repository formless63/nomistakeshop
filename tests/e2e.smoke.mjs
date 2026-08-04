// tests/e2e.smoke.mjs — headless-browser smoke test for NoMistakeShop.
// Serves the project statically, drives the real app in headless Chrome via
// puppeteer, and exercises the full smoke checklist from end to end.
//
// Run: node tests/e2e.smoke.mjs   (or: npm run test:e2e)
// Exits 0 when every check passes, 1 otherwise.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire('/home/wicaso/.nvm/versions/node/v25.8.1/lib/node_modules/x.js');
const puppeteer = require('puppeteer');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8123;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/home/wicaso/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome';

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
    args: ['--no-sandbox'],
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
  await page.goto(`${BASE}/index.html`, { waitUntil: 'load' });

  // Check 2: New Document dialog on load -> confirm -> 1280x800, 1 layer.
  await check('2. New Document dialog confirms to 1280x800 / 1 layer', async () => {
    await waitDialog();
    const title = await ev(() => document.querySelector('.dialog-overlay .dialog-title').textContent);
    assert.equal(title, 'New Document');
    await confirmDialog();
    const info = await ev(() => ({
      w: window.__nms.state.doc.width,
      h: window.__nms.state.doc.height,
      layers: window.__nms.state.doc.layers.length,
    }));
    assert.deepEqual(info, { w: 1280, h: 800, layers: 1 });
  });

  // Check 3: toolbar has 13 buttons; brush button activates.
  await check('3. Toolbar has 13 buttons; brush activates', async () => {
    const count = await ev(() => document.querySelectorAll('#toolbar .tool-button').length);
    assert.equal(count, 13);
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
