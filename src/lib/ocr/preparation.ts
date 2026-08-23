// ──────────────────────────────────────────────────────────────
// Prétraitement d'image pour la reconnaissance CELLULE PAR CELLULE.
//
// Deux besoins distincts, donc deux traitements distincts :
//
//  1. Pour la DÉTECTION DE STRUCTURE, il faut une carte d'encre binaire fiable
//     sur une capture qui mélange fond blanc, lignes zébrées gris clair,
//     bandeau d'en-tête sombre à texte blanc et valeurs colorées en orange.
//     Un seuil global (Otsu) échoue sur tout cela ; on utilise donc un seuil
//     LOCAL (Sauvola) calculé par images intégrales, complété d'une correction
//     de polarité ligne par ligne (une ligne de pixels majoritairement « encre »
//     est en réalité une ligne en vidéo inverse : bandeau sombre).
//
//  2. Pour l'OCR d'une CELLULE, il faut au contraire une petite image nette,
//     AGRANDIE (les captures d'écran sont trop petites pour Tesseract : un
//     facteur ×3 à ×5 change tout), en gris par canal minimum pour que l'encre
//     orange des valeurs pathologiques devienne aussi sombre que l'encre noire,
//     avec une marge blanche autour.
//
// Aucune requête réseau : tout est calculé dans le navigateur.
// ──────────────────────────────────────────────────────────────

import type { CarteEncre } from './structure';

export interface ImageGris {
  largeur: number;
  hauteur: number;
  /** Niveaux 0..255, un par pixel. */
  v: Float32Array;
}

/** Largeur au-delà de laquelle on sous-échantillonne avant l'analyse de structure. */
const LARGEUR_MAX_ANALYSE = 1800;

/**
 * Canvas de travail : l'image d'origine, réduite seulement si elle est très
 * grande (photo d'appareil). On ne l'agrandit PAS ici : l'agrandissement se
 * fait cellule par cellule, ce qui coûte bien moins de mémoire et permet de
 * choisir le facteur d'après la hauteur de ligne réelle.
 */
export function canvasSource(img: HTMLImageElement | HTMLCanvasElement, largeurMax = LARGEUR_MAX_ANALYSE): HTMLCanvasElement {
  const w = img instanceof HTMLImageElement ? img.naturalWidth : img.width;
  const h = img instanceof HTMLImageElement ? img.naturalHeight : img.height;
  const facteur = w > largeurMax ? largeurMax / w : 1;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * facteur));
  c.height = Math.max(1, Math.round(h * facteur));
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

/**
 * Gris par CANAL MINIMUM : v = min(R,G,B).
 * L'orange (#c8641e) devient 30 — aussi sombre que du noir — alors que la
 * luminance classique le laisserait à 120 et ferait disparaître les valeurs
 * pathologiques. C'est ce qui faisait perdre une capture entière à l'ancienne
 * chaîne (« fleches-anormales » : 0 valeur sur 27).
 */
export function grisCanalMin(canvas: HTMLCanvasElement): ImageGris {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const v = new Float32Array(canvas.width * canvas.height);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const a = d[i + 3];
    if (a < 255) {
      // Transparent = fond blanc (une capture collée peut avoir un alpha).
      const k = a / 255;
      v[p] = Math.min(d[i], d[i + 1], d[i + 2]) * k + 255 * (1 - k);
    } else {
      v[p] = Math.min(d[i], d[i + 1], d[i + 2]);
    }
  }
  return { largeur: canvas.width, hauteur: canvas.height, v };
}

/**
 * Classe de couleur d'un pixel, pour repérer les DÉCORATIONS gluées aux
 * valeurs par certains systèmes hospitaliers (badge « i » d'information,
 * flèche de tendance) :
 *
 *   0 = neutre (noir/gris — texte normal, y compris une valeur pathologique
 *       rendue tout entière en orange/rouge)
 *   1 = bleu franc, 2 = chaud franc (orange/rouge)
 *   3 = bleu léger, 4 = chaud léger — une teinte trop faible pour trancher
 *       seule (le liséré antialiasé d'un badge, fondu vers le blanc), mais
 *       qui compte quand elle TOUCHE un pixel franc de la même famille : voir
 *       `structure.ts#sansDecorationsCouleur`, qui étend le retrait au liséré
 *       sans jamais franchir un pixel réellement neutre (le chiffre voisin,
 *       même collé).
 *
 * Deux seuils (hystérésis, comme un détecteur de contours) : le seuil FORT
 * suffit à lui seul à qualifier un pixel ; le seuil FAIBLE ne compte que
 * connecté à du FORT de même famille.
 */
