// js/io/io.js — open/export/save/load project.
// Static imports come only from js/core; ui/dialogs.js is loaded dynamically
// on the error path only (it is built in parallel and must not be a static dep).

import { state, emit } from '../core/state.js';
import { createDocument, makeLayer, addLayer, getActiveLayer, flattenImage } from '../core/document.js';
import { history } from '../core/history.js';
import { renderer } from '../core/renderer.js';
import { createCanvas, downloadBlob } from '../core/canvasUtils.js';

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

export const io = {
  init() {
    const imageInput = document.getElementById('file-open-image');
    const projectInput = document.getElementById('file-open-project');

    if (imageInput) {
      imageInput.addEventListener('change', () => {
        const file = imageInput.files && imageInput.files[0];
        imageInput.value = ''; // re-picking the same file must fire change again
        if (file) io.openImageFile(file, openAsNewDoc);
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
    let source = flat;
    if (isJpeg) {
      // JPEG has no alpha — composite over white first.
      const { canvas, ctx } = createCanvas(flat.width, flat.height);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(flat, 0, 0);
      source = canvas;
    }

    const blob = await new Promise((resolve) => {
      source.toBlob(resolve, isJpeg ? 'image/jpeg' : 'image/png', quality);
    });
    if (!blob) {
      statusMessage('Export failed');
      return;
    }
    downloadBlob(blob, isJpeg ? 'untitled.jpg' : 'untitled.png');
    statusMessage(`Exported ${isJpeg ? 'JPEG' : 'PNG'}`);
  },

  saveProject() {
    if (!state.doc) {
      statusMessage('No document to save');
      return;
    }
    const doc = state.doc;
    const data = {
      version: PROJECT_VERSION,
      width: doc.width,
      height: doc.height,
      activeLayerId: doc.activeLayerId,
      background: doc.background,
      layers: doc.layers.map((layer) => ({
        name: layer.name,
        visible: layer.visible,
        opacity: layer.opacity,
        blendMode: layer.blendMode,
        png: layer.canvas.toDataURL('image/png'),
      })),
    };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
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
      if (
        !data ||
        data.version !== PROJECT_VERSION ||
        !Array.isArray(data.layers) ||
        typeof data.width !== 'number' ||
        typeof data.height !== 'number'
      ) {
        throw new Error('bad shape');
      }
    } catch {
      await alertError('Invalid project file');
      return;
    }

    // Decode all layer PNGs up front; layers that fail to decode are skipped.
    const decoded = await Promise.all(
      data.layers.map(async (entry) => {
        if (!entry || typeof entry.png !== 'string') return null;
        try {
          const img = await loadDataURLImage(entry.png);
          return { entry, img };
        } catch {
          return null;
        }
      })
    );

    const doc = createDocument(data.width, data.height, 'transparent');
    const layers = [];
    for (const item of decoded) {
      if (!item) continue;
      const { entry, img } = item;
      const layer = makeLayer(typeof entry.name === 'string' ? entry.name : 'Layer', doc.width, doc.height);
      layer.visible = entry.visible !== false;
      layer.opacity = Math.max(0, Math.min(1, typeof entry.opacity === 'number' ? entry.opacity : 1));
      layer.blendMode = typeof entry.blendMode === 'string' ? entry.blendMode : 'source-over';
      layer.ctx.drawImage(img, 0, 0);
      layers.push(layer);
    }
    if (layers.length === 0) {
      // Guarantee at least one layer (createDocument's base layer is already there).
      layers.push(doc.layers[0]);
    }
    doc.layers = layers;
    doc.activeLayerId = layers.some((l) => l.id === data.activeLayerId)
      ? data.activeLayerId
      : layers[layers.length - 1].id; // fallback: topmost layer
    state.doc = doc;

    history.clear();
    emit('doc:changed');
    emit('layers:changed');
    renderer.fitToScreen();
    statusMessage('Project loaded');
  },
};
