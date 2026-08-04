// Pure pixel operations on ImageData-like objects {data: Uint8ClampedArray, width, height}.
// No DOM access — safe to run in Node. Every function mutates-and-returns imageData
// and is total: all params are clamped to sane ranges before use.

function num(v, min, max, def) {
  v = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(v)) v = def;
  return Math.min(max, Math.max(min, v));
}

const LUMA_R = 0.299;
const LUMA_G = 0.587;
const LUMA_B = 0.114;

export function brightness(imageData, v = 0) {
  const d = imageData.data;
  const delta = Math.round((num(v, -100, 100, 0) * 255) / 100);
  for (let i = 0; i < d.length; i += 4) {
    d[i] += delta;
    d[i + 1] += delta;
    d[i + 2] += delta;
  }
  return imageData;
}

export function contrast(imageData, v = 0) {
  const d = imageData.data;
  // Map -100..100 to -255..255, then apply the standard contrast factor.
  const c = (num(v, -100, 100, 0) * 255) / 100;
  const factor = (259 * (c + 255)) / (255 * (259 - c));
  for (let i = 0; i < d.length; i += 4) {
    d[i] = factor * (d[i] - 128) + 128;
    d[i + 1] = factor * (d[i + 1] - 128) + 128;
    d[i + 2] = factor * (d[i + 2] - 128) + 128;
  }
  return imageData;
}

export function saturation(imageData, v = 0) {
  const d = imageData.data;
  const factor = 1 + num(v, -100, 100, 0) / 100;
  for (let i = 0; i < d.length; i += 4) {
    const luma = LUMA_R * d[i] + LUMA_G * d[i + 1] + LUMA_B * d[i + 2];
    d[i] = luma + (d[i] - luma) * factor;
    d[i + 1] = luma + (d[i + 1] - luma) * factor;
    d[i + 2] = luma + (d[i + 2] - luma) * factor;
  }
  return imageData;
}

export function hueRotate(imageData, deg = 0) {
  const d = imageData.data;
  const rad = (num(deg, 0, 360, 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // Standard hue-rotation matrix (SVG feColorMatrix hueRotate).
  const m = [
    0.213 + 0.787 * cos - 0.213 * sin,
    0.715 - 0.715 * cos - 0.715 * sin,
    0.072 - 0.072 * cos + 0.928 * sin,
    0.213 - 0.213 * cos + 0.143 * sin,
    0.715 + 0.285 * cos + 0.14 * sin,
    0.072 - 0.072 * cos - 0.283 * sin,
    0.213 - 0.213 * cos - 0.787 * sin,
    0.715 - 0.715 * cos + 0.715 * sin,
    0.072 + 0.928 * cos + 0.072 * sin,
  ];
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    d[i] = m[0] * r + m[1] * g + m[2] * b;
    d[i + 1] = m[3] * r + m[4] * g + m[5] * b;
    d[i + 2] = m[6] * r + m[7] * g + m[8] * b;
  }
  return imageData;
}

export function grayscale(imageData) {
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    const luma = LUMA_R * d[i] + LUMA_G * d[i + 1] + LUMA_B * d[i + 2];
    d[i] = d[i + 1] = d[i + 2] = luma;
  }
  return imageData;
}

export function invert(imageData) {
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = 255 - d[i];
    d[i + 1] = 255 - d[i + 1];
    d[i + 2] = 255 - d[i + 2];
  }
  return imageData;
}

export function sepia(imageData) {
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    d[i] = 0.393 * r + 0.769 * g + 0.189 * b;
    d[i + 1] = 0.349 * r + 0.686 * g + 0.168 * b;
    d[i + 2] = 0.272 * r + 0.534 * g + 0.131 * b;
  }
  return imageData;
}

