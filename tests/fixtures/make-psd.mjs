// tests/fixtures/make-psd.mjs — generates tests/fixtures/two-layer.psd using
// the vendored ag-psd build. Run: node tests/fixtures/make-psd.mjs
//
// Uses the imageData path (no canvas in Node): writePsd accepts
// layer.imageData = { data, width, height } in place of layer.canvas, and
// readPsd({ useImageData: true }) returns imageData the same way.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPsd, writePsd } from '../../vendor/ag-psd/index.js';

const W = 8;
const H = 8;

function solidImageData(w, h, r, g, b, a = 255) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = a;
  }
  return { data, width: w, height: h };
}

// Bottom layer first (children[0] = BOTTOM in ag-psd), top layer multiply.
// Blend modes are ag-psd's long names; opacity is 0..1; visibility is `hidden`.
const psd = {
  width: W,
  height: H,
  children: [
    {
      name: 'Bottom Red',
      imageData: solidImageData(W, H, 200, 30, 30),
      blendMode: 'normal',
      opacity: 1,
    },
    {
      name: 'Top Multiply Blue',
      imageData: solidImageData(W, H, 30, 30, 200),
      blendMode: 'multiply',
      opacity: 1,
    },
  ],
};

const buffer = writePsd(psd);
const outPath = join(dirname(fileURLToPath(import.meta.url)), 'two-layer.psd');
writeFileSync(outPath, Buffer.from(buffer));
console.log(`wrote ${outPath} (${buffer.byteLength} bytes)`);

// Verify the round trip and record the empirical facts.
const back = readPsd(buffer, { useImageData: true });
console.log('size:', back.width, 'x', back.height);
for (const [i, child] of (back.children || []).entries()) {
  console.log(
    `child[${i}] name=${JSON.stringify(child.name)} blendMode=${child.blendMode}` +
      ` opacity=${child.opacity} visible=${child.visible} hasImageData=${!!child.imageData}` +
      ` hasCanvas=${!!child.canvas} mask=${JSON.stringify(child.mask ?? null)}`,
  );
}
