// js/tools/text.js — click opens a text prompt; the result is rasterized onto
// the active layer at the click point with the primary color.
// destructive: true so toolManager pushes history on the click.

import { state, emit, getToolOption } from '../core/state.js';
import { getActiveLayer } from '../core/document.js';
import { withSelectionClip } from './selectionPath.js';

const FONT_FAMILIES = ['Arial', 'Georgia', 'Courier New', 'Times New Roman', 'Verdana', 'Impact'];

export default {
  id: 'text',
  label: 'Text',
  icon: 'T',
  cursor: 'text',
  destructive: true,
  options: [
    { key: 'fontSize', label: 'Font Size', type: 'range', min: 8, max: 400, step: 1, default: 48 },
    {
      key: 'fontFamily', label: 'Font', type: 'select', default: 'Arial',
      choices: FONT_FAMILIES.map((f) => ({ value: f, label: f })),
    },
  ],

  async onPointerDown(pt) {
    const layer = getActiveLayer();
    if (!layer || layer.type !== 'pixel') {
      emit('status:message', { text: 'Select a pixel layer' });
      return;
    }
    const size = getToolOption('text', 'fontSize', 48);
    const font = getToolOption('text', 'fontFamily', 'Arial');
    const dialogs = await import('../ui/dialogs.js');
    const res = await dialogs.promptText({
      title: 'Text',
      defaults: { text: '', size, font },
    });
    if (!res || !res.text) return;
    const ctx = layer.ctx;
    withSelectionClip(ctx, (c) => {
      c.font = `${res.size}px "${res.font}"`;
      c.fillStyle = state.primaryColor;
      c.textBaseline = 'top';
      c.textAlign = 'left';
      c.fillText(res.text, pt.x, pt.y);
    });
    emit('layer:content', { layerId: layer.id });
  },

  onPointerMove() {},
  onPointerUp() {},
};
