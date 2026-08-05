# nomistakeshop

**Always Free. Good vibes only. Make no mistakes.**

A Photoshop-style raster image editor that runs entirely in the browser —
free forever, no install, no account, no tracking. Open the page, start editing.

**Live demo:** https://formless63.github.io/nomistakeshop/

The core engine is hand-written ES modules + Canvas 2D (no framework, no
build step), with best-in-class FOSS libraries vendored at the edges where a
spec matters more than our own code (see the roadmap: PSD via ag-psd, RAW via
LibRaw-wasm).

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

## Roadmap

- **PSD import/export** via [ag-psd](https://github.com/Agamnentzar/ag-psd)
  (MIT) — real layered PSD round-trips, vendored and lazy-loaded
- **RAW import** (CR2/NEF/DNG/…) via a LibRaw/dcraw WASM build — lazy-loaded
- **HEIC import** via [heic2any](https://github.com/alexcorvi/heic2any) /
  libheif-wasm
- **Content-aware fill / inpaint** via [OpenCV.js](https://github.com/opencv/opencv)
  (Apache-2.0, Telea inpainting)
- **Wide-gamut (Display-P3) canvas support** via native Canvas 2D color spaces

## External tools

The editing core (layers, masks, compositing, wand, flood fill, every filter)
is hand-written against browser APIs — deliberately: that code IS the product,
it's small, exact, and fully test-covered, and no library does it for you.
Where a file format or a hard algorithm is the problem (PSD, RAW, HEIC,
inpaint), we adopt battle-tested FOSS rather than reinvent it — see the
roadmap below. Tooling used to develop and test nomistakeshop:

| Project | License | What we use it for |
|---|---|---|
| [Node.js](https://github.com/nodejs/node) | MIT | Runs the unit test runner (`node:test`) and the e2e script |
| [puppeteer-core](https://github.com/puppeteer/puppeteer) | Apache-2.0 | Drives headless Chrome in the e2e suite (dev dependency) |
| [Playwright's Chromium build](https://github.com/microsoft/playwright) | Apache-2.0 | Local browser binary the e2e suite runs against |
| [Python `http.server`](https://github.com/python/cpython) | PSF-2.0 | Local static file server (`npm start`, e2e harness) |
| [GitHub Actions](https://github.com/actions) | MIT (actions) | CI (unit + e2e on every push) and GitHub Pages deployment |
