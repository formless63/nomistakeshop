# ARCHITECTURE v2 Addendum — Feature Parity Expansion

This addendum EXTENDS the v1 contract. Everything in v1 still applies unless
explicitly changed here. Read v1 first.

## 1. Layer model v2 (js/core/document.js)

Two layer types now exist:

```js
// Pixel layer (as v1, plus optional mask):
{ id, type: 'pixel', name, visible, opacity, blendMode, canvas, ctx,
  mask: null | { canvas, ctx, enabled: true } }
// Adjustment layer (non-destructive filter applied to everything below):
{ id, type: 'adjustment', name, visible, opacity, blendMode,
  adjustment: { filterId, params } }   // no canvas/ctx/mask
```

`makeLayer(name, w, h)` keeps returning pixel layers. New/changed exports:

```js
export function addAdjustmentLayer(filterId, params, name = null); // -> layer; inserts
   // above active, becomes active; history.push('New Adjustment Layer'); emits 'layers:changed'
export function setAdjustment(id, filterId, params); // history.push('Edit Adjustment');
   // emits 'layers:changed' + 'layer:content'
export function addLayerMask(id, mode = 'white'); // 'white'|'black'|'selection'
   // ('selection' initializes from getSelectionMask()); history.push('Add Layer Mask');
   // emits 'layers:changed'
export function removeLayerMask(id, apply = false); // apply=true bakes mask into pixel
   // alpha first; history.push; emits 'layers:changed' + 'layer:content'
export function toggleLayerMask(id);                // flips mask.enabled; emits both events
export function getPaintTarget(); // -> { layer, ctx, isMask } | null
   // Returns the ctx painting tools should draw into: layer.mask.ctx when
   // state.activeTarget === 'mask' and active layer has an enabled mask,
   // else layer.ctx. Null when no doc or active layer is an adjustment layer.
```

`state.activeTarget: 'layer' | 'mask'` + `setActiveTarget(t)` (emits 'layers:changed')
live in state.js. `setActiveLayer()` resets `state.activeTarget = 'layer'`.

Changed behaviors:
- `duplicateLayer` deep-clones the mask too; adjustment layers duplicate with a
  deep-copied `adjustment` object. Name suffix " copy" as before.
- `mergeDown(id)`: no-op (with `emit('status:message', {text})` explaining) if either
  layer is an adjustment layer. If the lower layer has a mask, apply (bake) the mask
  first. Merging respects the upper layer's mask (composite via composite.js logic).
- `removeLayer`: works for both types.
- `updateLayerProps` unchanged (both types).
- Paint on a layer with a mask does NOT auto-apply the mask to pixels — the mask is
  applied at composite time (renderer), exactly like Photoshop.

## 2. NEW js/core/composite.js

Single source of truth for flattening, used by renderer AND flattenImage:

```js
import * as filters from '../filters/filters.js';
export const FILTER_FNS = { brightness: filters.brightness, ... }; // id -> fn, one per
   // FILTER_LIST id (including v2 filters). Params passed positionally in FILTER_LIST
   // params order, EXCEPT object-param filters (levels/curves/hueSaturation/gradientMap)
   // which receive their single params object — see §5.
export function compositeLayers(width, height, layers, upToIndex = layers.length - 1);
   // -> canvas. Bottom-up. For each visible layer 0..upToIndex:
   // - adjustment layer: current composite -> getImageData -> run its filter ->
   //   putImageData (result keeps compositing). Honors opacity by blending
   //   filtered/unfiltered ImageData per pixel; blendMode applied via a temp canvas.
   // - pixel layer: draw layer.canvas into temp canvas; if mask && mask.enabled,
   //   temp.ctx 'destination-in' drawImage(mask.canvas); then draw temp onto composite
   //   with globalAlpha=opacity, globalCompositeOperation=blendMode.
```

`document.flattenImage()` delegates to `compositeLayers` (import from composite.js —
no cycle: composite.js imports only filters.js + canvasUtils.js).

## 3. renderer.js changes

- `render()` uses `compositeLayers(state.doc.width, state.doc.height, state.doc.layers)`
  instead of its own loop, drawn once scaled by zoom. (Same visual result plus
  masks/adjustments.)
- Grid: `state.grid = { enabled: false, size: 32 }` (in state.js).
  `renderer.setGrid(enabled, size)` emits 'view:changed'. When enabled, render draws
  light grid lines in doc space every `size` px (only when zoom * size >= 8 screen px).

## 4. Selection v2 (state.js + js/tools/selectionPath.js)

