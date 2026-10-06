

// ──────────────────────────────────────────────────────────────
// Primitives SVG du rendu : palette, typographie, marqueurs, mesure du texte.
// Extrait de render.ts ; module pur, aucune dépendance DOM.
// ──────────────────────────────────────────────────────────────

// Palette et typographie alignées sur les jetons CSS de la « Console clinique
// dense » (voir src/styles/global.css) — un SVG exporté ne peut pas lire les
// variables CSS de la page, les valeurs sont donc dupliquées ici en dur.
// AUCUN changement de mise en page/axes : uniquement couleurs, graisses et
// tailles de police.

export const FONT = "'Inter', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";
export const INK = '#16233a';
export const AXIS = '#3c4a63';
export const GRID = '#e4e9f1';
export const MUTED = '#8592a8';
export const REF_FILL = '#e8f6ee';

export const MARKER_SHAPES = ['circle', 'square', 'triangle', 'diamond', 'circle-open', 'square-open'] as const;
export type MarkerShape = typeof MARKER_SHAPES[number];

/**
 * Motif de trait, en secours de la couleur et de la forme.
 *
 * La palette compte huit teintes et les marqueurs six formes : à partir de la
 * septième série d'un même graphe, deux courbes peuvent devenir jumelles — sur
 * douze paramètres, la créatinine et la ferritine sortaient du même rouge, et
 * se croisaient. Le motif de trait change tous les six rangs : forme et motif
 * combinés donnent dix-huit signatures distinctes.
 *
 * C'est aussi ce qui sauve la figure imprimée en noir et blanc, cas courant à
 * l'hôpital : les teintes y deviennent des gris voisins, la forme et le motif
 * restent.
 */
export const TRAITS = ['', '7 4', '2 3', '9 3 2 3'] as const;
export function motifTrait(idx: number, plusieursSeries: boolean): string {
  if (!plusieursSeries) return '';
  return TRAITS[Math.floor(idx / MARKER_SHAPES.length) % TRAITS.length];
}

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Largeur approchée d'un texte, en pixels.
 *
 * Le rendu est une fonction pure sans DOM : impossible de mesurer réellement.
 * Les largeurs étaient jusqu'ici estimées par « nombre de caractères × 6,1 »,
 * ce qui sous-estime lourdement les noms pleins de lettres larges — d'où la
 * légende où « Anticorps anti-membrane basale glomérulaire » recouvrait
 * « Rapport protéinurie/créatininurie ». On pondère donc par classe de
 * caractère : c'est grossier, mais l'erreur reste sous les 5 % sur les libellés
 * médicaux réels, largement dans la marge de sécurité qu'on s'accorde.
 */
export const LARGEURS: Record<string, number> = {
  i: 0.24, j: 0.24, l: 0.24, I: 0.28, '.': 0.28, ',': 0.28, ':': 0.28, ';': 0.28,
  "'": 0.20, '’': 0.20, '(': 0.33, ')': 0.33, '/': 0.28, ' ': 0.28, '·': 0.33,
  f: 0.30, t: 0.33, r: 0.36, '-': 0.33, '–': 0.56, '—': 0.83,
  m: 0.83, w: 0.72, M: 0.83, W: 0.94, '%': 0.89,
};
export function largeurTexte(texte: string, taille: number, gras = false): number {
  let u = 0;
  for (const c of texte) {
    if (LARGEURS[c] !== undefined) u += LARGEURS[c];
    else if (c >= '0' && c <= '9') u += 0.56;
    else if (c >= 'A' && c <= 'Z') u += 0.68;
    else u += 0.55; // minuscules courantes et lettres accentuées
  }
  return u * taille * (gras ? 1.06 : 1);
}

/**
 * Valeur à tracer. Pour les EFR, le mode « % théorique » ne change que
 * l'étiquette/échelle : les valeurs saisies (des pourcentages) sont tracées
 * telles quelles.
 */
/** Découpe un texte en lignes tenant dans `largeur` (mots entiers). */
export function couperLignes(texte: string, taille: number, largeur: number, gras = false): string[] {
  const mots = texte.split(/\s+/).filter(Boolean);
  const lignes: string[] = [];
  let courante = '';
  for (const mot of mots) {
    const essai = courante ? courante + ' ' + mot : mot;
    if (courante && largeurTexte(essai, taille, gras) > largeur) { lignes.push(courante); courante = mot; }
    else courante = essai;
  }
  if (courante) lignes.push(courante);
  return lignes.length ? lignes : [texte];
}

/**
 * Coordonnée écrite dans le SVG, arrondie au dixième de pixel.
 *
 * Les positions sortaient telles que calculées : « cx="96.74074074073943" ».
 * Sur un suivi de douze paramètres et quatre-vingts prélèvements, ces décimales
 * sans objet — l'écran ne descend pas sous le pixel, l'imprimante non plus —
 * représentaient un quart des 211 Ko du fichier. Autant de texte à analyser et
 * à réinsérer dans la page à chaque frappe, et autant de poids dans le SVG
 * exporté.
 */
export function n(v: number): string {
  return String(Math.round(v * 10) / 10);
}

export function marker(shape: MarkerShape, cx: number, cy: number, r: number, color: string): string {
  switch (shape) {
    case 'circle':
      return `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="${color}" stroke="#fff" stroke-width="1"/>`;
    case 'circle-open':
      return `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="#fff" stroke="${color}" stroke-width="2"/>`;
    case 'square':
      return `<rect x="${n(cx - r)}" y="${n(cy - r)}" width="${n(2 * r)}" height="${n(2 * r)}" fill="${color}" stroke="#fff" stroke-width="1"/>`;
    case 'square-open':
      return `<rect x="${n(cx - r)}" y="${n(cy - r)}" width="${n(2 * r)}" height="${n(2 * r)}" fill="#fff" stroke="${color}" stroke-width="2"/>`;
    case 'triangle': {
      const p = `${n(cx)},${n(cy - r * 1.2)} ${n(cx - r * 1.1)},${n(cy + r)} ${n(cx + r * 1.1)},${n(cy + r)}`;
      return `<polygon points="${p}" fill="${color}" stroke="#fff" stroke-width="1"/>`;
    }
    case 'diamond': {
      const p = `${n(cx)},${n(cy - r * 1.3)} ${n(cx + r * 1.3)},${n(cy)} ${n(cx)},${n(cy + r * 1.3)} ${n(cx - r * 1.3)},${n(cy)}`;
      return `<polygon points="${p}" fill="${color}" stroke="#fff" stroke-width="1"/>`;
    }
  }
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
