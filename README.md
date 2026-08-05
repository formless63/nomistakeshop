# NoMistakeShop

A Photoshop-style raster image editor that runs entirely in the browser.
No build step, no dependencies — plain ES modules + Canvas 2D.

## Run

```sh
npm start          # serves on http://localhost:8080 (python3 -m http.server)
```

Any static file server works (`npx http-server`, nginx, …). Opening
`index.html` via `file://` will NOT work (ES modules require HTTP).

## Features

- **Layers** — add / duplicate / delete / rename, visibility, opacity,
  16 blend modes, live thumbnails, merge down, flatten
- **Layer masks** — white/black/from-selection, paint directly on the mask
  (click the mask thumbnail), enable/disable, apply or delete
- **Adjustment layers** — non-destructive filters applied to everything
  below (nearly every filter supported), re-editable any time
- **Tools** — move, rect + ellipse select, lasso, magic wand (tolerance,
  contiguous), crop, eyedropper, brush (size/hardness/opacity), eraser,
  clone stamp (aligned/non-aligned), dodge/burn (shadows/midtones/highlights),
  flood fill, gradient (linear/radial), text, shapes, hand, zoom
- **Filters** — brightness, contrast, saturation, hue rotate, hue/saturation/
  lightness, grayscale, invert, sepia, threshold, posterize, levels, curves
  (visual editor), gradient map, box blur, sharpen, noise, pixelate, emboss,
  edge detect — all selection-aware
- **Selections** — rect/ellipse/lasso/wand, invert, feather, select all/none,
  mask-based raster ops
- **Image ops** — image size, canvas size (9-anchor), rotate 90/180,
  flip canvas / layer, crop to selection, free transform layer (scale/rotate)
- **Editing** — 25-step undo/redo with clickable history panel,
  cut/copy/paste (internal + system clipboard), paste as new layer
- **File** — open image (new doc or as layer), drag & drop images onto the
  canvas, export PNG / JPEG / WebP, save/load full layered project
  (`.nmsproject`, includes masks and adjustment layers)
- **Session** — autosaves to IndexedDB every 30s; restore prompt on reload
- **View** — zoom to cursor (Ctrl+wheel), pan, fit to screen, actual pixels,
  pixel grid overlay, HiDPI-crisp rendering

## Shortcuts

`V` move · `M` rect select · `Shift+M` ellipse select · `L` lasso ·
`W` magic wand · `C` crop · `I` eyedropper · `B` brush · `E` eraser ·
`S` clone stamp · `O` dodge/burn · `G` fill · `R` gradient · `T` text ·
`U` shapes · `H` hand · `Z` zoom · `X` swap colors · `[` `]` brush size ·
`Ctrl+Z` undo · `Ctrl+Shift+Z` / `Ctrl+Y` redo · `Ctrl+A` select all ·
`Ctrl+D` deselect · `Ctrl+C/X/V` copy/cut/paste

## Tests

```sh
npm test           # unit tests (node:test — filters, history, blend modes)
npm run test:e2e   # headless-Chrome suite (24 end-to-end checks)
```

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) and [ARCHITECTURE.v2.md](ARCHITECTURE.v2.md)
— the binding module contracts. `js/core` (state/events, document+layers+masks,
history, compositing, renderer) · `js/tools` · `js/filters` · `js/ops` ·
`js/io` (files, clipboard, autosave) · `js/ui` · `js/main.js` (boot).
