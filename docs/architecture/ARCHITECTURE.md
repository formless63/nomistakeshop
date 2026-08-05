# nomistakeshop Architecture Contract

This document is the **binding contract** between modules. Every module must implement
exactly the signatures and behaviors described here. No build step: plain ES modules
served statically. Browser target: modern Chrome/Firefox (Canvas 2D API).

## Directory layout

```
index.html            (exists; defines fixed DOM ids — do not change ids)
css/style.css         (UI agent owns)
js/main.js            (bootstrap glue; orchestrator owns — do NOT create)
js/core/state.js      (app state + event bus)
js/core/document.js   (document & layer model)
js/core/history.js    (undo/redo snapshots)
js/core/renderer.js   (composites layers onto the display canvas)
js/core/blendmodes.js (blend mode list + pixel math)
js/core/canvasUtils.js(shared canvas helpers)
js/tools/toolManager.js + js/tools/<tool>.js
js/filters/filters.js (pure pixel operations)
js/filters/filterRegistry.js (filter metadata + apply-to-layer)
js/ops/transform.js   (rotate/flip/resize/crop)
js/io/io.js           (open/export/save/load project)
js/ui/menuBar.js, toolbar.js, optionsBar.js, layersPanel.js, colorPanel.js,
   statusBar.js, dialogs.js
tests/*.test.mjs      (node:test, pure-logic only)
```

Fixed DOM ids in index.html: `menu-bar`, `options-bar`, `toolbar`, `viewport`,
`display-canvas`, `side-panel`, `color-panel`, `layers-panel`, `status-bar`,
`dialog-root`, `file-open-image`, `file-open-project`.

## Core conventions

- All coordinates in tools are **document coordinates** (integers in doc pixel space).
- Every operation that mutates layer pixels or doc structure must call
  `history.push(label)` **before** mutating, then emit the appropriate events after.
- Colors are hex strings `#rrggbb`. `canvasUtils.hexToRgb(hex)` -> `{r,g,b}`.
- Doc pixel data lives in each layer's own offscreen canvas (`layer.canvas`,
  `layer.ctx`). The display canvas is render-only.

## js/core/state.js

```js
export const state = {
  doc: null,            // see document.js
  activeTool: 'brush',  // tool id string
  toolOptions: {},      // map toolId -> { optionKey: value }, persisted per tool
  primaryColor: '#000000',
  secondaryColor: '#ffffff',
  zoom: 1,              // display scale factor
  panX: 0, panY: 0,     // viewport pan in screen px
  selection: null,      // null | { type:'rect', x,y,w,h } | { type:'lasso', points:[{x,y}...] }
  isPointerDown: false, // managed by toolManager
};
export function on(event, fn);        // subscribe; returns unsubscribe fn
export function off(event, fn);
export function emit(event, payload); // sync dispatch
```

Events (emit exactly these names):
- `doc:changed` — new doc created / doc structure replaced (full UI rebuild)
- `layers:changed` — layer list changed (add/remove/reorder/rename/visibility/opacity/blend/active)
- `layer:content` — pixels of a layer changed → re-render. Payload `{layerId}` optional.
- `tool:changed` — active tool changed
- `color:changed` — `{which:'primary'|'secondary'}`
- `selection:changed`
- `view:changed` — zoom/pan changed
- `history:changed` — undo/redo stacks changed (for menu enable/disable)
- `status:message` — `{text}` transient status bar hint

Helpers: `setTool(id)`, `setColor(which, hex)`, `swapColors()`,
`setSelection(sel)`, `getToolOption(toolId, key, fallback)`, `setToolOption(toolId, key, value)`.
Each helper emits the matching event.

## js/core/canvasUtils.js

```js
export function createCanvas(w, h);          // -> {canvas, ctx} (willReadFrequently: true)
export function cloneCanvas(src);            // deep copy of a canvas
export function hexToRgb(hex);               // '#rrggbb' -> {r,g,b} (0-255)
export function rgbToHex(r, g, b);
export function getLayerImageData(layer);    // full-canvas ImageData
export function putLayerImageData(layer, imageData);
export function downloadBlob(blob, filename);
export function clamp(v, min, max);
```

