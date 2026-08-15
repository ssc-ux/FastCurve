// Prétraitement d'image pour l'OCR : rotation, recadrage, agrandissement,
// niveaux de gris, contraste, binarisation (atténue le moiré des photos d'écran).

export interface CropRect {
  /** Fractions [0..1] relatives à l'image source (après rotation). */
  x: number; y: number; w: number; h: number;
}

export interface ProcessOptions {
  rotation: 0 | 90 | 180 | 270;
  crop?: CropRect | null;
  grayscale: boolean;
  contrast: number;   // 0 = neutre, >0 augmente
  binarize: boolean;
  /**
   * Gris par « canal minimum » (v = min(R,G,B)) : rend l'encre COLORÉE aussi
   * sombre que l'encre noire (les valeurs anormales de Sillage sont en orange).
   * Sert à la seconde lecture qui récupère les valeurs fléchées.
   */
  minChannel?: boolean;
  /** Gamma > 1 : fonce l'encre pâle (gris clair, orange clair) en préservant le fond blanc. */
  gamma?: number;
  /** Largeur cible minimale (agrandit les petites images pour l'OCR). */
  targetWidth: number;
  /** Largeur maximale : sous-échantillonne les grandes photos (réduit le moiré). */
  maxWidth: number;
}

export function defaultProcessOptions(): ProcessOptions {
  // Par défaut : aucun filtre. Les captures d'écran nettes (cas dominant) se
  // lisent bien mieux en brut ; le passage niveaux de gris + contrast dégradait
  // fortement l'OCR (dates illisibles). N&B / contraste restent activables à la
  // main pour les photos difficiles.
  return { rotation: 0, crop: null, grayscale: false, contrast: 0, binarize: false, targetWidth: 1800, maxWidth: 2400 };
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image illisible'));
    img.src = src;
  });
}

/** Applique rotation + crop et retourne un canvas (sans les filtres pixels). */
export function orientedCanvas(img: HTMLImageElement, rotation: number, crop?: CropRect | null): HTMLCanvasElement {
  // 1. Rotation dans un premier canvas
  const rot = document.createElement('canvas');
  const rctx = rot.getContext('2d')!;
  const w = img.naturalWidth, h = img.naturalHeight;
  if (rotation === 90 || rotation === 270) { rot.width = h; rot.height = w; }
  else { rot.width = w; rot.height = h; }
  rctx.save();
  switch (rotation) {
    case 90: rctx.translate(h, 0); rctx.rotate(Math.PI / 2); break;
    case 180: rctx.translate(w, h); rctx.rotate(Math.PI); break;
    case 270: rctx.translate(0, w); rctx.rotate(-Math.PI / 2); break;
  }
  rctx.drawImage(img, 0, 0);
  rctx.restore();

  if (!crop) return rot;

  // 2. Recadrage
  const cx = Math.max(0, Math.round(crop.x * rot.width));
  const cy = Math.max(0, Math.round(crop.y * rot.height));
  const cw = Math.min(rot.width - cx, Math.round(crop.w * rot.width));
  const ch = Math.min(rot.height - cy, Math.round(crop.h * rot.height));
  if (cw <= 2 || ch <= 2) return rot;
  const out = document.createElement('canvas');
  out.width = cw; out.height = ch;
  out.getContext('2d')!.drawImage(rot, cx, cy, cw, ch, 0, 0, cw, ch);
  return out;
}

/** Chaîne complète : orientation → agrandissement → filtres pixels. */
export function processImage(img: HTMLImageElement, opts: ProcessOptions): HTMLCanvasElement {
  const oriented = orientedCanvas(img, opts.rotation, opts.crop);

  // Mise à l'échelle : agrandir les petites images, réduire les grandes photos
  // (le sous-échantillonnage atténue le moiré des photos d'écran).
  let scale = 1;
  if (oriented.width < opts.targetWidth) {
    scale = Math.min(3, opts.targetWidth / oriented.width);
  } else if (oriented.width > opts.maxWidth) {
    scale = opts.maxWidth / oriented.width;
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(oriented.width * scale);
  canvas.height = Math.round(oriented.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(oriented, 0, 0, canvas.width, canvas.height);

  if (!opts.grayscale && !opts.binarize && opts.contrast === 0 && !opts.minChannel && !opts.gamma) return canvas;

  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = imgData.data;
  const c = 1 + opts.contrast;
  const gamma = opts.gamma ?? 1;

  // Niveaux de gris (luminance ou canal minimum) + gamma + contraste
  const gray = new Float32Array(canvas.width * canvas.height);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    let v = opts.minChannel
      ? Math.min(d[i], d[i + 1], d[i + 2])
      : 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    if (gamma !== 1) v = 255 * Math.pow(v / 255, gamma);
    v = (v - 128) * c + 128;
    v = Math.max(0, Math.min(255, v));
    gray[p] = v;
  }

  if (opts.binarize) {
    boxBlur(gray, canvas.width, canvas.height); // débruitage anti-moiré avant seuillage
    const t = otsuThreshold(gray);
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      const v = gray[p] >= t ? 255 : 0;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
  } else {
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      const v = gray[p];
      d[i] = d[i + 1] = d[i + 2] = v;
    }
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

/** Flou moyenneur 3×3 en place (atténue le bruit / moiré). */
function boxBlur(gray: Float32Array, w: number, h: number) {
  const src = gray.slice();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          sum += src[yy * w + xx]; n++;
        }
      }
      gray[y * w + x] = sum / n;
    }
  }
}

function otsuThreshold(gray: Float32Array): number {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < gray.length; i++) hist[Math.round(gray[i])]++;
  const total = gray.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, max = 0, threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > max) { max = between; threshold = t; }
  }
  return threshold;
}
