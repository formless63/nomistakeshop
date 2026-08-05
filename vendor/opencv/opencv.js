// ESM wrapper around the vendored @techstark/opencv-js UMD build.
// The UMD build assigns its runtime (a thenable that resolves once the
// inlined WASM is initialized) to window.cv; we await it here so importers
// get the ready-to-use cv object as the module's default export.
import './opencv.umd.js';

const cv = await window.cv;

export default cv;
