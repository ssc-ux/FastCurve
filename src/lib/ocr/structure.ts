// ──────────────────────────────────────────────────────────────
// Détection de la structure d'un tableau AVANT l'OCR.
//
// On ne travaille que sur une carte d'encre binaire (1 = pixel sombre).
// Par projection horizontale on isole les BANDES (lignes de texte), par
// projection verticale les GOUTTIÈRES (colonnes de blanc qui séparent les
// colonnes du tableau). Reconnaître ensuite cellule par cellule est bien plus
// fiable qu'un OCR global suivi d'une reconstruction géométrique : chaque
// cellule est lue isolément, sans que ses voisines ne perturbent la
// segmentation de Tesseract.
//
// Tout ce module est pur (pas de DOM) : il est testable hors navigateur.
// ──────────────────────────────────────────────────────────────

export interface CarteEncre {
  largeur: number;
  hauteur: number;
  /** 1 = encre, 0 = fond. Longueur = largeur × hauteur. */
  encre: Uint8Array;
}

export interface Bande { y0: number; y1: number; }
export interface Colonne { x0: number; x1: number; }

/** Profil horizontal : nombre de pixels d'encre par ligne de pixels. */
export function profilHorizontal(carte: CarteEncre): Int32Array {
  const { largeur, hauteur, encre } = carte;
  const p = new Int32Array(hauteur);
  for (let y = 0; y < hauteur; y++) {
    let n = 0;
    const base = y * largeur;
    for (let x = 0; x < largeur; x++) n += encre[base + x];
    p[y] = n;
  }
  return p;
}

/**
 * Profil vertical restreint aux bandes de texte : nombre de pixels d'encre par
 * colonne de pixels. En ignorant l'espace entre les lignes, les gouttières
 * ressortent nettement même quand le tableau a des filets horizontaux.
 */
export function profilVertical(carte: CarteEncre, bandes: Bande[]): Int32Array {
  const { largeur, encre } = carte;
  const p = new Int32Array(largeur);
  const zones = bandes.length ? bandes : [{ y0: 0, y1: carte.hauteur - 1 }];
  for (const b of zones) {
    for (let y = b.y0; y <= b.y1; y++) {
      const base = y * largeur;
      for (let x = 0; x < largeur; x++) p[x] += encre[base + x];
    }
  }
  return p;
}

/** Médiane d'un tableau de nombres (0 si vide). */
export function mediane(valeurs: number[]): number {
  if (!valeurs.length) return 0;
  const t = [...valeurs].sort((a, b) => a - b);
  return t[Math.floor(t.length / 2)];
}

/**
 * Bandes de texte : suites de lignes de pixels contenant de l'encre.
 *
 * - `bruit` : nombre de pixels d'encre en deçà duquel une ligne est du fond
 *   (élimine le poussier et les bords).
 * - Les bandes trop fines par rapport à la médiane (filets horizontaux d'un
 *   tableau encadré, soulignements) sont écartées.
 * - Deux bandes séparées par un intervalle minuscule sont fusionnées
 *   (accents détachés, exposants).
 */
export function detecterBandes(carte: CarteEncre, opts: { bruit?: number } = {}): Bande[] {
  const prof = profilHorizontal(carte);
  const bruit = opts.bruit ?? Math.max(1, Math.round(carte.largeur * 0.002));
  const brutes: Bande[] = [];
  let debut = -1;
  for (let y = 0; y < carte.hauteur; y++) {
    const plein = prof[y] > bruit;
    if (plein && debut < 0) debut = y;
    else if (!plein && debut >= 0) { brutes.push({ y0: debut, y1: y - 1 }); debut = -1; }
  }
  if (debut >= 0) brutes.push({ y0: debut, y1: carte.hauteur - 1 });
  if (!brutes.length) return [];

  // Fusion des fragments très proches (accents, jambages coupés).
  const hauteurs = brutes.map(b => b.y1 - b.y0 + 1);
  const hMed = mediane(hauteurs.filter(h => h > 2)) || mediane(hauteurs);
  const ecart = Math.max(1, Math.round(hMed * 0.25));
  const fusion: Bande[] = [];
  for (const b of brutes) {
    const p = fusion[fusion.length - 1];
    if (p && b.y0 - p.y1 <= ecart) p.y1 = b.y1;
    else fusion.push({ ...b });
  }

  // Rejet des filets (barres horizontales fines) : une bande de texte fait au
  // moins 45 % de la hauteur médiane.
  const hFus = fusion.map(b => b.y1 - b.y0 + 1);
  const hRef = mediane(hFus.filter(h => h >= 4)) || mediane(hFus);
  const minH = Math.max(3, Math.round(hRef * 0.45));
  return fusion.filter(b => b.y1 - b.y0 + 1 >= minH);
}

/** Hauteur médiane des bandes (hauteur d'une ligne de texte, en pixels). */
export function hauteurLigne(bandes: Bande[]): number {
  return mediane(bandes.map(b => b.y1 - b.y0 + 1));
}

