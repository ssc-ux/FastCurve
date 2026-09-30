// ──────────────────────────────────────────────────────────────
// PRISE DE VUE GUIDÉE : repérer un tableau dans l'image de la caméra, en
// direct, et dire au médecin quand déclencher.
//
// Rien ici ne lit le texte : on ne cherche que la FORME d'un tableau (des
// lignes de texte régulières, séparées en colonnes par de larges blancs), sur
// une image réduite, plusieurs fois par seconde. C'est la même analyse d'encre
// que celle qui découpe les captures d'écran (structure.ts), appliquée à un
// flux vidéo. La lecture proprement dite n'a lieu qu'après la photo.
// ──────────────────────────────────────────────────────────────

import { detecterBandes, effacerFilets, hauteurLigne, type Bande, type CarteEncre } from '../ocr/structure';
import { ecartMaxInterne, etendue } from '../ocr/pipeline';

export interface BoiteTableau { x0: number; y0: number; x1: number; y1: number; }

export interface TableauRepere {
  boite: BoiteTableau;
  /** Hauteur de ligne de texte, en pixels de la carte analysée. */
  hL: number;
  /** Nombre de lignes du tableau repérées. */
  lignes: number;
}

/**
 * Inclinaison dominante des lignes de texte, en degrés (positif : le texte
 * « monte » vers la droite). Méthode du profil cisaillé : pour chaque angle
 * candidat, on projette l'encre le long de cet angle ; les lignes de texte ne
 * forment des pics nets que dans la bonne direction.
 */
export function estimerInclinaison(carte: CarteEncre, x0 = 0, x1 = carte.largeur - 1, maxDeg = 12): number {
  const { largeur: W, hauteur: H, encre } = carte;
  const pts: number[] = [];
  const pas = Math.max(1, Math.floor((x1 - x0) / 300));
  for (let y = 0; y < H; y += 1) {
    for (let x = x0; x <= x1; x += pas) if (encre[y * W + x]) pts.push(x, y);
  }
  if (pts.length < 40) return 0;
  const xc = (x0 + x1) / 2;
  let meilleur = 0, score = -1;
  for (let a = -maxDeg; a <= maxDeg; a += 0.5) {
    const t = Math.tan((a * Math.PI) / 180);
    const hist = new Float64Array(H * 2 + 4);
    for (let i = 0; i < pts.length; i += 2) {
      const yp = Math.round(pts[i + 1] + (pts[i] - xc) * t) + H;
      if (yp >= 0 && yp < hist.length) hist[yp]++;
    }
    let s = 0;
    for (let i = 0; i < hist.length; i++) s += hist[i] * hist[i];
    if (s > score) { score = s; meilleur = a; }
  }
  return meilleur;
}

/**
 * Cisaillement horizontal (perspective d'une photo prise un peu de haut ou de
 * bas) : les colonnes « penchent » — x dérive linéairement avec y. On cherche
 * le décalage par ligne `s` (px de x par px de y) qui rend le profil vertical
 * de l'encre le plus contrasté : c'est là que les gouttières entre colonnes
 * redeviennent droites.
 */
export function estimerCisaillement(carte: CarteEncre, maxPente = 0.2): number {
  const { largeur: W, hauteur: H, encre } = carte;
  const pts: number[] = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (encre[y * W + x]) pts.push(x, y);
  if (pts.length < 40) return 0;
  const yc = H / 2;
  let meilleur = 0, score = -1;
  for (let s = -maxPente; s <= maxPente + 1e-9; s += 0.005) {
    const hist = new Float64Array(W * 2);
    for (let i = 0; i < pts.length; i += 2) {
      const xp = Math.round(pts[i] - (pts[i + 1] - yc) * s) + (W >> 1);
      if (xp >= 0 && xp < hist.length) hist[xp]++;
    }
    // Contraste du profil : somme des carrés des différences voisines
    // (des gouttières franches créent de fortes transitions).
    let sc = 0;
    for (let i = 1; i < hist.length; i++) { const d = hist[i] - hist[i - 1]; sc += d * d; }
    if (sc > score) { score = sc; meilleur = s; }
  }
  return Math.round(meilleur * 1000) / 1000;
}

/**
 * Tableau le plus vraisemblable de la carte : la plus longue suite de lignes
 * de texte consécutives qui portent chacune une large gouttière (au moins
 * deux colonnes). Au moins trois lignes, sinon ce n'est pas un tableau.
 */