New selection shape:
```js
null
| { type:'rect',    x,y,w,h, invert:false, feather:0 }
| { type:'ellipse', x,y,w,h, invert:false, feather:0 }
| { type:'lasso',   points:[{x,y}...], invert:false, feather:0 }
| { type:'mask',    mask: canvas }   // white = selected; from magic wand
```
Existing fields stay; `invert`/`feather` default false/0 and old code that ignores
them keeps working.

selectionPath.js:
- `traceSelectionPath(ctx, sel)` — add ellipse support (ctx.ellipse).
- NEW `clipSelection(ctx)` — rect/ellipse/lasso: builds path (for `invert`, path =
  full-doc rect + shape subpath) and calls `ctx.clip(path, sel.invert ? 'evenodd' : 'nonzero')`.
  For `type:'mask'`: no-op (paint tools draw unclipped; documented limitation).
  Feather is NOT applied to paint clipping (only to raster ops via mask).
- NEW `getSelectionMask()` — -> canvas (doc-sized, white = selected):
  path types: rasterize path filled white (invert honored), then feather>0 →
  separable box blur with radius=feather (reuse filters.boxBlur on the alpha/red
  channel via ImageData). `type:'mask'`: return the mask canvas as-is.
  No selection → return null.
- NEW `invertSelection()` — path types: toggle `sel.invert`; mask type: pixel-invert
  the mask canvas. Emits 'selection:changed'.
- NEW `featherSelection(px)` — path types: set `sel.feather`; mask type: blur the mask
  canvas in place. Emits 'selection:changed'.

## 5. Filters v2 (js/filters/filters.js — pure, Node-testable)

New named exports (mutate-and-return, clamp everything, total functions):
- `levels(imageData, { inBlack = 0, inWhite = 255, gamma = 1, outBlack = 0, outWhite = 255 })`
- `curves(imageData, { points = [[0,0],[255,255]] })` — master-channel LUT from control
  points (Catmull-Rom or monotone cubic; clamp output 0-255; <2 points = no-op).
- `hueSaturation(imageData, { hue = 0, saturation = 0, lightness = 0 })` — hue -180..180,
  saturation/lightness -100..100 (HSL-space per pixel).
- `gradientMap(imageData, { from = '#000000', to = '#ffffff' })` — map luma 0..255
  linearly from->to (hex strings; duplicate tiny hex parser locally — filters.js must
  stay dependency-free).

filterRegistry.js:
- FILTER_LIST gains entries: `levels` (custom dialog), `curves` (custom dialog),
  `hueSaturation…` (3 ranges), `gradientMap…` (two `{type:'color'}` params).
  Entry shapes: `{ id:'levels', label:'Levels…', custom:'levels' }`,
  `{ id:'curves', label:'Curves…', custom:'curves' }`. Params spec now allows
  `{ key, label, type:'range'|'color', min,max,step,default }`.
- `applyFilterToActiveLayer(id, paramValues = null)`:
  - custom entries: `const d = await import('../ui/dialogs.js')` → `d.levelsDialog()`
    / `d.curvesDialog()` → resolve params object or null (cancel).
  - SELECTION-AWARE: if `state.selection` exists and active target is pixel layer:
    apply filter to a COPY of the layer ImageData, then merge with original using
    `getSelectionMask()` alpha (filtered where mask white). No selection → full apply.
  - Also NEW `applyFilterToLayer(layer, id, params)` — same but explicit layer arg;
    `applyFilterToActiveLayer` delegates to it. Used by adjustment-layer editing.
  - NEW `ADJUSTABLE_FILTERS` — array of FILTER_LIST entries usable as adjustment
    layers (all except noise/pixelate/emboss/edgeDetect/sharpen/boxBlur? NO — include
    all EXCEPT noise; blur/sharpen/emboss are fine as adjustments since composite.js
    runs them on ImageData).

## 6. history.js changes

- Snapshots capture: per layer — all props, `type`, cloned `canvas` (pixel layers),
  cloned `mask.canvas` + `mask.enabled` (when present), deep-copied `adjustment`
  (adjustment layers). Restore reconstructs both layer kinds.
- NEW `list()` -> `{ entries: [label,...], index }` (undo-stack labels oldest→newest;
  `index` = number of applicable undos = position the history panel highlights).
- NEW `jumpTo(index)` — calls undo()/redo() until `index` undos remain. Bounded loop.

## 7. Tools v2 (js/tools/)

Paint tools (brush/eraser) now draw into `getPaintTarget().ctx` instead of
`getActiveLayer().ctx`; when painting a mask they still respect selection clip.
Since mask ALPHA is visibility, painting a mask maps the painted color's
luminance onto mask alpha (brush: black hides via 'destination-out', white
reveals via white 'source-over'; fill: writes luma into alpha, RGB stays white).
Move tool moves `layer.canvas` AND `layer.mask.canvas` by the same delta.
fill.js uses `getSelectionMask()` (mask-aware fill) instead of path bounds; falls back
to full layer when no selection.