export interface Gouttiere { x0: number; x1: number; largeur: number; }

/**
 * Gouttières : plages horizontales sans encre (ou presque), d'au moins
 * `largeurMin` pixels. Ce sont les séparations candidates entre colonnes.
 */
export function detecterGouttieres(profil: Int32Array, largeurMin: number, seuil = 0): Gouttiere[] {
  const out: Gouttiere[] = [];
  let debut = -1;
  for (let x = 0; x < profil.length; x++) {
    const vide = profil[x] <= seuil;
    if (vide && debut < 0) debut = x;
    else if (!vide && debut >= 0) {
      if (x - debut >= largeurMin) out.push({ x0: debut, x1: x - 1, largeur: x - debut });
      debut = -1;
    }
  }
  if (debut >= 0 && profil.length - debut >= largeurMin) {
    out.push({ x0: debut, x1: profil.length - 1, largeur: profil.length - debut });
  }
  return out;
}

/**
 * Découpe en colonnes à partir des gouttières : les colonnes sont les plages
 * d'encre entre deux gouttières. Les colonnes vides ou minuscules (filets
 * verticaux d'un tableau encadré) sont écartées.
 */
export function colonnesDepuisGouttieres(profil: Int32Array, largeurMinGouttiere: number, largeurMinColonne = 4): Colonne[] {
  const g = detecterGouttieres(profil, largeurMinGouttiere);
  const bornes: Colonne[] = [];
  let x = 0;
  for (const gg of g) {
    if (gg.x0 > x) bornes.push({ x0: x, x1: gg.x0 - 1 });
    x = gg.x1 + 1;
  }
  if (x < profil.length) bornes.push({ x0: x, x1: profil.length - 1 });
  return bornes.filter(c => c.x1 - c.x0 + 1 >= largeurMinColonne);
}

/**
 * Découpe en colonnes ANCRÉE sur des abscisses connues (les centres des dates
 * de l'en-tête). Entre deux ancres consécutives, la frontière est posée au
 * milieu de la gouttière la plus large ; à défaut, à mi-chemin.
 *
 * C'est la méthode la plus sûre quand l'en-tête a été lu : les colonnes de
 * valeurs sont alors calées sur la structure réelle du tableau, pas sur des
 * blancs qui peuvent être fortuits (mots courts, cellules vides).
 */
export function colonnesDepuisAncres(
  profil: Int32Array,
  ancres: number[],
  bornes: { gauche: number; droite: number },
  largeurMinGouttiere: number,
): Colonne[] {
  const tri = [...ancres].sort((a, b) => a - b);
  const gouttieres = detecterGouttieres(profil, largeurMinGouttiere);
  const frontiere = (a: number, b: number): number => {
    const dedans = gouttieres.filter(g => g.x0 > a && g.x1 < b);
    if (dedans.length) {
      const meilleure = dedans.reduce((m, g) => (g.largeur > m.largeur ? g : m));
      return Math.round((meilleure.x0 + meilleure.x1) / 2);
    }
    return Math.round((a + b) / 2);
  };
  const out: Colonne[] = [];
  for (let i = 0; i < tri.length; i++) {
    const g = i === 0 ? frontiere(bornes.gauche, tri[0]) : frontiere(tri[i - 1], tri[i]);
    const d = i === tri.length - 1 ? bornes.droite : frontiere(tri[i], tri[i + 1]);
    out.push({ x0: g, x1: d });
  }
  return out;
}

/**
 * Une cellule contient-elle de l'encre ? (sert à distinguer « case vide » de
 * « case mal lue » : une case vide dans une ligne par ailleurs remplie est
 * suspecte, une case sans encre est simplement vide.)
 */
export function encreDansCellule(carte: CarteEncre, bande: Bande, col: Colonne): number {
  let n = 0;
  const x0 = Math.max(0, col.x0), x1 = Math.min(carte.largeur - 1, col.x1);
  const y0 = Math.max(0, bande.y0), y1 = Math.min(carte.hauteur - 1, bande.y1);
  for (let y = y0; y <= y1; y++) {
    const base = y * carte.largeur;
    for (let x = x0; x <= x1; x++) n += carte.encre[base + x];
  }
  return n;
}

/** Boîte englobante de l'encre d'une cellule (null si la cellule est vide). */
export function boiteEncre(carte: CarteEncre, bande: Bande, col: Colonne): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const cx0 = Math.max(0, col.x0), cx1 = Math.min(carte.largeur - 1, col.x1);
  const by0 = Math.max(0, bande.y0), by1 = Math.min(carte.hauteur - 1, bande.y1);
  for (let y = by0; y <= by1; y++) {
    const base = y * carte.largeur;
    for (let x = cx0; x <= cx1; x++) {
      if (carte.encre[base + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < x0 ? null : { x0, y0, x1, y1 };
}