## js/core/blendmodes.js

```js
// Ordered list shown in the layers-panel blend dropdown.
// 'mode' values must be valid CanvasRenderingContext2D.globalCompositeOperation values.
export const BLEND_MODES = [
  { id: 'source-over', label: 'Normal' },
  { id: 'multiply', label: 'Multiply' },
  { id: 'screen', label: 'Screen' },
  { id: 'overlay', label: 'Overlay' },
  { id: 'darken', label: 'Darken' },
  { id: 'lighten', label: 'Lighten' },
  { id: 'color-dodge', label: 'Color Dodge' },
  { id: 'color-burn', label: 'Color Burn' },
  { id: 'hard-light', label: 'Hard Light' },
  { id: 'soft-light', label: 'Soft Light' },
  { id: 'difference', label: 'Difference' },
  { id: 'exclusion', label: 'Exclusion' },
  { id: 'hue', label: 'Hue' },
  { id: 'saturation', label: 'Saturation' },
  { id: 'color', label: 'Color' },
  { id: 'luminosity', label: 'Luminosity' },
];
```

## js/core/document.js

Layer object shape (created only via `makeLayer`):
```js
{ id, name, visible: true, opacity: 1, blendMode: 'source-over',
  canvas, ctx }   // canvas sized to the doc; layer pixels at doc coords
```
Doc shape: `{ width, height, layers: [], activeLayerId, background: 'transparent'|'#ffffff' }`

```js
export function createDocument(width, height, background = '#ffffff');
   // sets state.doc with one base layer "Background" (filled with background unless
   // 'transparent'), emits 'doc:changed', 'layers:changed', 'history:changed' (after history.clear())
export function makeLayer(name, width, height);
export function addLayer(name = null, fillCanvas = null); // -> layer; inserts above active,
   // becomes active; history.push('New Layer'); emits 'layers:changed'
export function removeLayer(id);            // keeps >=1 layer; emits 'layers:changed'
export function duplicateLayer(id);         // -> new layer "<name> copy"
export function moveLayer(id, newIndex);    // reorder; emits 'layers:changed'
export function setActiveLayer(id);         // emits 'layers:changed'
export function getActiveLayer();           // -> layer or null
export function updateLayerProps(id, props); // {name?, visible?, opacity?, blendMode?}; emits 'layers:changed'
export function mergeDown(id);              // merges layer into the one below (respecting opacity/blend); emits
export function flattenImage();             // -> single canvas composite (respecting visibility/opacity/blend)
export function selectAll();                // state.selection = full-doc rect, emit 'selection:changed'
export function deselect();                 // state.selection = null, emit
```
Layer ordering: `doc.layers[0]` is the BOTTOM layer; rendering paints index 0 first.

## js/core/history.js

```js
export const history = {
  push(label),   // snapshot current doc (deep-clone every layer canvas + layer props,
                 // activeLayerId, width/height); clears redo stack; cap 25 snapshots
  undo(),        // restore previous snapshot (current goes to redo); emits 'doc:changed',
                 // 'layers:changed', 'layer:content', 'history:changed'
  redo(),
  canUndo(), canRedo(),
  undoLabel(), redoLabel(),   // label strings or null
  clear(),                    // empties both stacks, emits 'history:changed'
};
```
Implementation must isolate stack mechanics in an exported pure class
`SnapshotStack` (push/pop/limit, no DOM) so `tests/history.test.mjs` can test it
in Node without a DOM. Snapshot/restore of canvases lives in thin wrappers.

## js/core/renderer.js

