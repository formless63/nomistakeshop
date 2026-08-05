// vendor/upscaler/index.js — ESM wrapper around the vendored UMD bundles:
// - @tensorflow/tfjs 4.11.0 (Apache-2.0) — tf.min.js sets globalThis.tf
// - upscaler 1.0.0 (MIT) — upscaler.min.js sets globalThis.Upscaler and reads
//   its deps (tf + the optional default model) off the global at load time.
// The @upscalerjs/default-model (MIT) JS is NOT vendored; only its weights
// (models/) are, and the model definition is constructed below with a
// top-level `path`, which makes UpscalerJS load the weights straight from
// this directory instead of a CDN.
import './tf.min.js';
import './upscaler.min.js';

const tf = globalThis.tf;
const Upscaler = globalThis.Upscaler;

// Mirrors getESRGANModelDefinition() from @upscalerjs/default-model 1.0.0
// (RDN branch: no custom-layer setup, 0..255 ranges), with `path` pointed at
// the vendored weights. model.json references its .bin shard relatively, so
// tfjs resolves it against this URL automatically.
export const defaultModelDefinition = {
  path: new URL('./models/model.json', import.meta.url).href,
  scale: 2,
  modelType: 'layers',
  inputRange: [0, 255],
  outputRange: [0, 255],
  meta: {
    architecture: 'rdn',
    C: 1,
    D: 2,
    G: 4,
    G0: 64,
    T: 10,
    patchSize: 128,
    size: 'slim',
    dataset: 'div2k',
  },
};

export { tf };
export default Upscaler;