export type ClasseCouleur = 0 | 1 | 2 | 3 | 4;

export interface CarteCouleur {
  largeur: number;
  hauteur: number;
  classe: Uint8Array;
}

const SEUIL_CHROMA_FORT = 30;
const SEUIL_DOMINANCE_FORT = 12;
const SEUIL_CHROMA_FAIBLE = 10;
const SEUIL_DOMINANCE_FAIBLE = 4;

/**
 * Carte de classification chromatique de l'image, calculée une seule fois
 * sur le même canvas que `grisCanalMin` (mêmes dimensions, alignement pixel à
 * pixel garanti).
 */
export function carteCouleur(canvas: HTMLCanvasElement): CarteCouleur {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const classe = new Uint8Array(canvas.width * canvas.height);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const chroma = mx - mn;
    const domBleu = b - Math.max(r, g);
    const domChaud = r - b;
    if (chroma >= SEUIL_CHROMA_FORT && domBleu > SEUIL_DOMINANCE_FORT) classe[p] = 1;
    else if (chroma >= SEUIL_CHROMA_FORT && domChaud > SEUIL_DOMINANCE_FORT) classe[p] = 2;
    else if (chroma >= SEUIL_CHROMA_FAIBLE && domBleu > SEUIL_DOMINANCE_FAIBLE) classe[p] = 3;
    else if (chroma >= SEUIL_CHROMA_FAIBLE && domChaud > SEUIL_DOMINANCE_FAIBLE) classe[p] = 4;
  }
  return { largeur: canvas.width, hauteur: canvas.height, classe };
}

interface Integrales { s: Float64Array; s2: Float64Array; largeur: number; hauteur: number; }

function integrales(g: ImageGris): Integrales {
  const { largeur: w, hauteur: h, v } = g;
  const W = w + 1;
  const s = new Float64Array(W * (h + 1));
  const s2 = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let ligne = 0, ligne2 = 0;
    const base = y * w;
    const dst = (y + 1) * W;
    const prev = y * W;
    for (let x = 0; x < w; x++) {
      const val = v[base + x];
      ligne += val; ligne2 += val * val;
      s[dst + x + 1] = s[prev + x + 1] + ligne;
      s2[dst + x + 1] = s2[prev + x + 1] + ligne2;
    }
  }
  return { s, s2, largeur: w, hauteur: h };
}

function somme(t: Float64Array, W: number, x0: number, y0: number, x1: number, y1: number): number {
  return t[(y1 + 1) * W + x1 + 1] - t[y0 * W + x1 + 1] - t[(y1 + 1) * W + x0] + t[y0 * W + x0];
}

/** Côté impair de la fenêtre Sauvola, déduit de la taille de l'image. */
export function cotefenetre(largeur: number): number {
  const c = Math.round(largeur / 40);
  const impair = c % 2 === 0 ? c + 1 : c;
  return Math.min(61, Math.max(11, impair));
}

/**
 * Carte d'encre par seuil local (Sauvola) : T = µ·(1 + k·(σ/R − 1)).
 *
 * `polarite[y]` vaut 1 quand la ligne de pixels y est en vidéo inverse (texte
 * clair sur fond sombre) : la carte y a été recalculée sur l'image inversée,
 * et l'appelant sait qu'il devra inverser cette portion avant de l'envoyer à
 * Tesseract, qui ne lit correctement que du sombre sur clair.
 */
export function carteEncreLocale(g: ImageGris, opts: { k?: number; cote?: number } = {}): { carte: CarteEncre; polarite: Uint8Array } {
  const { largeur: w, hauteur: h, v } = g;
  const k = opts.k ?? 0.18;
  const cote = opts.cote ?? cotefenetre(w);
  const r = Math.floor(cote / 2);
  const R = 128;
  const it = integrales(g);
  const W = w + 1;

  const encre = new Uint8Array(w * h);
  const seuils = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
      const n = (x1 - x0 + 1) * (y1 - y0 + 1);
      const sm = somme(it.s, W, x0, y0, x1, y1);
      const sq = somme(it.s2, W, x0, y0, x1, y1);
      const mu = sm / n;
      const variance = Math.max(0, sq / n - mu * mu);
      const sigma = Math.sqrt(variance);
      const t = mu * (1 + k * (sigma / R - 1));
      seuils[y * w + x] = t;
      encre[y * w + x] = v[y * w + x] < t ? 1 : 0;
    }
  }

  // Correction de polarité : une ligne de pixels dont plus de la moitié est
  // « encre » est un bandeau en vidéo inverse. On y garde plutôt les pixels
  // CLAIRS (le texte blanc) comme encre.
  const polarite = new Uint8Array(h);
  for (let y = 0; y < h; y++) {
    let n = 0;
    const base = y * w;
    for (let x = 0; x < w; x++) n += encre[base + x];
    if (n > w * 0.5) {
      polarite[y] = 1;
      for (let x = 0; x < w; x++) encre[base + x] = v[base + x] > seuils[base + x] ? 1 : 0;
    }
  }

  return { carte: { largeur: w, hauteur: h, encre }, polarite };
}