New tools (same default-export contract as v1):
- `selectEllipse.js` — id `selectEllipse`, label 'Ellipse Select', icon '◯',
  sets `{type:'ellipse', x,y,w,h,...}` live. Non-destructive.
- `wand.js` — id `wand`, label 'Magic Wand', icon '🪄', options: tolerance (0-100,
  def 32), contiguous (checkbox, def true). Click samples `flattenImage()` composite,
  builds mask canvas: contiguous → scanline flood from click point (same tolerance
  formula as fill.js); non-contiguous → global per-pixel match. Sets
  `state.selection = { type:'mask', mask }`, emits 'selection:changed'. Non-destructive.
- `clone.js` — id `clone`, label 'Clone Stamp', icon '🧬', cursor 'crosshair',
  destructive. Options: size (1-300 def 40), hardness (0-100 def 75),
  opacity (1-100 def 100), aligned (checkbox, def true). Alt-click (or first click
  when no source) records source point ON THE ACTIVE LAYER and shows
  'status:message' 'Clone source set'; normal strokes stamp from
  `source + (pt - strokeStart)` (aligned) or always from `source + strokeLocalDelta`
  reset per stroke (non-aligned). Source sampling via a snapshot canvas taken at
  stroke start so self-overlap doesn't smear. Selection-clipped via clipSelection.
- `dodgeBurn.js` — id `dodgeBurn`, label 'Dodge / Burn', icon '🌗', destructive.
  Options: size (1-300 def 40), exposure (1-100 def 50),
  mode select: choices `[{value:'dodge',label:'Dodge (lighten)'},{value:'burn',label:'Burn (darken)'}]`,
  range select: shadows/midtones/highlights (def midtones). Each stamp processes an
  ImageData region: per-pixel weight by luma range (shadows: 1-luma; highlights: luma;
  midtones: 1-|2*luma-1|), then `v *= 1 ± exposure/100 * weight * falloff` clamped.
  Radial falloff from stamp center.

toolManager.js:
- New shortcuts: `w` wand, `s` clone stamp, `o` dodge/burn, `Shift+M` ellipse select.
- New: `Ctrl/Cmd+C` copy, `Ctrl/Cmd+X` cut, `Ctrl/Cmd+V` paste — delegate to
  `js/io/clipboard.js` (`copySelection()`, `cutSelection()`, `pasteAsNewLayer()`);
  import it dynamically to avoid core->io cycles.

## 8. transform.js addition

```js
export function transformActiveLayer({ scaleXPct = 100, scaleYPct = 100, rotateDeg = 0 });
   // history.push('Transform Layer'); active pixel layer's canvas (and mask) redrawn
   // through a temp canvas: translate to center, scale, rotate, drawImage back.
   // Doc size unchanged. No-op for adjustment layers / no doc. Emits 'layer:content'.
```

## 9. IO v2

- `io.exportImage` accepts `'webp'` too (`canvas.toBlob(..., 'image/webp', quality)`).
- Extract `serializeProject()` -> plain object and `loadProjectData(obj)` from
  saveProject/loadProjectFile internals; export both (autosave reuses them).
- NEW `js/io/clipboard.js`:
  - `copySelection()` — composite selection region from `flattenImage()` +
    `getSelectionMask()` (or full doc when no selection) into an internal module-level
    clipboard canvas; ALSO best-effort `navigator.clipboard.write([ClipboardItem png])`
    inside try/catch. `cutSelection()` = copy + clear region on active pixel layer
    (history.push('Cut')). `pasteAsNewLayer()` — internal clipboard → `addLayer('Pasted', canvas)`
    centered; else try `navigator.clipboard.read()` for an image item. `hasClipboard()`.
- NEW `js/io/autosave.js` — IndexedDB db `nomistakeshop`, store `kv`:
  - `scheduleAutosave()` — every 30s: if `state.doc`, `io.serializeProject()` →
    IDB put key 'autosave' (try/catch quota). Also on `beforeunload`.
  - `loadAutosave()` -> Promise<object|null>; `clearAutosave()` -> Promise.
  - main.js (orchestrator) calls these at boot.
- `io.initDragDrop()` — dragover/drop on `#viewport`: image files →
  `io.openImageFile(file, false)`; `.nmsproject` → `io.loadProjectFile(file)`.
- `io.initPaste()` — window 'paste' event: image clipboardData item → blob →
  stamp onto canvas → `addLayer('Pasted', canvas)`.

## 10. UI v2

