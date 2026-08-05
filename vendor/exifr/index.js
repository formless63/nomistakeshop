// vendor/exifr/index.js — ESM re-export of the exifr "full" build.
// bundle.js is dist/full.esm.mjs (exifr 7.1.3, MIT,
// https://github.com/MikeKovarik/exifr), a self-contained ESM file with no
// imports, safe to load directly in the browser.
export * from './bundle.js';
export { default } from './bundle.js';