export function threshold(imageData, t = 128) {
  const d = imageData.data;
  const level = num(t, 0, 255, 128);
  for (let i = 0; i < d.length; i += 4) {
    const luma = LUMA_R * d[i] + LUMA_G * d[i + 1] + LUMA_B * d[i + 2];
    const v = luma >= level - 1e-9 ? 255 : 0;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  return imageData;
}

export function posterize(imageData, levels = 4) {
  const d = imageData.data;
  const n = Math.round(num(levels, 2, 16, 4));
  const q = 255 / (n - 1);
  for (let i = 0; i < d.length; i += 4) {
    d[i] = Math.round(Math.round(d[i] / q) * q);
    d[i + 1] = Math.round(Math.round(d[i + 1] / q) * q);
    d[i + 2] = Math.round(Math.round(d[i + 2] / q) * q);
  }
  return imageData;
}

// Separable two-pass box blur (horizontal then vertical), edge pixels repeated.
export function boxBlur(imageData, radius = 3) {
  const r = Math.round(num(radius, 1, 50, 3));
  const w = imageData.width;
  const h = imageData.height;
  const d = imageData.data;
  if (w <= 0 || h <= 0) return imageData;
  const n = 2 * r + 1;
  const src = new Uint8ClampedArray(d);

  // Horizontal pass: src -> d
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let rs = 0;
      let gs = 0;
      let bs = 0;
      let as = 0;
      for (let k = -r; k <= r; k++) {
        const xx = Math.min(w - 1, Math.max(0, x + k));
        const i = (y * w + xx) * 4;
        rs += src[i];
        gs += src[i + 1];
        bs += src[i + 2];
        as += src[i + 3];
      }
      const o = (y * w + x) * 4;
      d[o] = rs / n;
      d[o + 1] = gs / n;
      d[o + 2] = bs / n;
      d[o + 3] = as / n;
    }
  }

  // Vertical pass: d -> src(copy) -> d
  src.set(d);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let rs = 0;
      let gs = 0;
      let bs = 0;
      let as = 0;
      for (let k = -r; k <= r; k++) {
        const yy = Math.min(h - 1, Math.max(0, y + k));
        const i = (yy * w + x) * 4;
        rs += src[i];
        gs += src[i + 1];
        bs += src[i + 2];
        as += src[i + 3];
      }
      const o = (y * w + x) * 4;
      d[o] = rs / n;
      d[o + 1] = gs / n;
      d[o + 2] = bs / n;
      d[o + 3] = as / n;
    }
  }
  return imageData;
}

// Generic 3x3 convolution over the interior; border pixels are left unchanged.
function convolve3x3(imageData, kernel, offset = 0, absolute = false) {
  const w = imageData.width;
  const h = imageData.height;
  const d = imageData.data;
  const src = new Uint8ClampedArray(d);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const o = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            sum += kernel[(ky + 1) * 3 + (kx + 1)] * src[((y + ky) * w + (x + kx)) * 4 + c];
          }
        }
        if (absolute) sum = Math.abs(sum);
        d[o + c] = sum + offset;
      }
    }
  }
  return imageData;
}

export function sharpen(imageData, amount = 50) {
  const k = num(amount, 0, 100, 50) / 100;
  if (k === 0) return imageData; // identity
  const kernel = [0, -k, 0, -k, 1 + 4 * k, -k, 0, -k, 0];
  return convolve3x3(imageData, kernel);
}

export function noise(imageData, amount = 20) {
  const d = imageData.data;
  const n = (num(amount, 0, 100, 20) * 255) / 100;
  for (let i = 0; i < d.length; i += 4) {
    const delta = (Math.random() * 2 - 1) * n;
    d[i] += delta;
    d[i + 1] += delta;
    d[i + 2] += delta;
  }
  return imageData;
}

export function pixelate(imageData, size = 8) {
  const s = Math.round(num(size, 2, 64, 8));
  const w = imageData.width;
  const h = imageData.height;
  const d = imageData.data;
  for (let by = 0; by < h; by += s) {
    for (let bx = 0; bx < w; bx += s) {
      const bw = Math.min(s, w - bx);
      const bh = Math.min(s, h - by);
      let rs = 0;
      let gs = 0;
      let bs = 0;
      let as = 0;
      for (let y = by; y < by + bh; y++) {
        for (let x = bx; x < bx + bw; x++) {
          const i = (y * w + x) * 4;
          rs += d[i];
          gs += d[i + 1];
          bs += d[i + 2];
          as += d[i + 3];
        }
      }
      const count = bw * bh;
      rs /= count;
      gs /= count;
      bs /= count;
      as /= count;
      for (let y = by; y < by + bh; y++) {
        for (let x = bx; x < bx + bw; x++) {
          const i = (y * w + x) * 4;
          d[i] = rs;
          d[i + 1] = gs;
          d[i + 2] = bs;
          d[i + 3] = as;
        }
      }
    }
  }
  return imageData;
}

export function emboss(imageData) {
  const kernel = [-2, -1, 0, -1, 1, 1, 0, 1, 2];
  return convolve3x3(imageData, kernel, 128);
}

export function edgeDetect(imageData) {
  const kernel = [-1, -1, -1, -1, 8, -1, -1, -1, -1];
  return convolve3x3(imageData, kernel, 0, true);
}
