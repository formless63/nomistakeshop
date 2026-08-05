// vendor/upng-js/index.js — ESM wrapper around the UPNG.js + pako UMD bundles.
// upng-js 2.1.0 (MIT, https://github.com/photopea/UPNG.js) depends on pako
// (1.0.11, MIT/Zlib) at runtime: loaded as a classic script it expects
// `window.pako` to already exist and assigns the API to `window.UPNG`.
// Importing both bundles as ES modules keeps the same behavior (no `module`/
// `require` in browser ESM), then we re-export the pieces we use.
import './pako.min.js';
import './UPNG.js';

const UPNG = globalThis.UPNG;

export const encode = UPNG.encode;
export const decode = UPNG.decode;
export const toRGBA8 = UPNG.toRGBA8;
export default UPNG;