export function trouverTableau(carteBrute: CarteEncre): TableauRepere | null {
  const toutes = detecterBandes(carteBrute);
  if (toutes.length < 3) return null;
  const hL = hauteurLigne(toutes) || 6;
  const carte = effacerFilets(carteBrute, hL);
  const estLigne = (b: Bande) => ecartMaxInterne(carte, b) >= Math.max(4, hL * 1.5);
  let meilleure: Bande[] = [], courante: Bande[] = [];
  for (const b of toutes) {
    if (!estLigne(b)) { courante = []; continue; }
    const prec = courante[courante.length - 1];
    if (prec && b.y0 - prec.y1 <= hL * 3) courante.push(b);
    else courante = [b];
    if (courante.length > meilleure.length) meilleure = [...courante];
  }
  if (meilleure.length < 3) return null;
  let x0 = Infinity, x1 = -Infinity;
  for (const b of meilleure) {
    const e = etendue(carte, b);
    if (e) { x0 = Math.min(x0, e.x0); x1 = Math.max(x1, e.x1); }
  }
  if (!isFinite(x0)) return null;
  // Bords du tableau : là où l'encre est présente sur au moins la moitié des
  // lignes (dans une fenêtre de quelques caractères). Une barre d'icônes ou un
  // décor à côté du tableau n'occupe que quelques lignes et reste dehors.
  const W = carte.largeur;
  const fenetre = Math.max(3, Math.round(hL * 3));
  const presence = new Float32Array(W);
  for (const b of meilleure) {
    const aEncre = new Uint8Array(W);
    for (let y = b.y0; y <= b.y1; y++) for (let x = 0; x < W; x++) if (carte.encre[y * W + x]) aEncre[x] = 1;
    // Dilatation horizontale : une colonne de texte « couvre » sa fenêtre.
    let dernier = -Infinity;
    for (let x = 0; x < W; x++) { if (aEncre[x]) dernier = x; if (x - dernier <= fenetre) presence[x]++; }
  }
  const seuil = meilleure.length * 0.5;
  let gx0 = x0, gx1 = x1;
  while (gx0 < x1 && presence[gx0] < seuil) gx0++;
  while (gx1 > gx0 && presence[gx1] < seuil) gx1--;
  if (gx1 - gx0 > (x1 - x0) * 0.4) { x0 = gx0; x1 = gx1; }
  return {
    boite: { x0, y0: meilleure[0].y0, x1, y1: meilleure[meilleure.length - 1].y1 },
    hL, lignes: meilleure.length,
  };
}

/** Netteté : variance du laplacien sur la zone (plus c'est grand, plus c'est net). */
export function nettete(gris: { largeur: number; hauteur: number; v: Float32Array }, b?: BoiteTableau): number {
  const { largeur: W, hauteur: H, v } = gris;
  const x0 = Math.max(1, Math.floor(b?.x0 ?? 1)), x1 = Math.min(W - 2, Math.ceil(b?.x1 ?? W - 2));
  const y0 = Math.max(1, Math.floor(b?.y0 ?? 1)), y1 = Math.min(H - 2, Math.ceil(b?.y1 ?? H - 2));
  let n = 0, s = 0, s2 = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * W + x;
      const l = 4 * v[i] - v[i - 1] - v[i + 1] - v[i - W] - v[i + W];
      s += l; s2 += l * l; n++;
    }
  }
  if (!n) return 0;
  const m = s / n;
  return s2 / n - m * m;
}

export type EtatCadrage = 'aucun' | 'penche' | 'biais' | 'loin' | 'petit' | 'flou' | 'ok';

export interface MesureCadrage {
  tableau: TableauRepere | null;
  /** Inclinaison globale (degrés). */
  angle: number;
  /** Différence d'inclinaison entre moitiés gauche et droite du tableau (degrés) : signe d'une prise de biais. */
  biais: number;
  /** Largeur de l'image analysée. */
  largeur: number;
  /** Rapport netteté / meilleure netteté récente (0..1). */
  netteteRelative: number;
  /** Facteur entre l'image analysée et la photo pleine résolution. */
  echellePleine: number;
}

export interface Verdict { etat: EtatCadrage; message: string; }

/** Traduit une mesure en consigne pour le médecin (une seule à la fois, la plus utile). */
export function verdictCadrage(m: MesureCadrage): Verdict {
  const t = m.tableau;
  if (!t) return { etat: 'aucun', message: 'Visez le tableau de résultats' };
  if (Math.abs(m.angle) > 4) return { etat: 'penche', message: 'Tenez le téléphone droit' };
  if (Math.abs(m.biais) > 2.5) return { etat: 'biais', message: 'Placez-vous bien en face de l’écran' };
  const part = (t.boite.x1 - t.boite.x0) / m.largeur;
  if (part < 0.5) return { etat: 'loin', message: 'Rapprochez-vous du tableau' };
  // Texte trop petit, même en pleine résolution : il ne sera pas lisible.
  if (t.hL * m.echellePleine < 14) return { etat: 'petit', message: 'Texte trop petit : zoomez dans Sillage ou rapprochez-vous' };
  if (m.netteteRelative < 0.45) return { etat: 'flou', message: 'Image floue : ne bougez plus' };
  return { etat: 'ok', message: 'Ne bougez plus…' };
}