export interface Boite { x0: number; y0: number; x1: number; y1: number; }

export interface OptionsCellule {
  /** Hauteur cible du texte agrandi, en pixels (Tesseract aime ~40 px). */
  hauteurCible?: number;
  /** Facteur maximal d'agrandissement. */
  facteurMax?: number;
  /** Vidéo inverse : le texte est clair sur fond sombre. */
  inverse?: boolean;
  /** Marge blanche ajoutée autour, en pixels de sortie. */
  marge?: number;
}

/**
 * Découpe une cellule et la prépare pour Tesseract : agrandissement, gris par
 * canal minimum, étirement de contraste, marge blanche.
 *
 * L'agrandissement est le levier le plus rentable de toute la chaîne : sur une
 * capture d'écran à 13 px de corps, Tesseract se trompe régulièrement de
 * chiffre ; à ×4 il ne se trompe presque plus.
 */
export function rendreCellule(source: HTMLCanvasElement, boite: Boite, opts: OptionsCellule = {}): HTMLCanvasElement {
  const hauteurCible = opts.hauteurCible ?? 44;
  const facteurMax = opts.facteurMax ?? 6;
  const marge = opts.marge ?? 12;

  const x0 = Math.max(0, Math.floor(boite.x0));
  const y0 = Math.max(0, Math.floor(boite.y0));
  const x1 = Math.min(source.width - 1, Math.ceil(boite.x1));
  const y1 = Math.min(source.height - 1, Math.ceil(boite.y1));
  const w = Math.max(1, x1 - x0 + 1);
  const h = Math.max(1, y1 - y0 + 1);

  const facteur = Math.max(1, Math.min(facteurMax, hauteurCible / h));
  const cw = Math.round(w * facteur);
  const ch = Math.round(h * facteur);

  const c = document.createElement('canvas');
  c.width = cw + marge * 2;
  c.height = ch + marge * 2;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, x0, y0, w, h, marge, marge, cw, ch);

  // Gris canal minimum + étirement de contraste sur la zone utile.
  const zone = ctx.getImageData(marge, marge, cw, ch);
  const d = zone.data;
  const gris = new Float32Array(cw * ch);
  let mini = 255, maxi = 0;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    let g = Math.min(d[i], d[i + 1], d[i + 2]);
    if (opts.inverse) g = 255 - g;
    gris[p] = g;
    if (g < mini) mini = g;
    if (g > maxi) maxi = g;
  }
  const etendue = maxi - mini;
  // On n'étire que si l'image a un vrai contraste : sinon on amplifierait du bruit.
  const etire = etendue > 40;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const g = etire ? ((gris[p] - mini) / etendue) * 255 : gris[p];
    const val = Math.max(0, Math.min(255, g));
    d[i] = d[i + 1] = d[i + 2] = val;
    d[i + 3] = 255;
  }
  ctx.putImageData(zone, marge, marge);
  return c;
}

/**
 * Vignette d'une portion de l'image d'origine, en data-URL (aucun réseau).
 * Sert à afficher la ligne d'origine en regard de chaque ligne du tableau de
 * vérification : c'est le seul moyen de corriger sans rouvrir la capture.
 */
export function vignette(source: HTMLCanvasElement, boite: Boite, hauteurMax = 34): string | undefined {
  const x0 = Math.max(0, Math.floor(boite.x0));
  const y0 = Math.max(0, Math.floor(boite.y0));
  const w = Math.min(source.width - x0, Math.ceil(boite.x1 - boite.x0) + 1);
  const h = Math.min(source.height - y0, Math.ceil(boite.y1 - boite.y0) + 1);
  if (w <= 2 || h <= 2) return undefined;
  const facteur = Math.min(2.5, Math.max(1, hauteurMax / h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * facteur);
  c.height = Math.round(h * facteur);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, x0, y0, w, h, 0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}