```js
export const renderer = {
  init(displayCanvas),  // sizes to viewport; subscribes to layer:content/doc:changed/selection:changed/view:changed
  render(),             // checkerboard -> layers 0..n (globalAlpha=opacity,
                        // globalCompositeOperation=blendMode) -> selection outline (dashed)
  setZoom(z),           // clamps 0.05..32, emits 'view:changed'
  zoomAt(factor, cx, cy), // zoom keeping screen point (cx,cy) fixed
  pan(dx, dy),          // adds to pan, emits 'view:changed'
  fitToScreen(),        // fit doc in viewport, center; emits 'view:changed'
  screenToDoc(sx, sy),  // -> {x, y} doc coords (floats)
  docToScreen(dx, dy),
};
```
Display canvas is sized to the CSS pixel size of `#viewport`; doc is drawn scaled
by `zoom` and translated by `panX/panY` (state owns these; renderer reads/writes them).
Handle devicePixelRatio for crispness. If `state.doc` is null, render an empty message.

## Tools

Each tool module `js/tools/<id>.js` default-exports:
```js
export default {
  id: 'brush',              // matches filename
  label: 'Brush',
  icon: '🖌️',               // single emoji or short text for the toolbar button
  cursor: 'crosshair',      // CSS cursor while tool active
  destructive: true,        // if true, toolManager calls history.push(label) once per stroke on pointerdown
  options: [                // rendered by optionsBar; values via state.getToolOption/setToolOption
    { key: 'size', label: 'Size', type: 'range', min: 1, max: 200, step: 1, default: 12 },
  ],
  onPointerDown(pt, e),     // pt = {x, y} DOC coords (floats); e = original PointerEvent
  onPointerMove(pt, e),
  onPointerUp(pt, e),
  onDeactivate(),           // optional cleanup
};
```
Tools operate on `getActiveLayer().ctx`. They must respect `state.selection`
(clip drawing to selection via ctx.save/clip with the selection path helper
`traceSelectionPath(ctx, selection)` exported from `js/tools/selectionPath.js`)
and call `emit('layer:content', {layerId})` after pixel changes.
After mutating pixels on pointerup, no extra history push is needed (done on down).

`js/tools/toolManager.js`:
```js
export const toolManager = {
  init(displayCanvas),   // attaches pointerdown/move/up (pointer capture), wheel (ctrl=zoomAt, else pan),
                         // keyboard shortcuts; subscribes to 'tool:changed' to swap cursor
  register(toolModule),  // add tool
  getTools(),            // ordered array for the toolbar
};
```
Routing: convert screen->doc via `renderer.screenToDoc`, track `state.isPointerDown`.
Keyboard (ignore when focus is in input/textarea/dialog):
`v` move, `m` rect-select, `l` lasso, `b` brush, `e` eraser, `g` fill, `i` eyedropper,
`t` text, `u` shapes, `r` gradient, `c` crop, `h` hand, `z` zoom,
`Ctrl/Cmd+Z` undo, `Ctrl/Cmd+Shift+Z` or `Ctrl+Y` redo, `Ctrl/Cmd+A` select all,
`Ctrl/Cmd+D` deselect, `x` swap colors, `[`/`]` brush size down/up.

Required tool ids: `move, selectRect, lasso, crop, eyedropper, brush, eraser,
fill, gradient, text, shapes, hand, zoom`.

Tool specifics:
- brush: options size(1-300,def 12), hardness(0-100,def 100), opacity(1-100,def 100), smoothing via
  quadratic midpoints; stamp circles along segment spaced <= size/4.
- eraser: same options; paints with `destination-out`.
- fill: flood fill with tolerance option (0-100, def 32) on the active layer, respects
  selection bounds; must be O(w*h) scanline stack, not recursion.
- gradient: options: type (linear/radial), from = primary color, to = secondary color;
  drag defines the gradient line/center-radius; fills selection or whole layer.
- eyedropper: click picks primary color from the FLATTENED composite (use
  `flattenImage()`), alt-click / right-click picks secondary.
