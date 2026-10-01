// ──────────────────────────────────────────────────────────────
// Moteur de reconnaissance pour les PHOTOS d'écran : PaddleOCR (PP-OCRv4),
// exécuté dans le navigateur par ONNX Runtime (WebAssembly). Rien ne sort de
// l'appareil ; les modèles (~15 Mo) sont servis par le site et mis en cache.
//
// Deux réseaux, implémentés ici sans autre dépendance :
//  · DÉTECTION (DB) : carte de probabilité « ici il y a du texte » → boîtes ;
//  · RECONNAISSANCE (CRNN + CTC) : chaque boîte → une chaîne de caractères.
// Tesseract reste le moteur des CAPTURES (100 % sur le banc) ; celui-ci ne
// sert qu'aux photos, où il résiste bien mieux au flou, au moiré et aux
// points décimaux minuscules.
// ──────────────────────────────────────────────────────────────

import * as ort from 'onnxruntime-web/wasm';

export interface BoiteTexte {
  texte: string; confiance: number; x0: number; y0: number; x1: number; y1: number;
  /** Fin du nombre retrouvée par une seconde lecture élargie. */
  relu?: boolean;
}

const base = (): string => new URL((import.meta as any).env?.BASE_URL ?? './', location.href).href;

interface Moteur { det: ort.InferenceSession; rec: ort.InferenceSession; dico: string[]; }
let moteur: Promise<Moteur> | null = null;

export function chargerPaddle(): Promise<Moteur> {
  if (!moteur) {
    moteur = (async () => {
      ort.env.wasm.wasmPaths = base() + 'ort/';
      // Plusieurs cœurs seulement si la page est isolée (SharedArrayBuffer).
      ort.env.wasm.numThreads = globalThis.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
      const opts: ort.InferenceSession.SessionOptions = { executionProviders: ['wasm'] };
      const [det, rec, texte] = await Promise.all([
        ort.InferenceSession.create(base() + 'paddle/ch_PP-OCRv4_det_infer.onnx', opts),
        ort.InferenceSession.create(base() + 'paddle/en_PP-OCRv4_rec.onnx', opts),
        fetch(base() + 'paddle/en_dict.txt').then(r => r.text()),
      ]);
      // Index 0 = « blanc » CTC ; le dictionnaire commence à 1 ; espace en dernier.
      const dico = ['', ...texte.split(/\r?\n/).filter((l, i, a) => i < a.length - 1 || l !== ''), ' '];
      return { det, rec, dico };
    })();
  }
  return moteur;
}

function pixels(c: HTMLCanvasElement): Uint8ClampedArray {
  return c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height).data;
}

function redimensionner(source: CanvasImageSource, w: number, h: number, sw: number, sh: number, sx = 0, sy = 0): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, w, h);
  return c;
}

/** Détection : boîtes de texte, en coordonnées de l'image d'origine. */
async function detecter(m: Moteur, img: HTMLCanvasElement, coteMax: number): Promise<{ x0: number; y0: number; x1: number; y1: number }[]> {
  const r = Math.min(1, coteMax / Math.max(img.width, img.height));
  const W = Math.max(32, Math.round((img.width * r) / 32) * 32);
  const H = Math.max(32, Math.round((img.height * r) / 32) * 32);
  const c = redimensionner(img, W, H, img.width, img.height);
  const d = pixels(c);
  const moy = [0.485, 0.456, 0.406], ec = [0.229, 0.224, 0.225];
  const t = new Float32Array(3 * W * H);
  for (let i = 0, p = 0; p < W * H; i += 4, p++) {
    for (let k = 0; k < 3; k++) t[k * W * H + p] = (d[i + k] / 255 - moy[k]) / ec[k];
  }
  const sortie = await m.det.run({ [m.det.inputNames[0]]: new ort.Tensor('float32', t, [1, 3, H, W]) });
  const prob = sortie[m.det.outputNames[0]].data as Float32Array;

  // Composantes connexes de la carte binarisée (seuil 0,3), score moyen ≥ 0,6.
  const vu = new Uint8Array(W * H), pile = new Int32Array(W * H);
  const boites: { x0: number; y0: number; x1: number; y1: number }[] = [];
  for (let s = 0; s < W * H; s++) {
    if (vu[s] || prob[s] < 0.3) continue;
    let n = 0, somme = 0, x0 = W, y0 = H, x1 = 0, y1 = 0, sp = 0;
    pile[sp++] = s; vu[s] = 1;
    while (sp) {
      const q = pile[--sp]; const x = q % W, y = (q / W) | 0;
      n++; somme += prob[q];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (const v of [q - 1, q + 1, q - W, q + W]) {
        if (v < 0 || v >= W * H || vu[v] || prob[v] < 0.3) continue;
        if ((v === q - 1 && x === 0) || (v === q + 1 && x === W - 1)) continue;
        vu[v] = 1; pile[sp++] = v;
      }
    }
    if (n < 6 || somme / n < 0.6) continue;
    // « Unclip » : la carte DB rétrécit le texte ; on regonfle la boîte.
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    const dist = (bw * bh * 1.5) / (2 * (bw + bh));
    boites.push({
      x0: Math.max(0, (x0 - dist) / (W / img.width)), y0: Math.max(0, (y0 - dist) / (H / img.height)),
      x1: Math.min(img.width - 1, (x1 + 1 + dist) / (W / img.width)), y1: Math.min(img.height - 1, (y1 + 1 + dist) / (H / img.height)),
    });
  }
  return boites;
}

type Zone = { x0: number; y0: number; x1: number; y1: number };

