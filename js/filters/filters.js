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

// --- v2 filters -------------------------------------------------------------
// Object-param filters: each takes a single params object. All are total and
// clamp their inputs; alpha is never touched.

// Standard Photoshop levels: normalize v from [inBlack,inWhite] to [0,1]
// (clamped), apply gamma as pow(t, 1/gamma), map to [outBlack,outWhite].
export function levels(imageData, opts = {}) {
  const { inBlack = 0, inWhite = 255, gamma = 1, outBlack = 0, outWhite = 255 } = opts || {};
  const ib = num(inBlack, 0, 254, 0);
  const iw = Math.max(ib + 1, num(inWhite, 1, 255, 255));
  const g = num(gamma, 0.1, 9.99, 1);
  const ob = num(outBlack, 0, 255, 0);
  const ow = num(outWhite, 0, 255, 255);
  const range = iw - ib;
  const invGamma = 1 / g;
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      let t = (d[i + c] - ib) / range;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      d[i + c] = ob + Math.pow(t, invGamma) * (ow - ob);
    }
  }
  return imageData;
}

// Master-channel LUT built from control points via Catmull-Rom interpolation
// (Hermite form with finite-difference tangents; passes through every point,
// collinear points stay linear). Fewer than 2 points -> no-op.
export function curves(imageData, opts = {}) {
  const { points = [[0, 0], [255, 255]] } = opts || {};
  if (!Array.isArray(points)) return imageData;
  const pts = points
    .filter((p) => Array.isArray(p) && p.length >= 2)
    .map((p) => [num(p[0], 0, 255, 0), num(p[1], 0, 255, 0)])
    .sort((a, b) => a[0] - b[0]);
  if (pts.length < 2) return imageData;
  const last = pts.length - 1;
  const slopes = pts.map((p, i) => {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(last, i + 1)];
    const dx = next[0] - prev[0];
    return dx === 0 ? 0 : (next[1] - prev[1]) / dx;
  });
  const lut = new Uint8ClampedArray(256); // assignment rounds + clamps to 0-255
  let seg = 0;
  for (let x = 0; x < 256; x++) {
    if (x <= pts[0][0]) {
      lut[x] = pts[0][1];
      continue;
    }
    if (x >= pts[last][0]) {
      lut[x] = pts[last][1];
      continue;
    }
    while (x > pts[seg + 1][0]) seg++;
    const x1 = pts[seg][0];
    const y1 = pts[seg][1];
    const x2 = pts[seg + 1][0];
    const y2 = pts[seg + 1][1];
    const dx = x2 - x1; // > 0: x1 < x <= x2 by the scan above
    const t = (x - x1) / dx;
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    lut[x] = h00 * y1 + h10 * dx * slopes[seg] + h01 * y2 + h11 * dx * slopes[seg + 1];
  }
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = lut[d[i]];
    d[i + 1] = lut[d[i + 1]];
    d[i + 2] = lut[d[i + 2]];
  }
  return imageData;
}

function hue2rgb(p, q, t) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

// Per-pixel HSL adjustment: hue shifts (degrees, wraps), saturation/lightness
// scale their HSL components by 1 + v/100 (clamped to [0,1]).
export function hueSaturation(imageData, opts = {}) {
  const { hue = 0, saturation = 0, lightness = 0 } = opts || {};
  const dh = num(hue, -180, 180, 0) / 360;
  const sf = 1 + num(saturation, -100, 100, 0) / 100;
  const lf = 1 + num(lightness, -100, 100, 0) / 100;
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] / 255;
    const g = d[i + 1] / 255;
    const b = d[i + 2] / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0;
    let s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
      const delta = max - min;
      s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
      if (max === r) h = ((g - b) / delta + (g < b ? 6 : 0)) / 6;
      else if (max === g) h = ((b - r) / delta + 2) / 6;
      else h = ((r - g) / delta + 4) / 6;
    }
    h = (((h + dh) % 1) + 1) % 1;
    s = Math.min(1, Math.max(0, s * sf));
    const l2 = Math.min(1, Math.max(0, l * lf));
    if (s === 0) {
      d[i] = d[i + 1] = d[i + 2] = l2 * 255;
    } else {
      const q = l2 < 0.5 ? l2 * (1 + s) : l2 + s - l2 * s;
      const p = 2 * l2 - q;
      d[i] = hue2rgb(p, q, h + 1 / 3) * 255;
      d[i + 1] = hue2rgb(p, q, h) * 255;
      d[i + 2] = hue2rgb(p, q, h - 1 / 3) * 255;
    }
  }
  return imageData;
}

// Local hex parser so filters.js stays dependency-free. Invalid input falls
// back to the given [r,g,b].
function parseHexColor(hex, fallback) {
  let h = String(hex).trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return fallback;
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Maps each pixel's luma (Rec.601) t∈[0,1] to from + (to - from) * t.
export function gradientMap(imageData, opts = {}) {
  const { from = '#000000', to = '#ffffff' } = opts || {};
  const cf = parseHexColor(from, [0, 0, 0]);
  const ct = parseHexColor(to, [255, 255, 255]);
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    const t = (LUMA_R * d[i] + LUMA_G * d[i + 1] + LUMA_B * d[i + 2]) / 255;
    d[i] = cf[0] + (ct[0] - cf[0]) * t;
    d[i + 1] = cf[1] + (ct[1] - cf[1]) * t;
    d[i + 2] = cf[2] + (ct[2] - cf[2]) * t;
  }
  return imageData;
}
