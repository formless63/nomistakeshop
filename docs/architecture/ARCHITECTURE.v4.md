# ARCHITECTURE v4 Addendum — AI + Utility Bolt-ons

Extends v1–v3. Same vendor rules as v3 §"Vendor rules": vendor into
`vendor/<name>/` with LICENSE + VERSION files, lazy-load via dynamic import,
license MUST be MIT/Apache-2.0/ISC/BSD (LGPL acceptable with dynamic-load
note). If a library turns out to be AGPL/commercial/mislicensed — DO NOT ship
it; report back instead.

All new features are self-contained modules exposing an async function;
menu wiring is orchestrator-owned. Static imports only from `../core/*.js`
(+ '../tools/selectionPath.js' where needed); vendor libs via cached dynamic
import. DOM access inside functions only (Node-import-safe). Long operations
emit `status:message` progress ('Loading AI model…', 'Upscaling…', …) and
success/failure messages. All ops guard: no doc → status message, return.

## 1. AI Upscale — js/ops/upscale.js (UpscalerJS)

Vendor `upscaler` + `@upscalerjs/default-model` (+ the tensorflow deps they
need — inspect node_modules; copy the minimal browser ESM/UMD bundles).
`export async function upscaleActiveLayer(factor = 2)`:
- Guards: active layer must be pixel type.
- Warn-and-abort (dialogs.alert via dynamic import) if layer > 2048px in
  either dimension (browser memory).
- history.push('AI Upscale'); run UpscalerJS with the vendored default model
  at ×2 or ×4 (model weights: vendor if <10MB total; otherwise configure the
  lib's CDN path and note it in the report); result tensor → dataURL/blob →
  Image → draw onto a NEW canvas of the scaled size; replace layer canvas/ctx
  (also scale layer.mask if present, via drawImage upscale); emit
  'layer:content'; status 'Upscaled ×N'.
- If vendoring the full tfjs proves enormous/broken, acceptable fallback:
  vendor `@upscalerjs/default-model` only if it works with the slimmest tfjs
  backend. Report total vendored bytes.

## 2. AI Background Removal — js/ops/removeBg.js (@imgly/background-removal)

FIRST verify the license in the npm package (must be MIT/Apache-style; if
it's AGPL or a commercial IMG.LY license, STOP and report — do not vendor).
`export async function removeBackground()`:
- Operates on the active pixel layer (guards).
- history.push('Remove Background'); decode layer canvas → blob; run the
  library; result blob → bitmap → draw back onto the cleared layer canvas
  (same doc size, subject kept, background transparent); emit 'layer:content'.
- Model weights: configure the library to fetch models from its default CDN
  (jsdelivr) at runtime — do NOT vendor multi-hundred-MB model files. Status
  progress messages required ('Downloading AI model (first use)…').
  Note the CDN runtime dependency in the report + THIRD_PARTY_NOTICES.

## 3. Image Info + Palette — js/ops/imageInfo.js (exifr, color-thief)

Vendor `exifr` (MIT) and `color-thief` (verify license; MIT expected).
- `export async function showImageInfo(file = null)`:
  - If a File is supplied (from open/drop paths later) parse that; else
    re-serialize the current composite via flattenImage → blob → exifr.parse.
    Show a dialogs.alert-style modal (dynamic import ../ui/dialogs.js — add a
    generic `infoDialog(title, rows)` helper IF dialogs.js already has
    something suitable; otherwise build a minimal modal inline in this module
    reusing the #dialog-root pattern from dialogs.js — read it first and
    MATCH its structure/classes). Rows: dimensions, color space, and whatever
    EXIF fields exist (camera, lens, exposure, ISO, date, GPS) — render
    'No embedded metadata' when empty.
- `export async function extractPalette(count = 8)`:
  - flattenImage() → color-thief getPalette(img, count) → set the color
    panel's preset swatches: state.setColor is per-color; simplest UI
    contract — emit('status:message') 'Palette extracted' and REPLACE the
    preset swatch grid by dispatching a custom event 'palette:extracted'
    with {colors: ['#rrggbb', ...]} — js/ui/colorPanel.js listens for it IF
    it already can; since it can't yet, this module may directly update the
    DOM swatches in #color-panel (read colorPanel.js first; reuse its
    swatch-click behavior by setting each .swatch element's dataset/background
    consistently). Keep it simple and robust.

## 4. Optimized PNG export — js/io/optimizePng.js (UPNG.js)

Vendor `upng-js` (MIT; ships with pako — vendor both license texts).
`export async function exportOptimizedPng()`:
- flattenImage() → getImageData → UPNG.encode([rgbaBuffer], w, h, 256) →
  ArrayBuffer → downloadBlob 'untitled-optimized.png'.
- status:message with before/after KB so the user sees the win (compare
  against a plain toBlob PNG).

## Menu wiring (orchestrator)

- Image menu: 'AI Upscale ×2', 'AI Upscale ×4' → upscaleActiveLayer(2|4);
  '──', 'Image Info…' → showImageInfo().
- Layer menu: 'Remove Background (AI)' → removeBackground().
- Select menu: nothing new.
- Edit menu: nothing new.
- Color panel area: 'Extract Palette' button → extractPalette() — actually
  put it in the Image menu as 'Extract Palette to Swatches' to keep
  colorPanel.js untouched. Decide by simplest diff.
- File menu: 'Export Optimized PNG' → exportOptimizedPng().