/** Largeur de la zone une fois ramenée à 48 px de haut (multiple de 8, bornée). */
const largeurRec = (b: Zone): number => Math.max(16, Math.min(1280, Math.ceil(((b.x1 - b.x0) / (b.y1 - b.y0)) * 48 / 8) * 8));

/**
 * Reconnaissance d'un LOT de zones de largeurs voisines, en un seul passage du
 * réseau (hauteur 48 px, zones complétées à droite par du gris neutre, comme
 * le fait PaddleOCR) ; décodage CTC glouton. Un appel par zone coûtait surtout
 * en frais fixes : le lot divise le temps de lecture par 3 à 4.
 */
export async function reconnaitreLot(m: Moteur, img: HTMLCanvasElement, lot: Zone[]): Promise<{ texte: string; confiance: number }[]> {
  const H = 48, W = Math.max(...lot.map(largeurRec)), N = lot.length;
  const t = new Float32Array(N * 3 * W * H); // 0 = gris neutre après normalisation
  lot.forEach((b, n) => {
    const w = largeurRec(b);
    const d = pixels(redimensionner(img, w, H, b.x1 - b.x0, b.y1 - b.y0, b.x0, b.y0));
    const base = n * 3 * W * H;
    for (let y = 0; y < H; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, p = y * W + x;
      for (let k = 0; k < 3; k++) t[base + k * W * H + p] = (d[i + k] / 255 - 0.5) / 0.5;
    }
  });
  const sortie = await m.rec.run({ [m.rec.inputNames[0]]: new ort.Tensor('float32', t, [N, 3, H, W]) });
  const o = sortie[m.rec.outputNames[0]];
  const [, T, C] = o.dims as number[];
  const data = o.data as Float32Array;
  return lot.map((_, n) => {
    let texte = '', somme = 0, nb = 0, prec = -1;
    for (let i = 0; i < T; i++) {
      const off = (n * T + i) * C;
      let best = 0, bv = -Infinity;
      for (let k = 0; k < C; k++) { const v = data[off + k]; if (v > bv) { bv = v; best = k; } }
      if (best !== 0 && best !== prec) { texte += m.dico[best] ?? ''; somme += bv; nb++; }
      prec = best;
    }
    return { texte, confiance: nb ? somme / nb : 0 };
  });
}

/** Zone élargie pour la relecture : surtout à droite, où le chiffre a été rogné. */
function elargir(bs: Zone[], img: HTMLCanvasElement): Zone[] {
  return bs.map(b => {
    const h = b.y1 - b.y0;
    return {
      x0: Math.max(0, b.x0 - h * 0.2), x1: Math.min(img.width - 1, b.x1 + h * 0.8),
      y0: Math.max(0, b.y0 - h * 0.15), y1: Math.min(img.height - 1, b.y1 + h * 0.15),
    };
  });
}

/** Détection seule (sans lecture), pour la visée en direct : rapide à petite taille. */
export async function detecterZones(img: HTMLCanvasElement, coteMax = 640): Promise<Zone[]> {
  return detecter(await chargerPaddle(), img, coteMax);
}

/**
 * Détecte et lit toutes les zones de texte d'une image. `coteMax` : taille de
 * travail de la détection (plus grand = petits textes mieux vus, plus lent).
 */
export async function lireTextes(
  img: HTMLCanvasElement, coteMax = 1920, onProgress?: (fait: number, total: number) => void, annule?: () => boolean,
): Promise<BoiteTexte[]> {
  const m = await chargerPaddle();
  const brutes = (await detecter(m, img, coteMax)).filter(b => b.x1 - b.x0 >= 2 && b.y1 - b.y0 >= 2);
  const boites = brutes;
  // Lots de zones de largeurs voisines : peu de remplissage perdu.
  const ordre = boites.map((b, i) => i).sort((p, q) => largeurRec(boites[p]) - largeurRec(boites[q]));
  const lus: { texte: string; confiance: number }[] = new Array(boites.length);
  for (let i = 0; i < ordre.length;) {
    if (annule?.()) return [];
    onProgress?.(i, boites.length);
    const w0 = largeurRec(boites[ordre[i]]);
    let j = i + 1;
    while (j < ordre.length && j - i < 32 && largeurRec(boites[ordre[j]]) <= w0 * 1.3 + 16) j++;
    const r = await reconnaitreLot(m, img, ordre.slice(i, j).map(k => boites[k]));
    r.forEach((x, n) => { lus[ordre[i + n]] = x; });
    i = j;
  }
  const out: BoiteTexte[] = [];
  boites.forEach((b, i) => { const r = lus[i]; if (r.texte.trim()) out.push({ ...b, texte: r.texte.trim(), confiance: r.confiance }); });
  // Sur fond peu contrasté, la détection rogne le bord droit (« 38. » pour
  // 38.7) : les nombres qui finissent par un séparateur sont relus avec un peu
  // de marge. La relecture n'est retenue que si elle PROLONGE la première.
  const tronques = out.filter(b => /^[<>]?\d+[.,]$/.test(b.texte.replace(/\s+/g, '')));
  for (let i = 0; i < tronques.length; i += 32) {
    const lot = tronques.slice(i, i + 32);
    const r = await reconnaitreLot(m, img, elargir(lot, img));
    lot.forEach((b, n) => {
      const avant = b.texte.replace(/\s+/g, ''), apres = r[n].texte.replace(/\s+/g, '');
      if (apres.length > avant.length && apres.startsWith(avant) && /^[<>]?\d+[.,]\d+$/.test(apres)) {
        b.texte = apres; b.confiance = Math.min(b.confiance, r[n].confiance); b.relu = true;
      }
    });
  }
  return out;
}
