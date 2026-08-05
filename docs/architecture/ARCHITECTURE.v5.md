# ARCHITECTURE v5 Addendum — Smart Layers

Extends v1–v4. A **smart layer** stores pristine source pixels + a transform
and is re-rendered by the composite pipeline on every frame — scale/rotate/move
never degrades the image, and transforms are re-editable forever. This is the
Photoshop smart-object analogue.

## Layer shape v3

```js
{ id, type: 'smart', name, visible, opacity, blendMode,
  source,                       // canvas holding ORIGINAL pixels (doc-sized for converted layers)
  transform: { scaleX: 1, scaleY: 1, rotateDeg: 0, offsetX: 0, offsetY: 0 },
  mask: null | { canvas, ctx, enabled } }
```

## composite.js (core agent)

NEW export `renderSmartLayer(layer, w, h)` -> canvas:
- temp = createCanvas(w, h)
- ctx.translate(w/2 + t.offsetX, h/2 + t.offsetY); ctx.rotate(t.rotateDeg * PI/180);
  ctx.scale(t.scaleX, t.scaleY); ctx.imageSmoothingEnabled = true;
  ctx.drawImage(layer.source, -layer.source.width/2, -layer.source.height/2)
- Identity transform + doc-sized source must render byte-identical to the source.

`compositeLayers` handles `type:'smart'`: renderSmartLayer → if mask && mask.enabled,
'destination-in' the mask on the temp canvas (same as pixel path) → composite with
globalAlpha/globalCompositeOperation exactly like pixel layers.

## document.js (core agent)

- `convertToSmartLayer(id)` — active layer must be pixel; history.push('Convert to
  Smart Layer'); replace the layer object in place (KEEP id/name/visible/opacity/
  blendMode/mask) with type:'smart', source: the layer's existing canvas (adopt, don't
  clone), transform: identity; drop canvas/ctx. Emits 'layers:changed' + 'layer:content'.
- `rasterizeSmartLayer(id)` — smart only; history.push('Rasterize Layer'); render via
  renderSmartLayer(layer, doc.width, doc.height) → becomes type:'pixel' with that
  canvas/ctx (mask kept); drop source/transform. Emits both events.
- `setSmartTransform(id, partial)` — merge partial into layer.transform; emit
  'layer:content' + 'layers:changed'. Does NOT push history (callers do).
- `duplicateLayer` — smart: clone source canvas, deep-copy transform, clone mask.
- `getPaintTarget()` — returns null for smart layers (paint tools already guard with
  'Select a pixel layer').
- `mergeDown` — no-op + status message if EITHER layer is smart or adjustment.
- `flattenImage` — unchanged (composite.js does the work).

## history.js (core agent)

Snapshot/restore type:'smart': clone source canvas, JSON-deep-copy transform,
mask handled exactly like pixel layers. Restore rebuilds the same shape.

## transform.js (core agent)

- `transformActiveLayer(vals)`: if active layer is smart → history.push('Transform
  Layer'); setSmartTransform(id, { scaleX: cur.scaleX * scaleXPct/100, scaleY: same,
  rotateDeg: cur.rotateDeg + rotateDeg }) (multiplicative/additive — re-editing is
  cumulative, quality never degrades). Pixel layers: existing destructive behavior.
- Doc-wide ops (`rebuildLayers` users: rotate/flip/resize/crop): RASTERIZE smart
  layers first (renderSmartLayer → they become pixel layers via the same swap as
  rasterizeSmartLayer, but WITHOUT individual history pushes — the outer op's single
  history.push covers it) and emit ONE status:message if any were rasterized
  ('N smart layer(s) rasterized by <op>').

## move.js (core agent)

If the active layer is smart: pointerdown snapshots transform; drag updates
offsetX/offsetY = snapshot + integer delta via setSmartTransform. The existing
destructive history.push('Move') on stroke start covers undo. Pixel behavior
unchanged. Adjustment layers: existing no-op.

## io.js (io agent)

- serializeProject: smart layers → `{type:'smart', name, visible, opacity, blendMode,
  sourcePng: source.toDataURL('image/png'), transform: {...}, maskPng, maskEnabled}`.
- loadProjectData: rebuild smart layers (decode sourcePng, restore transform + mask),
  order/activeLayerId preserved, same patterns as v2/v3.

## psd.js (io agent)

Export: smart layers → renderSmartLayer to a doc-size canvas and export as a normal
PSD pixel layer (props + mask preserved). Count + status:message if any were
rasterized for export. Import: unchanged.

## layersPanel.js + menuBar.js (orchestrator)

- Smart rows: thumbnail renders layer.source; small '✦' badge. Mask thumbnails work
  as for pixel layers (composite applies masks to smart layers).
- Layer menu: 'Convert to Smart Layer' (enabled: active pixel layer),
  'Rasterize Smart Layer' (enabled: active smart layer).

## Tests (e2e agent)

- Non-destructive guarantee: pattern → convert → scale 25% then 400% → composite
  equals the ORIGINAL render (byte-near), and layer.source pixels untouched.
- Move tool drags a smart layer's rendered position; undo restores.
- Save/load project round trip preserves type/transform/render.
- Rasterize produces a pixel layer whose pixels equal the pre-rasterize render.
- PSD export of a doc with a smart layer succeeds (rasterized in the PSD).
