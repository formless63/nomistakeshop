# ARCHITECTURE v3 Addendum — FOSS Integrations + Mobile

Extends v1/v2. Everything from earlier contracts still applies. Theme of v3:
**hand-built core, best-in-class FOSS at the edges** — libraries are vendored
(static files in `vendor/`), lazy-loaded via dynamic `import()` only when the
feature is used, and license-compliant (full license text vendored alongside).

## Vendor rules (all agents)

- `vendor/<libname>/` contains: the distributable JS (and wasm/assets if any),
  a `LICENSE` file with the library's full license text, and a `VERSION` file
  containing the exact version + upstream URL.
- Obtain via `npm install <lib>` (or `npm pack`), copy dist files into
  `vendor/`, and do NOT add the package to package.json dependencies — the app
  ships the vendored files, npm stays tooling-only (except devDependencies).
- App code loads vendor libs ONLY via dynamic `import()` at feature-invocation
  time, so first paint never pays for them. Cache the resulting promise.
- THIRD_PARTY_NOTICES.md (orchestrator maintains) gets one section per library:
  name, version, license, upstream URL, what we use it for.

## 1. PSD support (js/io/psd.js) — via ag-psd (MIT)

Vendor `ag-psd` (https://github.com/Agamnentzar/ag-psd) into `vendor/ag-psd/`.
Use the most browser-friendly dist build; if it's UMD/CJS, ship a tiny ESM
wrapper (`import './agpsd.umd.js'; export const { readPsd, writePsd } = window.agPsd;`
or equivalent global the build exposes).

```js
export async function openPsdFile(file);   // -> replaces current doc
export async function exportPsd();         // -> downloads '<name>.psd'
```

- **Import**: `file.arrayBuffer()` → `readPsd(buffer)` (default options —
  browser build creates canvases itself). Map psd tree → our doc:
  - `createDocument(psd.width, psd.height, 'transparent')`.
  - Iterate `psd.children` — VERIFY the order empirically (write a fixture with
    two named layers, read it, log order) so that our `layers[0]` = bottom.
  - Each child with a `canvas` → pixel layer: `makeLayer(name, w, h)`,
    drawImage(child.canvas, left||0, top||0), props: `visible !== false`,
    `opacity = (child.opacity ?? 255) / 255`, blend mode via PSD_BLEND_MAP
    (`'norm'→'source-over'`, `'mul'→'multiply'`, `'scrn'→'screen'`,
    `'over'→'overlay'`, `'dark'→'darken'`, `'lite'→'lighten'`, `'div'→'color-dodge'`,
    `'idiv'→'color-burn'`, `'hLit'→'hard-light'`, `'sLit'→'soft-light'`,
    `'diff'→'difference'`, `'smud'→'exclusion'`, `'hue'→'hue'`, `'sat'→'saturation'`,
    `'colr'→'color'`, `'lum'→'luminosity'`; unknown → 'source-over' + count).
  - Child `mask.canvas` → our `layer.mask` {canvas, ctx, enabled: !mask.disabled}.
  - Groups (`children` inside): recursively flatten into our flat list with a
    `'Group: <name>'` naming prefix; count them.
  - Vector/text/smart-object layers without a rendered canvas: skip + count.
  - After load: history.clear(), emit 'doc:changed' + 'layers:changed',
    renderer.fitToScreen(). If anything was skipped/mapped, status:message
    summarizing (e.g. 'Imported PSD — 2 groups flattened, 1 layer skipped').
- **Export**: build `{width, height, layers}` from state.doc bottom-up:
  pixel layers → `{name, canvas, opacity: Math.round(opacity*255), visible,
  blendMode: reverse map (our id → psd key), mask: layer.mask ? {canvas:
  layer.mask.canvas} : undefined}`. Adjustment layers CANNOT be represented:
  bake each adjustment's filter into the nearest pixel layer BELOW it in the
  exported copy (use the FILTER_FNS map from js/core/composite.js — import it),
  on a CLONE of that layer's canvas (never mutate the real doc). If no pixel
  layer exists below, skip with count. `writePsd(psd)` → ArrayBuffer →
  downloadBlob(new Blob([buf]), 'untitled.psd'). status:message if any
  adjustment was baked/skipped.
- Pure helpers that don't touch DOM should be separated enough that
  `tests/psd.test.mjs` can import the module in Node without crashing
  (DOM work inside functions only).

## 2. Extra import formats (js/io/formats.js) — HEIC via heic2any, RAW researched

- Vendor `heic2any` (https://github.com/alexcorvi/heic2any, MIT wrapper around
  libheif — vendor libheif's LGPL license text too, and note in
  THIRD_PARTY_NOTICES that it's dynamically loaded, unmodified).
  `export async function openHeicFile(file, asNewDoc)` — lazy-load vendor
  bundle, `heic2any({ blob: file, toType: 'image/png' })` → Blob →
  createImageBitmap → reuse io.openImageFile's stamping path (export a helper
  from io.js if needed — coordinate via contract: io.js gains
  `io._stampBitmapAsDoc(bmp, name, asNewDoc)` — orchestrator adds this).
- RAW: research npm for a browser-usable LibRaw/dcraw WASM build
  (candidates: 'libraw.js', 'dcrawjs', 'raw-decoder'...). Acceptance bar:
  actually loads in headless Chrome and exposes a decode function; bonus if it
  decodes a real fixture. If nothing meets the bar, DO NOT ship a half-broken
  decoder — instead `openRawFile` shows dialogs.alert('RAW import isn't
  available yet') and the agent documents findings in its report + README
  roadmap note (orchestrator edits README).
- `export async function openByExtension(file, asNewDoc)` — single router:
  `.psd` → psd.openPsdFile (dynamic import); `.heic/.heif` → openHeicFile;
  RAW extensions (.cr2 .cr3 .nef .arw .dng .orf .rw2 .pef .srw .raw .raf .x3f)
  → raw path; anything else → io's existing image path (orchestrator wires
  io.js to call this router).

## 3. Content-aware fill (js/ops/inpaint.js) — via OpenCV.js (Apache-2.0)

Vendor `@techstark/opencv-js` (or the official opencv.js build) into
`vendor/opencv/`. It's a multi-MB monolith — lazy-load ONLY on first use,
showing status:message 'Loading inpaint engine…' while it initializes (await
the runtime-initialized promise; cache it).

```js
export async function contentAwareFill();
```
- Guards: state.doc, active layer is pixel, state.selection exists — else
  status:message explaining.
- history.push('Content-Aware Fill') BEFORE mutation.
- mask = getSelectionMask() → binary (red>127 → 255 else 0).
- Active layer canvas → cv.matFromImageData; mask → cv Mat (CV_8UC1);
  `cv.inpaint(src, maskMat, dst, 3, cv.INPAINT_TELEA)`; write dst back to the
  layer ctx; delete all Mats; emit('layer:content'); setSelection(null).
  status:message 'Filled'.

## 4. Mobile pass (css/style.css, index.html, js/ui/mobileBar.js)

Desktop layout unchanged above 800px. At <= 800px:

- `#main-row` becomes: toolbar (left, 44px, icons 22px — touch targets >= 40px),
  viewport, and `#side-panel` becomes a fixed right drawer (width 80vw,
  max 320px, translateX(100%) hidden) toggled by a new button.
- NEW js/ui/mobileBar.js `initMobileBar()`: injects a '☰ Layers' toggle button
  into #options-bar (right-aligned); toggles `.panel-open` on body; closes on
  viewport pointerdown; also handles a '✕' close button inside the drawer.
  No-op visually on desktop (button hidden via CSS media query).
- `#menu-bar`: horizontal scroll, no wrap; menus drop down left-aligned so
  they stay on-screen; `#options-bar`: horizontal scroll.
- Dialogs: `max-width: 92vw`, curves canvas scales to fit (CSS width 100%,
  keep aspect-ratio 1).
- `#display-canvas`: `touch-action: none` so pointer drawing works without the
  page scrolling/zooming. Status bar: hide cursor-position segment on mobile.
- index.html: agent MAY edit it (only: add a `<meta>` if needed and any
  container hooks the drawer needs — keep all existing ids intact).
- e2e (orchestrator's wave 2 will test): at 390x844 the drawer toggle works
  and a brush stroke draws.

## 5. Orchestrator-owned (NOT the agents')

- io.js: `_stampBitmapAsDoc` helper + routing `openImageFile` through
  formats.openByExtension; widen #file-open-image accept to
  `image/*,.psd,.heic,.heif,.cr2,.cr3,.nef,.arw,.dng,.orf,.rw2`.
- menuBar.js: File > 'Export PSD' → psd.exportPsd(); Edit > 'Content-Aware
  Fill' → inpaint.contentAwareFill() (disabled w/o selection or on adjustment
  layer, refresh on selection:changed/layers:changed).
- Display-P3: doc gains `colorSpace` ('srgb'|'display-p3'); createCanvas and
  getImageData/putImageData take it from state.doc; newDocument dialog gets a
  color-space select; renderer's display canvas context created with
  `{colorSpace: doc.colorSpace}`.
- THIRD_PARTY_NOTICES.md assembly, README updates, final commit.

## 6. Testing notes for wave 2 (orchestrator dispatches)

- PSD: node script `tests/fixtures/make-psd.mjs` uses vendored ag-psd to write
  a 2-layer fixture PSD (needs canvas shims in Node — or write the fixture in
  the BROWSER once via writePsd and save bytes into tests/fixtures/two-layer.psd;
  either is fine). e2e: openPsdFile → 2 layers with right names/order;
  exportPsd → capture blob → readPsd in page → assert round-trip.
- Inpaint e2e: paint a black dot on white, select rect around it,
  contentAwareFill via Edit menu → dot gone (pixels white again). This pays
  the multi-MB opencv load ONCE in CI — acceptable.
- HEIC e2e: skip decoding (no fixture), but assert the router routes .heic to
  the right loader (can stub).
- Mobile e2e: 390x844 viewport — drawer toggle + a drawn stroke + no console
  errors.