- index.html: orchestrator adds `<div id="history-panel"></div>` inside `#side-panel`
  after `#layers-panel`.
- NEW `js/ui/historyPanel.js` — `initHistoryPanel()`: titled 'History'; on
  'history:changed'/'doc:changed' rebuild list from `history.list()`; click row →
  `history.jumpTo(i)`; highlight current index; empty state 'No history yet'.
- layersPanel.js:
  - Adjustment layer rows: '◐' icon instead of pixel thumbnail; double-click name →
    rename (existing); single double-click on the icon/row body opens the edit dialog
    (filterParams / levelsDialog / curvesDialog per FILTER_LIST entry) →
    `setAdjustment(id, filterId, params)` on confirm.
  - Pixel rows with a mask: second thumbnail (mask canvas, updated on 'layer:content');
    click mask thumb → `setActiveTarget('mask')` (blue outline = editing mask),
    click layer thumb → `setActiveTarget('layer')`.
  - Footer adds: 'Mask' button → `addLayerMask(activeId, 'white')` (disabled when
    active layer already has one or is adjustment); 'Adj' button → small popup listing
    `ADJUSTABLE_FILTERS` labels → `addAdjustmentLayer(id, defaultParams, label)`.
- menuBar.js additions:
  - Edit (after Redo): Cut (Ctrl+X), Copy (Ctrl+C), Paste as New Layer (Ctrl+V) →
    clipboard.js (dynamic import ok). Disabled states: Cut/Copy need active pixel
    layer; Paste needs `hasClipboard()`.
  - NEW top-level Select menu: Select All (Ctrl+A), Deselect (Ctrl+D), ─,
    Invert (`invertSelection()`, disabled w/o selection), Feather… (promptNumber
    0-250 def 10 → `featherSelection(px)`, disabled w/o selection).
  - Layer menu: ─, Add Layer Mask (white), Add Layer Mask (black), Add Layer Mask
    (from Selection, disabled w/o selection), Delete Layer Mask, Apply Layer Mask,
    ─, New Adjustment Layer ▸ (submenu from ADJUSTABLE_FILTERS), ─, Transform Layer…
    (dialogs.transformLayerDialog() → transform.transformActiveLayer, disabled for
    adjustment layers).
  - File: Export WebP.
  - View: Grid (checkbox-style toggle showing ✓ when state.grid.enabled).
- dialogs.js additions:
  - `levelsDialog()` -> Promise<{inBlack,inWhite,gamma,outBlack,outWhite}|null> —
    five range rows (inBlack 0-254, inWhite 1-255, gamma 0.1-9.99 step .01,
    outBlack 0-255, outWhite 0-255).
  - `curvesDialog()` -> Promise<{points}|null> — 256px square canvas editor, diagonal
    baseline, control points draggable, click empty spot adds a point (sorted by x),
    right-click removes (keep >=2), live-drawn smooth curve matching filters.curves
    interpolation, Reset button. Points normalized 0-255 both axes, origin bottom-left
    mapped to canvas top-left correctly (y flipped).
  - `transformLayerDialog()` -> Promise<{scaleXPct,scaleYPct,rotateDeg}|null> —
    promptNumber-style: Scale X % (1-1000 def 100), Scale Y % (1-1000 def 100),
    Rotate ° (-360-360 def 0).
  - filterParams: support `type:'color'` params (color input).
- colorPanel/toolbar/optionsBar/statusBar: unchanged. optionsBar must handle tools
  with `select` options that carry `{value,label}` choices (already does).

## 11. main.js changes (orchestrator)

Register the 4 new tools (order: move, selectRect, selectEllipse, lasso, wand, crop,
eyedropper, brush, eraser, clone, dodgeBurn, fill, gradient, text, shapes, hand, zoom).
Init historyPanel. Boot: `autosave.loadAutosave()` → if found and dialogs.confirm
('Restore autosaved session?') → `io.loadProjectData(data)`; else newDocument flow.
`autosave.scheduleAutosave()` always.

## 12. Tests v2

- tests/filters.test.mjs: add exact-value cases for levels (identity defaults;
  inBlack/inWhite clip; gamma 2), curves (identity diagonal; 2-point contrast curve;
  single-point no-op), hueSaturation (saturation -100 == grayscale-ish; identity
  defaults), gradientMap (black->white == luma; red->blue endpoints).
- tests/history.test.mjs: add list()/jumpTo() coverage.
- e2e suite (wave 3) adds: layer mask painting hides pixels; adjustment layer alters
  composite and survives undo; wand selects; clone stamp duplicates pixels; cut/copy/
  paste internal round trip; WebP export produces image/webp blob; autosave writes to
  IndexedDB and restores via loadProjectData.
