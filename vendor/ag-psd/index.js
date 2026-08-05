// vendor/ag-psd/index.js — ESM wrapper around the ag-psd UMD bundle.
// The bundle (ag-psd 31.0.2, MIT, https://github.com/Agamnentzar/ag-psd) is
// UMD-only; loaded as a module it assigns the API to `globalThis.agPsd`
// (window in the browser, global in Node). Re-export the pieces we use.
import * as bundleNs from './bundle.js';

// UMD sets a global when it runs as a classic module script; if Node's module
// detection instead executed it as CommonJS, the API is the default export.
const agPsd = globalThis.agPsd || bundleNs.default || bundleNs;

// In the browser ag-psd auto-initializes its canvas factory from
// document.createElement. Outside the browser (Node tests) there is no
// document, so install an ImageData-only shim: readPsd({useImageData:true})
// and writePsd work with plain {data,width,height} objects instead of canvases.
if (typeof document === 'undefined') {
  agPsd.initializeCanvas(
    () => {
      throw new Error('ag-psd: HTMLCanvasElement is unavailable outside the browser');
    },
    (width, height) => ({ data: new Uint8ClampedArray(width * height * 4), width, height }),
  );
}

export const readPsd = agPsd.readPsd;
export const writePsd = agPsd.writePsd;
export const writePsdUint8Array = agPsd.writePsdUint8Array;
export const initializeCanvas = agPsd.initializeCanvas;
export default agPsd;
