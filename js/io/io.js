// js/io/io.js — open/export/save/load project.
// Static imports come only from js/core; ui/dialogs.js is loaded dynamically
// on the error path only (it is built in parallel and must not be a static dep).
// io must NOT import clipboard.js / autosave.js (they import io — no cycles).

import { state, emit } from '../core/state.js';
import {
  createDocument,
  makeLayer,
  addLayer,
  addAdjustmentLayer,
  getActiveLayer,
  flattenImage,
} from '../core/document.js';
import { history } from '../core/history.js';
import { renderer } from '../core/renderer.js';
import { createCanvas, downloadBlob, clamp } from '../core/canvasUtils.js';

const PROJECT_VERSION = 1;

// Transient mode flag: does a pick on #file-open-image mean "new doc" or "as layer"?
let openAsNewDoc = true;

function statusMessage(text) {
  emit('status:message', { text });
}

async function alertError(msg) {
  try {
    const { dialogs } = await import('../ui/dialogs.js');
    await dialogs.alert(msg);
  } catch {
    // dialogs.js unavailable (or alert itself failed) — fall back to status bar.
    statusMessage(msg);
  }
}

// Decode a File to something drawable: ImageBitmap when available,
// object-URL + HTMLImageElement as fallback. The returned closer releases
// resources (bmp.close() / URL.revokeObjectURL); call it when done.
async function decodeFile(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file);
      return {
        source: bmp,
        width: bmp.width,
        height: bmp.height,
        close() {
          if (typeof bmp.close === 'function') bmp.close();
        },
      };
    } catch {
      // fall through to the Image fallback below
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error(`Could not decode image: ${file.name}`));
      el.src = url;
    });
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      close() {
        URL.revokeObjectURL(url);
      },
    };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

// Load one project layer entry (with a png dataURL) into an Image.
function loadDataURLImage(png) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Layer image failed to decode'));
    img.src = png;
  });
}

// True when the paste event target is a text field or inside a modal dialog —
// in that case the browser's own paste behavior must win.
function isTextEntryTarget() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    el.isContentEditable ||
    !!(el.closest && el.closest('.dialog-overlay'))
  );
}

