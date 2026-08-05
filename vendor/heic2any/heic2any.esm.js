import "./heic2any.umd.js";

// heic2any ships as a UMD bundle (libheif WASM embedded) that assigns to the
// global object; re-export it as an ES module default.
export default globalThis.heic2any;