- move: drags the active layer's pixels (translate its canvas content via
  getImageData/putImageData offset — acceptable) OR simpler: track drag delta and
  redraw layer canvas shifted; emit layer:content. destructive: true.
- selectRect/lasso: set `state.selection` live while dragging (emit 'selection:changed');
  non-destructive.
- crop: drag a rect; on pointerup show a floating confirm (use dialogs.confirm) —
  on confirm, transform.cropToRect(rect). destructive: false (crop op pushes history).
- text: click → dialogs.promptText() -> {text, size, font} -> rasterize onto active
  layer at click point with primary color. options: fontSize(8-400, def 48), fontFamily select
  (Arial, Georgia, Courier New, Times New Roman, Verdana, Impact).
- shapes: options: shape select (rect, ellipse, line), filled checkbox (def true),
  strokeSize(1-50, def 4); drag to draw, live-preview on a temp overlay approach:
  keep a snapshot of layer at pointerdown, restore+redraw on move, commit on up.
  destructive: true (push once on down).
- hand: drag pans viewport (renderer.pan). Spacebar temporary-hand handled by toolManager
  (nice-to-have).
- zoom: click = zoomAt(1.25) at point, alt-click = zoomAt(0.8).

## js/filters/filters.js

Pure functions, signature `fn(imageData, ...params) -> imageData` (mutate-and-return
is fine). Must accept plain `{data: Uint8ClampedArray, width, height}` objects so they
run in Node tests (never touch `document`).

`brightness(v)` v∈[-100,100]; `contrast(v)` [-100,100]; `saturation(v)` [-100,100];
`hueRotate(deg)` [0,360]; `grayscale()`; `invert()`; `sepia()`; `threshold(t)` [0,255 def 128];
`posterize(levels)` [2,16 def 4]; `boxBlur(radius)` [1,50 def 3] (separable, 2-pass);
`sharpen(amount)` [0,100 def 50] (unsharp mask or 3x3 kernel);
`noise(amount)` [0,100 def 20]; `pixelate(size)` [2,64 def 8]; `emboss()`; `edgeDetect()`.
Export as named exports. Every function must be total (clamp all inputs).

## js/filters/filterRegistry.js

```js
import * as filters from './filters.js';
export const FILTER_LIST = [
  { id: 'brightness', label: 'Brightness…', params: [{key:'v',label:'Amount',min:-100,max:100,step:1,default:0}] },
  ... one entry per filter above (… suffix = needs param dialog)
];
export function applyFilterToActiveLayer(id, paramValues = null);
  // history.push(label); get active layer ImageData; run fn; put back;
  // emit('layer:content'). If params exist and paramValues==null, open
  // dialogs.filterParams(filterDef) first, apply on confirm. No-op if no active layer/doc.
```
If `params` length is 0, apply immediately.

## js/ops/transform.js

All doc-wide ops snapshot history first, mutate, then emit
`'doc:changed'` (structure) + `'layer:content'`:
```js
export function rotate90(dir);        // dir: 1 = CW, -1 = CCW — swaps doc width/height
export function rotate180();
export function flipCanvasHorizontal();
export function flipCanvasVertical();
export function flipLayerHorizontal(id);  // emits 'layer:content' only
export function flipLayerVertical(id);
export function resizeImage(newW, newH);  // scale doc + every layer (imageSmoothing on)
export function resizeCanvas(newW, newH, anchor = 'center');
   // anchor: 'center' | 8 edge/corner strings 'tl','t','tr','l','r','bl','b','br'
export function cropToRect({x, y, w, h}); // clamps to doc bounds; no-op if empty
```

## js/io/io.js

