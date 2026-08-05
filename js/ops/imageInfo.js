// js/ops/imageInfo.js — document info dialog (EXIF via vendored exifr, MIT,
// see vendor/exifr/) and palette extraction into the color panel presets
// (vendored colorthief, MIT, see vendor/color-thief/). Both libraries are
// lazy-loaded via cached dynamic imports. All DOM access happens inside
// functions, so importing this module in Node is safe.

import { state, emit, setColor } from '../core/state.js';
import { flattenImage } from '../core/document.js';

let exifrPromise = null;
let colorThiefPromise = null;

function loadExifr() {
  if (!exifrPromise) exifrPromise = import('../../vendor/exifr/index.js');
  return exifrPromise;
}

function loadColorThief() {
  if (!colorThiefPromise) colorThiefPromise = import('../../vendor/color-thief/index.js');
  return colorThiefPromise;
}

// --- Image Info -------------------------------------------------------------

const EXIF_ROWS = [
  ['Make', 'Camera make'],
  ['Model', 'Camera model'],
  ['LensModel', 'Lens'],
  ['ExposureTime', 'Exposure'],
  ['FNumber', 'Aperture'],
  ['ISO', 'ISO'],
  ['DateTimeOriginal', 'Taken'],
  ['GPSLatitude', 'GPS latitude'],
  ['GPSLongitude', 'GPS longitude'],
];

function formatExifValue(key, value) {
  if (value instanceof Date) return value.toLocaleString();
  if (key === 'ExposureTime' && typeof value === 'number' && value < 1) {
    return `1/${Math.round(1 / value)} s`;
  }
  if (key === 'FNumber' && typeof value === 'number') return `f/${value}`;
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

// Read-only info modal. Mirrors the openDialog structure/classes from
// js/ui/dialogs.js (overlay + card form + title/body/footer, backdrop click
// and Esc cancel, OK submits) without depending on its internals.
function showInfoDialog(title, rows) {
  const root = document.getElementById('dialog-root');
  if (!root) return Promise.resolve();
  root.innerHTML = '';

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    const card = document.createElement('form');
    card.className = 'dialog-card';
    card.setAttribute('role', 'dialog');
    card.noValidate = true;

    const titleEl = document.createElement('div');
    titleEl.className = 'dialog-title';
    titleEl.textContent = title;
    card.append(titleEl);

    const body = document.createElement('div');
    body.className = 'dialog-body';
    for (const [label, value] of rows) {
      const row = document.createElement('div');
      row.className = 'dialog-field';
      const labelEl = document.createElement('span');
      labelEl.className = 'dialog-field-label';
      labelEl.textContent = label;
      const valueEl = document.createElement('span');
      valueEl.textContent = value;
      row.append(labelEl, valueEl);
      body.append(row);
    }
    card.append(body);

    const footer = document.createElement('div');
    footer.className = 'dialog-footer';
    const ok = document.createElement('button');
    ok.className = 'dialog-button primary';
    ok.type = 'submit';
    ok.textContent = 'OK';
    footer.append(ok);
    card.append(footer);

    overlay.append(card);
    root.append(overlay);

    function finish() {
      window.removeEventListener('keydown', onKey, true);
      overlay.remove();
      resolve();
    }

    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        finish();
      }
    };

    overlay.addEventListener('pointerdown', (e) => {
      if (e.target === overlay) finish();
    });
    card.addEventListener('submit', (e) => {
      e.preventDefault();
      finish();
    });
    window.addEventListener('keydown', onKey, true);
  });
}

function canvasToBlob(canvas) {
  if (canvas.convertToBlob) return canvas.convertToBlob({ type: 'image/png' });
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

// Shows a modal with document dimensions, color space, layer count and any
// embedded EXIF metadata. When `file` is given (open/drop paths) it is parsed
// directly; otherwise the current composite is re-serialized and parsed.
export async function showImageInfo(file = null) {
  if (!file && !state.doc) {
    emit('status:message', { text: 'No document open' });
    return;
  }

  let exif = null;
  try {
    const exifr = await loadExifr();
    const input = file || (await canvasToBlob(flattenImage()));
    exif = await exifr.parse(input, {
      pick: EXIF_ROWS.map(([key]) => key),
    });
  } catch {
    exif = null; // unparseable input — fall through to 'No embedded metadata'
  }

  const doc = state.doc;
  const rows = [];
  if (doc) {
    rows.push(['Dimensions', `${doc.width} × ${doc.height} px`]);
    rows.push(['Color space', doc.colorSpace === 'display-p3' ? 'Display P3' : 'sRGB']);
    rows.push(['Layers', String(doc.layers.length)]);
  }
  if (file) rows.push(['File', file.name]);
  if (exif) {
    for (const [key, label] of EXIF_ROWS) {
      if (exif[key] !== undefined && exif[key] !== null && exif[key] !== '') {
        rows.push([label, formatExifValue(key, exif[key])]);
      }
    }
  } else {
    rows.push(['Metadata', 'No embedded metadata']);
  }

  await showInfoDialog('Image Info', rows);
}

// --- Palette extraction -----------------------------------------------------

// Extracts `count` dominant colors from the flattened composite and replaces
// the preset swatch grid in #color-panel (click = primary, alt-click /
// right-click = secondary — same behavior as js/ui/colorPanel.js presets).
export async function extractPalette(count = 8) {
  if (!state.doc) {
    emit('status:message', { text: 'No document open' });
    return;
  }
  const grid = document.querySelector('#color-panel .color-presets');
  if (!grid) {
    emit('status:message', { text: 'Color panel not available' });
    return;
  }

  const flat = flattenImage();
  if (!flat) return;

  // Scale down to max 200px on the long side for fast, stable quantization.
  const scale = Math.min(1, 200 / Math.max(flat.width, flat.height));
  const w = Math.max(1, Math.round(flat.width * scale));
  const h = Math.max(1, Math.round(flat.height * scale));
  const temp = document.createElement('canvas');
  temp.width = w;
  temp.height = h;
  const ctx = temp.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(flat, 0, 0, w, h);

  const colorThief = await loadColorThief();
  const colorCount = Math.max(2, Math.min(20, Math.round(count)));
  const colors = (await colorThief.getPalette(temp, { colorCount })) || [];
  const hexes = colors.map((c) => c.hex());

  if (hexes.length === 0) {
    emit('status:message', { text: 'No colors found' });
    return;
  }

  grid.replaceChildren(
    ...hexes.map((hex) => {
      const swatch = document.createElement('button');
      swatch.className = 'color-preset';
      swatch.type = 'button';
      swatch.style.background = hex;
      swatch.title = hex;
      swatch.addEventListener('click', (e) => {
        setColor(e.altKey ? 'secondary' : 'primary', hex);
      });
      swatch.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        setColor('secondary', hex);
      });
      return swatch;
    }),
  );

  emit('status:message', { text: 'Palette extracted' });
}
