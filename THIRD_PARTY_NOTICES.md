# Third-Party Notices

nomistakeshop's editing core (layers, masks, compositing, tools, filters) is
hand-written and contains no third-party runtime code. The following FOSS
libraries are vendored under `vendor/` and **lazy-loaded only when their
feature is used**. Each `vendor/<name>/` directory contains the full license
text and a VERSION file with the exact version and upstream URL.

| Library | Version | License | Used for |
|---|---|---|---|
| [ag-psd](https://github.com/Agamnentzar/ag-psd) | 31.0.2 | MIT | PSD import/export (`vendor/ag-psd/`) |
| [heic2any](https://github.com/alexcorvi/heic2any) | 0.0.4 | MIT | HEIC/HEIF decoding (`vendor/heic2any/`) |
| [libheif](https://github.com/strukturag/libheif) (bundled inside heic2any) | — | LGPL-3.0 | HEIC decode backend; loaded dynamically, unmodified |
| [libraw-wasm](https://github.com/ybouane/LibRaw-Wasm) | 1.6.0 | ISC | RAW file decoding (`vendor/libraw-wasm/`) |
| [LibRaw](https://github.com/LibRaw/LibRaw) (compiled into libraw-wasm) | — | LGPL-2.1 | RAW decode backend; loaded dynamically, unmodified |
| [OpenCV.js](https://github.com/opencv/opencv) via [@techstark/opencv-js](https://www.npmjs.com/package/@techstark/opencv-js) | 5.0.0-release.1 | Apache-2.0 | Content-aware fill / inpainting (`vendor/opencv/`) |
| [exifr](https://github.com/MikeKovarik/exifr) | 7.1.3 | MIT | EXIF/metadata viewer (`vendor/exifr/`) |
| [color-thief](https://github.com/lokesh/color-thief) | 3.5.0 | MIT | Palette extraction (`vendor/color-thief/`) |
| [upng-js](https://github.com/photopea/UPNG.js) + [pako](https://github.com/nodeca/pako) | 2.1.0 / 1.0.11 | MIT | Optimized PNG export (`vendor/upng-js/`) |
| [UpscalerJS](https://github.com/thekevinscott/UpscalerJS) + default model | 1.0.0 | MIT | AI upscale ×2/×4 (`vendor/upscaler/`, model weights vendored) |
| [TensorFlow.js](https://github.com/tensorflow/tfjs) | 4.11.0 | Apache-2.0 | UpscalerJS inference backend (`vendor/upscaler/`) |

Rejected on license grounds: **@imgly/background-removal** (AI background
removal) is AGPL-3.0, incompatible with this project's licensing — the
feature was dropped at the vendor gate rather than shipped.

## License-compliance notes

- **MIT / ISC / Apache-2.0** — license texts are vendored next to the code as
  required by their terms.
- **LGPL-2.1 / LGPL-3.0** (LibRaw, libheif) — used as dynamically loaded,
  unmodified libraries. They are not statically linked into application code;
  each is a separate, swappable module under `vendor/`, satisfying the LGPL
  "replacement" requirement (users can drop in a modified build of either
  library and the app will use it). Corresponding-source offers are satisfied
  by the upstream links above.
- Development-only tooling (Node.js, puppeteer, Playwright's Chromium build,
  Python http.server) is not distributed with the app.
