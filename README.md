# nomistakeshop

**Always Free. Good vibes only. Make no mistakes.**

A Photoshop-style raster image editor that runs entirely in the browser —
free forever, no install, no account, no tracking. Open the page, start editing.

**Live demo:** https://formless63.github.io/nomistakeshop/

The core engine is hand-written ES modules + Canvas 2D (no framework, no
build step), with best-in-class FOSS libraries vendored and lazy-loaded at
the edges (PSD, RAW, HEIC, inpainting) — see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

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
- **Smart layers** — non-destructive scale/rotate/move: pristine source is
  kept, transforms are cumulative and lossless (scale down, scale back up,
  zero quality loss), rasterize or PSD-export anytime
- **Tools** — move, rect + ellipse select, lasso, magic wand (tolerance,
  contiguous), crop, eyedropper, brush (size/hardness/opacity), eraser,
  clone stamp (aligned/non-aligned), dodge/burn (shadows/midtones/highlights),
  flood fill, gradient (linear/radial), text, shapes, hand, zoom
- **Content-aware fill** — select a region, Edit > Content-Aware Fill
  (OpenCV Telea inpainting, lazy-loaded on first use)
- **AI upscale** — Image > AI Upscale ×2/×4 (UpscalerJS super-resolution,
  runs fully in-browser)
- **Image info & palette** — Image > Image Info… (EXIF/metadata viewer),
  Extract Palette to Swatches (dominant colors into the swatch grid)
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
- **File formats** — open images, **PSD** (layers, masks, blend modes),
  **HEIC**, and **RAW** (CR2/NEF/DNG/ARW/…) via File > Open or drag & drop;
  export PNG / JPEG / WebP / **PSD** / **optimized PNG** (UPNG quantization,
  typically 70-90% smaller); save/load full layered project
  (`.nmsproject`, includes masks and adjustment layers)
- **Color** — sRGB or **Display P3** wide-gamut documents (gamut preserved
  through import → edit → export; on-screen preview is sRGB-mapped)
- **Mobile** — responsive layout at ≤800px: slide-in layers/history drawer,
  touch drawing, touch-sized tools, scrollable menus
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
npm run test:e2e   # headless-Chrome suite (31 end-to-end checks)
```

## Architecture

`js/core` (state/events, document+layers+masks, history, compositing,
renderer) · `js/tools` · `js/filters` · `js/ops` · `js/io` (files, formats,
clipboard, autosave) · `js/ui` · `vendor/` (FOSS libs, lazy-loaded) ·
`js/main.js` (boot).

## Roadmap

- **CMYK soft-proofing** via a LittleCMS WASM build — print-prep preview
- **Selection edge refinement** — marching-squares outlines, anti-aliased
  wand edges
- **AI background removal** — pending permissively-licensed model weights
  (MODNet/U²-Net via onnxruntime-web; img.ly's library is AGPL, rejected)

## External tools

The editing core (layers, masks, compositing, wand, flood fill, every filter)
is hand-written against browser APIs — that code is small, exact, and fully
test-covered, and no library does it for you. Where a file format or a hard
algorithm is the problem, we adopt battle-tested FOSS rather than reinvent it:

| Project | License | What we use it for |
|---|---|---|
| [ag-psd](https://github.com/Agamnentzar/ag-psd) | MIT | PSD import/export (vendored, lazy-loaded) |
| [heic2any](https://github.com/alexcorvi/heic2any) + [libheif](https://github.com/strukturag/libheif) | MIT / LGPL-3.0 | HEIC/HEIF import (vendored, lazy-loaded) |
| [libraw-wasm](https://github.com/ybouane/LibRaw-Wasm) + [LibRaw](https://github.com/LibRaw/LibRaw) | ISC / LGPL-2.1 | RAW import — CR2/NEF/DNG/ARW/… (vendored, lazy-loaded) |
| [OpenCV.js](https://github.com/opencv/opencv) | Apache-2.0 | Content-aware fill inpainting (vendored, lazy-loaded) |
| [UpscalerJS](https://github.com/thekevinscott/UpscalerJS) + [TensorFlow.js](https://github.com/tensorflow/tfjs) | MIT / Apache-2.0 | AI upscale ×2/×4 (vendored, lazy-loaded) |
| [exifr](https://github.com/MikeKovarik/exifr) | MIT | Image metadata viewer (vendored, lazy-loaded) |
| [color-thief](https://github.com/lokesh/color-thief) | MIT | Palette extraction (vendored, lazy-loaded) |
| [UPNG.js](https://github.com/photopea/UPNG.js) + [pako](https://github.com/nodeca/pako) | MIT | Optimized PNG export (vendored, lazy-loaded) |
| [Node.js](https://github.com/nodejs/node) | MIT | Runs the unit test runner (`node:test`) and the e2e script (dev only) |
| [puppeteer-core](https://github.com/puppeteer/puppeteer) | Apache-2.0 | Drives headless Chrome in the e2e suite (dev only) |
| [Playwright's Chromium build](https://github.com/microsoft/playwright) | Apache-2.0 | Local browser binary the e2e suite runs against (dev only) |
| [Python `http.server`](https://github.com/python/cpython) | PSF-2.0 | Local static file server (`npm start`, e2e harness) |
| [GitHub Actions](https://github.com/actions) | MIT (actions) | CI (unit + e2e on every push) and GitHub Pages deployment |

Full license texts and compliance notes: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
