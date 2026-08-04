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

- **Layers** — add / duplicate / delete / rename / reorder-ready model,
  visibility, opacity, 16 blend modes, live thumbnails, merge down, flatten
- **Tools** — move, rectangular select, lasso, crop, eyedropper, brush
  (size/hardness/opacity), eraser, flood fill (tolerance), gradient
  (linear/radial), text, shapes (rect/ellipse/line, fill or stroke), hand, zoom
- **Filters** — brightness, contrast, saturation, hue rotate, grayscale,
  invert, sepia, threshold, posterize, box blur, sharpen, noise, pixelate,
  emboss, edge detect
- **Image ops** — image size, canvas size (9-anchor), rotate 90/180,
  flip canvas / layer, crop to selection
- **Editing** — 25-step undo/redo (Ctrl+Z / Ctrl+Shift+Z), select all /
  deselect, keyboard shortcuts for every tool
- **File** — open image (new doc or as layer), export PNG/JPEG,
  save/load full layered project (`.nmsproject` JSON)
- **View** — zoom to cursor (Ctrl+wheel), pan (wheel / hand tool),
  fit to screen, actual pixels, HiDPI-crisp rendering

## Shortcuts

`V` move · `M` rect select · `L` lasso · `C` crop · `I` eyedropper ·
`B` brush · `E` eraser · `G` fill · `R` gradient · `T` text · `U` shapes ·
`H` hand · `Z` zoom · `X` swap colors · `[` `]` brush size ·
`Ctrl+Z` undo · `Ctrl+Shift+Z` / `Ctrl+Y` redo · `Ctrl+A` select all ·
`Ctrl+D` deselect

## Tests

```sh
npm test           # unit tests (node:test — filters, history, blend modes)
npm run test:e2e   # headless-Chrome smoke suite (14 end-to-end checks)
```

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) — the binding module contract.
`js/core` (state/events, document+layers, history, renderer) ·
`js/tools` · `js/filters` · `js/ops` · `js/io` · `js/ui` · `js/main.js` (boot).
