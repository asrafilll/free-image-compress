import sharp from 'sharp';

export const SUPPORTED_INPUT = new Set(['jpeg', 'png', 'webp', 'avif']);

// Perceptual quality targets. SSIM is measured on a downscaled grayscale
// proxy, so thresholds are tuned for that scale, not full-resolution SSIM.
const MODES = {
  high: { ssim: 0.97, minQ: 50, maxQ: 95 },
  balanced: { ssim: 0.94, minQ: 40, maxQ: 90 },
  small: { ssim: 0.9, minQ: 25, maxQ: 85 },
};

const SEARCH_PROXY_PX = 1200; // search quality on a capped-size proxy for speed
const COMPARE_PX = 256; // SSIM comparison resolution

// fast=true is used inside the quality search loop; the final encode
// spends full effort since it runs only once per candidate format.
function encode(pipeline, format, quality, fast = false) {
  switch (format) {
    case 'jpeg':
      return pipeline.jpeg({ quality, mozjpeg: true }).toBuffer();
    case 'png':
      return pipeline
        .png(
          fast
            ? { palette: true, quality, compressionLevel: 1, effort: 1 }
            : { palette: true, quality, compressionLevel: 9, effort: 10 }
        )
        .toBuffer();
    case 'webp':
      return pipeline.webp({ quality, effort: fast ? 1 : 6 }).toBuffer();
    case 'avif':
      return pipeline.avif({ quality, effort: fast ? 2 : 4 }).toBuffer();
    default:
      throw new Error(`unsupported output format: ${format}`);
  }
}

async function grayRaw(buf, width, height) {
  return sharp(buf)
    .resize(width, height, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer();
}

// Mean SSIM over 8x8 windows, standard constants.
function ssim(a, b, width, height) {
  const C1 = (0.01 * 255) ** 2;
  const C2 = (0.03 * 255) ** 2;
  const win = 8;
  let total = 0;
  let count = 0;
  for (let y = 0; y + win <= height; y += win) {
    for (let x = 0; x + win <= width; x += win) {
      let sumA = 0, sumB = 0, sumA2 = 0, sumB2 = 0, sumAB = 0;
      for (let dy = 0; dy < win; dy++) {
        let i = (y + dy) * width + x;
        for (let dx = 0; dx < win; dx++, i++) {
          const va = a[i];
          const vb = b[i];
          sumA += va;
          sumB += vb;
          sumA2 += va * va;
          sumB2 += vb * vb;
          sumAB += va * vb;
        }
      }
      const n = win * win;
      const muA = sumA / n;
      const muB = sumB / n;
      const varA = sumA2 / n - muA * muA;
      const varB = sumB2 / n - muB * muB;
      const cov = sumAB / n - muA * muB;
      total +=
        ((2 * muA * muB + C1) * (2 * cov + C2)) /
        ((muA * muA + muB * muB + C1) * (varA + varB + C2));
      count++;
    }
  }
  return count ? total / count : 1;
}

// Lowest quality whose proxy encode still meets the SSIM threshold.
async function searchQuality(proxyPng, format, mode) {
  const { ssim: threshold, minQ, maxQ } = MODES[mode];
  const meta = await sharp(proxyPng).metadata();
  const scale = Math.min(1, COMPARE_PX / Math.max(meta.width, meta.height));
  const cw = Math.max(16, Math.round(meta.width * scale));
  const ch = Math.max(16, Math.round(meta.height * scale));
  const ref = await grayRaw(proxyPng, cw, ch);

  let lo = minQ;
  let hi = maxQ;
  let best = maxQ;
  while (lo <= hi) {
    const mid = Math.round((lo + hi) / 2);
    const candidate = await encode(sharp(proxyPng), format, mid, true);
    const candGray = await grayRaw(candidate, cw, ch);
    const score = ssim(ref, candGray, cw, ch);
    if (score >= threshold) {
      best = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  return best;
}

function candidateFormats(requested, inputFormat, hasAlpha) {
  if (requested !== 'auto') {
    const fmt = requested === 'keep' ? inputFormat : requested;
    if (fmt === 'jpeg' && hasAlpha) return ['webp'];
    return [fmt];
  }
  const set = new Set([inputFormat, 'webp', 'avif']);
  if (hasAlpha) set.delete('jpeg');
  return [...set];
}

/**
 * Compress an image buffer.
 * @param {Buffer} input
 * @param {{format?: 'keep'|'auto'|'avif'|'webp'|'jpeg'|'png', mode?: 'high'|'balanced'|'small'}} opts
 */
export async function compressImage(input, opts = {}) {
  const requested = opts.format ?? 'keep';
  const mode = MODES[opts.mode] ? opts.mode : 'balanced';

  const meta = await sharp(input).metadata();
  if (!SUPPORTED_INPUT.has(meta.format)) {
    throw new Error(`unsupported input format: ${meta.format ?? 'unknown'}`);
  }

  // Normalize EXIF orientation once; metadata is stripped on output anyway.
  const proxyPng = await sharp(input)
    .rotate()
    .resize(SEARCH_PROXY_PX, SEARCH_PROXY_PX, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .png()
    .toBuffer();

  const formats = candidateFormats(requested, meta.format, !!meta.hasAlpha);

  let best = null;
  for (const fmt of formats) {
    const quality = await searchQuality(proxyPng, fmt, mode);
    const buffer = await encode(sharp(input).rotate(), fmt, quality);
    if (!best || buffer.length < best.buffer.length) {
      best = { buffer, format: fmt, quality };
    }
  }

  // Never return something bigger than the original when keeping the format.
  if (best.format === meta.format && best.buffer.length >= input.length) {
    return {
      buffer: input,
      format: meta.format,
      quality: null,
      originalSize: input.length,
      compressedSize: input.length,
      alreadyOptimized: true,
    };
  }

  return {
    buffer: best.buffer,
    format: best.format,
    quality: best.quality,
    originalSize: input.length,
    compressedSize: best.buffer.length,
    alreadyOptimized: false,
  };
}