export const io = {
  init() {
    const imageInput = document.getElementById('file-open-image');
    const projectInput = document.getElementById('file-open-project');

    if (imageInput) {
      imageInput.addEventListener('change', () => {
        const file = imageInput.files && imageInput.files[0];
        imageInput.value = ''; // re-picking the same file must fire change again
        // Route by extension: .psd/.heic/.raw formats get their decoders,
        // plain images take the standard path. Dynamic import avoids a
        // module cycle (formats.js dynamically imports this module).
        if (file) import('./formats.js').then((m) => m.openByExtension(file, openAsNewDoc));
      });
    }
    if (projectInput) {
      projectInput.addEventListener('change', () => {
        const file = projectInput.files && projectInput.files[0];
        projectInput.value = '';
        if (file) io.loadProjectFile(file);
      });
    }
  },

  // Drag & drop onto the viewport: images/PSD/HEIC/RAW open via the format
  // router (as new layers), .nmsproject files load as projects.
  initDragDrop() {
    const viewport = document.getElementById('viewport');
    if (!viewport) return;
    const allowDrop = (e) => {
      e.preventDefault(); // required, otherwise 'drop' never fires
    };
    viewport.addEventListener('dragover', allowDrop);
    viewport.addEventListener('dragenter', allowDrop);
    viewport.addEventListener('drop', (e) => {
      e.preventDefault();
      const files = e.dataTransfer && e.dataTransfer.files;
      if (!files) return;
      for (const file of files) {
        if (/\.nmsproject$/i.test(file.name || '')) {
          io.loadProjectFile(file);
        } else {
          import('./formats.js')
            .then((m) => m.openByExtension(file, false))
            .then(() => statusMessage('Added dropped file as layer'))
            .catch(() => alertError(`Could not open dropped file: ${file.name}`));
        }
      }
    });
  },

  // Paste an image straight from the system clipboard as a new layer.
  initPaste() {
    window.addEventListener('paste', (e) => {
      if (!state.doc || isTextEntryTarget()) return;
      const data = e.clipboardData;
      if (!data || !data.items) return;
      let item = null;
      for (const it of data.items) {
        if (it.kind === 'file' && it.type.startsWith('image/')) {
          item = it;
          break;
        }
      }
      if (!item) return;
      const file = item.getAsFile();
      if (!file) return;
      e.preventDefault(); // only once we know we handle it
      (async () => {
        try {
          const bmp = await createImageBitmap(file);
          const { canvas, ctx } = createCanvas(bmp.width, bmp.height);
          ctx.drawImage(bmp, 0, 0);
          if (typeof bmp.close === 'function') bmp.close();
          addLayer('Pasted', canvas); // pushes its own history + emits layers:changed
          emit('layer:content');
          statusMessage('Pasted as new layer');
        } catch {
          await alertError('Could not paste clipboard image');
        }
      })();
    });
  },

  openImageDialog() {
    openAsNewDoc = true;
    const input = document.getElementById('file-open-image');
    if (input) input.click();
  },

  openImageAsLayerDialog() {
    openAsNewDoc = false;
    const input = document.getElementById('file-open-image');
    if (input) input.click();
  },

  async openImageFile(file, asNewDoc) {
    let decoded;
    try {
      decoded = await decodeFile(file);
    } catch (err) {
      await alertError(err.message || 'Could not open image');
      return;
    }
    try {
      if (asNewDoc) {
        createDocument(decoded.width, decoded.height, 'transparent');
        // Push AFTER createDocument (which clears history) so undo restores the blank doc.
        history.push('Open Image');
        const base = getActiveLayer();
        if (base) {
          base.ctx.drawImage(decoded.source, 0, 0);
          emit('layer:content', { layerId: base.id });
        }
      } else {
        if (!state.doc) {
          statusMessage('No document open — use Open Image to start one');
          return;
        }
        // addLayer draws fillCanvas at 0,0 and only supports canvas sources,
        // so stamp the decoded bitmap onto a temp canvas first.
        const { canvas, ctx } = createCanvas(decoded.width, decoded.height);
        ctx.drawImage(decoded.source, 0, 0);
        addLayer(file.name, canvas); // pushes its own history + emits layers:changed
        emit('layer:content');
      }
      renderer.fitToScreen();
    } finally {
      decoded.close();
    }
  },

  async exportImage(format = 'png', quality = 0.92) {
    if (!state.doc) {
      statusMessage('No document to export');
      return;
    }
    const flat = flattenImage();
    if (!flat) return;

    const isJpeg = format === 'jpeg' || format === 'jpg';
    const isWebp = format === 'webp';
    const mime = isJpeg ? 'image/jpeg' : isWebp ? 'image/webp' : 'image/png';
    const ext = isJpeg ? 'jpg' : isWebp ? 'webp' : 'png';
    const label = isJpeg ? 'JPEG' : isWebp ? 'WebP' : 'PNG';

    let source = flat;
    if (isJpeg) {
      // JPEG has no alpha — composite over white first (WebP keeps alpha).
      const { canvas, ctx } = createCanvas(flat.width, flat.height);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(flat, 0, 0);
      source = canvas;
    }

    const blob = await new Promise((resolve) => {
      source.toBlob(resolve, mime, quality);
    });
    if (!blob) {
      statusMessage('Export failed');
      return;
    }
    downloadBlob(blob, `untitled.${ext}`);
    statusMessage(`Exported ${label}`);
  },

  // Serialize the current document to a plain JSON-safe object.
  // Handles both v2 layer kinds: pixel layers carry png/maskPng dataURLs,
  // adjustment layers carry their {filterId, params} adjustment.
  serializeProject() {
    const doc = state.doc;
    if (!doc) return null;
    return {
      version: PROJECT_VERSION,
      width: doc.width,
      height: doc.height,
      activeLayerId: doc.activeLayerId,
      background: doc.background,
      colorSpace: doc.colorSpace || 'srgb',
      layers: doc.layers.map((layer) => {
        if (layer.type === 'adjustment') {
          return {
            type: 'adjustment',
            name: layer.name,
            visible: layer.visible,
            opacity: layer.opacity,
            blendMode: layer.blendMode,
            adjustment: {
              filterId: layer.adjustment.filterId,
              params: layer.adjustment.params == null
                ? layer.adjustment.params
                : JSON.parse(JSON.stringify(layer.adjustment.params)),
            },
          };
        }
        return {
          type: 'pixel',
          name: layer.name,
          visible: layer.visible,
          opacity: layer.opacity,
          blendMode: layer.blendMode,
          png: layer.canvas.toDataURL('image/png'),
          maskPng: layer.mask ? layer.mask.canvas.toDataURL('image/png') : null,
          maskEnabled: layer.mask ? layer.mask.enabled !== false : true,
        };
      }),
    };
  },

  saveProject() {
    if (!state.doc) {
      statusMessage('No document to save');
      return;
    }
    const blob = new Blob([JSON.stringify(io.serializeProject())], { type: 'application/json' });
    downloadBlob(blob, 'untitled.nmsproject');
    statusMessage('Project saved');
  },

  loadProjectDialog() {
    const input = document.getElementById('file-open-project');
    if (input) input.click();
  },

  async loadProjectFile(file) {
    let data;
    try {
      const text = await file.text();
      data = JSON.parse(text);
    } catch {
      await alertError('Invalid project file');
      return;
    }
    await io.loadProjectData(data);
  },

  // Rebuild a document from a serialized project object (see serializeProject).
  // Malformed layer entries are skipped; the load only fails when the
  // top-level shape is invalid. Returns true on success.
  async loadProjectData(data) {
    if (
      !data ||
      data.version !== PROJECT_VERSION ||
      !Array.isArray(data.layers) ||
      typeof data.width !== 'number' ||
      typeof data.height !== 'number'
    ) {
      await alertError('Invalid project file');
      return false;
    }

    // Decode everything up front; entries that fail to decode are skipped.
    const decoded = await Promise.all(
      data.layers.map(async (entry) => {
        if (!entry || typeof entry !== 'object') return null;
        if (entry.type === 'adjustment') {
          const adj = entry.adjustment;
          if (!adj || typeof adj.filterId !== 'string') return null;
          return { entry };
        }
        // Pixel layer (a missing type means a v1-format pixel entry).
        if (typeof entry.png !== 'string') return null;
        try {
          const img = await loadDataURLImage(entry.png);
          let maskImg = null;
          if (typeof entry.maskPng === 'string') {
            try {
              maskImg = await loadDataURLImage(entry.maskPng);
            } catch {
              maskImg = null; // a broken mask must not sink the whole layer
            }
          }
          return { entry, img, maskImg };
        } catch {
          return null;
        }
      })
    );

    const doc = createDocument(data.width, data.height, 'transparent');
    if (data.background === 'transparent' || data.background === '#ffffff') {
      doc.background = data.background;
    }
    doc.colorSpace = data.colorSpace === 'display-p3' ? 'display-p3' : 'srgb';
    const layers = [];
    for (const item of decoded) {
      if (!item) continue;
      const { entry } = item;
      if (entry.type === 'adjustment') {
        // addAdjustmentLayer pushes history, but loadProjectData ends with
        // history.clear() anyway — and the layers array is rebuilt in
        // serialized order below, so insertion position does not matter.
        const layer = addAdjustmentLayer(
          entry.adjustment.filterId,
          entry.adjustment.params,
          typeof entry.name === 'string' ? entry.name : null,
        );
        if (!layer) continue;
        layer.visible = entry.visible !== false;
        layer.opacity = clamp(typeof entry.opacity === 'number' ? entry.opacity : 1, 0, 1);
        layer.blendMode = typeof entry.blendMode === 'string' ? entry.blendMode : 'source-over';
        layers.push(layer);
      } else {
        const layer = makeLayer(
          typeof entry.name === 'string' ? entry.name : 'Layer',
          doc.width,
          doc.height,
        );
        layer.visible = entry.visible !== false;
        layer.opacity = clamp(typeof entry.opacity === 'number' ? entry.opacity : 1, 0, 1);
        layer.blendMode = typeof entry.blendMode === 'string' ? entry.blendMode : 'source-over';
        layer.ctx.drawImage(item.img, 0, 0);
        if (item.maskImg) {
          const mask = createCanvas(doc.width, doc.height);
          mask.ctx.drawImage(item.maskImg, 0, 0);
          layer.mask = { canvas: mask.canvas, ctx: mask.ctx, enabled: entry.maskEnabled !== false };
        }
        layers.push(layer);
      }
    }
    if (layers.length === 0) {
      // Guarantee at least one layer (createDocument's base layer is already there).
      layers.push(doc.layers[0]);
    }
    doc.layers = layers; // index 0 = bottom, matching the serialized array
    doc.activeLayerId = layers.some((l) => l.id === data.activeLayerId)
      ? data.activeLayerId
      : layers[layers.length - 1].id; // fallback: topmost layer
    state.doc = doc;

    history.clear();
    emit('doc:changed');
    emit('layers:changed');
    renderer.fitToScreen();
    statusMessage('Project loaded');
    return true;
  },
};