```js
export const io = {
  init(),                       // wires hidden inputs #file-open-image / #file-open-project
  openImageDialog(),            // click input; result -> openImageFile(file, asNewDoc)
  openImageFile(file, asNewDoc) // HTMLImageElement decode -> createDocument(w,h,'transparent')
                                // with image stamped on base layer, OR addLayer(file.name, stampedCanvas);
                                // history.push; fitToScreen; emit events
  exportImage(format = 'png', quality = 0.92), // flattenImage() -> downloadBlob '<docname>.png|.jpg'
  saveProject(),                // serialize {version:1,width,height,layers:[{name,visible,opacity,
                                // blendMode,png:dataURL}],activeLayerId} -> .nmsproject download
  loadProjectDialog(), loadProjectFile(file), // rebuild doc via createDocument + layers from dataURLs;
                                // history.clear(); emit 'doc:changed'
};
```
Image decode via `createImageBitmap` or `URL.createObjectURL` + Image; revoke URLs.

## UI modules (all export `initXxx()` called from main.js)

- `menuBar.initMenuBar()` — menus into `#menu-bar`:
  File: New Document…, Open Image…, Open Image as Layer…, ─, Save Project, Load Project…, ─, Export PNG, Export JPEG
  Edit: Undo (dynamic label from history.undoLabel(), disabled when !canUndo), Redo, ─, Select All, Deselect
  Image: Image Size…, Canvas Size…, ─, Rotate 90° CW, Rotate 90° CCW, Rotate 180°, ─,
         Flip Horizontal, Flip Vertical, ─, Crop to Selection (disabled when no rect selection)
  Layer: New Layer, Duplicate Layer, Delete Layer, ─, Merge Down, Flatten Image…(confirm), ─, Flip Layer H, Flip Layer V
  Filter: flat submenu generated from FILTER_LIST -> applyFilterToActiveLayer(id)
  View: Zoom In (zoomAt 1.25 center), Zoom Out, Fit to Screen, Actual Pixels (zoom=1)
  Update undo/redo enabled-state on 'history:changed'. Simple hover/click dropdowns, close on outside click.
- `toolbar.initToolbar()` — buttons for every registered tool into `#toolbar`,
  active state on 'tool:changed', tooltips with shortcut.
- `optionsBar.initOptionsBar()` — renders active tool's `options` (range/number/select/
  checkbox) into `#options-bar`, reads/writes via state.getToolOption/setToolOption;
  rebuilds on 'tool:changed'.
- `layersPanel.initLayersPanel()` — into `#layers-panel`: reversed list (top layer first)
  with per-row: visibility eye toggle, 48px canvas thumbnail (redrawn on 'layer:content'),
  name (dblclick rename), active highlight; header row: blend-mode <select> from
  BLEND_MODES + opacity slider for the ACTIVE layer; footer buttons: new, duplicate,
  delete. Rebuild on 'layers:changed'.
- `colorPanel.initColorPanel()` — into `#color-panel`: overlapping primary/secondary
  swatches, swap (X) button, `<input type="color">` for each, plus 16-preset swatch grid.
- `statusBar.initStatusBar()` — into `#status-bar`: doc `WxH px`, zoom %, last cursor
  doc position (listen on display canvas pointermove), transient 'status:message'.
- `dialogs.js` — promise-based modal helpers into `#dialog-root`:
  `alert(msg)`, `confirm(msg)`, `promptNumber({title,fields:[{key,label,min,max,default}]})`,
  `promptText({title, defaults:{text,size,font}})`, `filterParams(filterDef)`,
  `newDocument()` (w/h presets + bg choice), `imageSize()`, `canvasSize()`.
  All resolve with values or `null` on cancel. Esc/backdrop click = cancel.

## main.js (orchestrator writes)

Imports everything, inits in order: renderer, history wiring, toolManager + registers
all tools, ui modules, io; shows newDocument dialog on load (default 1280×800);
on `beforeunload` warn if doc has unsaved changes (skip — keep simple).

## Testing

`node --test tests/`. Only pure logic: `tests/filters.test.mjs` (each filter on a small
synthetic ImageData, assert exact pixel outcomes), `tests/blendmodes.test.mjs` (list
integrity), `tests/history.test.mjs` (SnapshotStack behavior incl. 25-cap + redo clear).
No DOM-dependent tests.
