// ──────────────────────────────────────────────────────────────
// Découpe géométrique du tableau : bandes, étendue, blocs d'en-tête, colonnes.
// Extrait de pipeline.ts ; module pur, aucune dépendance DOM.
// ──────────────────────────────────────────────────────────────

import { colonnesDepuisGouttieres, mediane, profilBandes } from './structure';
import type { Bande, CarteEncre, Colonne } from './structure';

/**
 * Plus grand blanc INTERNE d'une bande de texte.
 *
 * C'est le discriminant entre une ligne de tableau et un titre : une ligne de
 * tableau est coupée par au moins une gouttière (large), un titre ou une ligne
 * de pied de page n'a que des espaces entre mots (étroites). Sans ce tri, le
 * titre « SERVEUR DE RESULTATS — BIOCHIMIE » devient une ligne d'analyte et,
 * pire, bouche toutes les gouttières de la découpe en colonnes.
 */
export function ecartMaxInterne(carte: CarteEncre, bande: Bande): number {
  const w = carte.largeur;
  const vu = new Uint8Array(w);
  const y0 = Math.max(0, bande.y0), y1 = Math.min(carte.hauteur - 1, bande.y1);
  for (let y = y0; y <= y1; y++) {
    const base = y * w;
    for (let x = 0; x < w; x++) if (carte.encre[base + x]) vu[x] = 1;
  }
  let a = 0; while (a < w && !vu[a]) a++;
  let b = w - 1; while (b >= 0 && !vu[b]) b--;
  if (b <= a) return 0;
  let max = 0, courant = 0;
  for (let x = a; x <= b; x++) {
    if (vu[x]) { if (courant > max) max = courant; courant = 0; }
    else courant++;
  }
  return max;
}

/** Étendue horizontale de l'encre d'une bande (null si la bande est vide). */
export function etendue(carte: CarteEncre, bande: Bande): { x0: number; x1: number } | null {
  const w = carte.largeur;
  const y0 = Math.max(0, bande.y0), y1 = Math.min(carte.hauteur - 1, bande.y1);
  let a = w, b = -1;
  for (let y = y0; y <= y1; y++) {
    const base = y * w;
    for (let x = 0; x < w; x++) {
      if (carte.encre[base + x]) { if (x < a) a = x; if (x > b) b = x; }
    }
  }
  return b < a ? null : { x0: a, x1: b };
}

/**
 * Plus longue suite CONTIGUË de bandes tabulaires : le tableau proprement dit,
 * débarrassé du titre, de la ligne « Dossier … » et du pied de page.
 *
 * Une exception, et elle compte : la ligne d'en-tête est très souvent posée sur
 * un BANDEAU DE COULEUR (gris clair, ou bleu nuit à texte blanc). Le seuillage
 * local prend ce fond pour de l'encre, la bande n'a alors plus aucun blanc
 * interne et le test ci-dessus la rejette — on perdait ainsi toutes les dates
 * sur trois captures du banc. On la récupère à sa signature : un pavé d'encre
 * qui couvre toute la largeur du tableau, collé au-dessus de la première ligne.
 */
export function isolerTableau(carte: CarteEncre, bandes: Bande[], hL: number): Bande[] {
  if (bandes.length <= 2) return bandes;
  const seuil = Math.max(4, Math.round(hL * 0.42));
  const tab = bandes.map(b => ecartMaxInterne(carte, b) >= seuil);
  let meilleurDebut = 0, meilleureLongueur = 0, debut = -1;
  for (let i = 0; i <= tab.length; i++) {
    if (i < tab.length && tab[i]) { if (debut < 0) debut = i; continue; }
    if (debut >= 0) {
      const n = i - debut;
      if (n > meilleureLongueur) { meilleureLongueur = n; meilleurDebut = debut; }
      debut = -1;
    }
  }
  // Moins de deux lignes tabulaires : on ne sait pas trancher, on garde tout.
  if (meilleureLongueur < 2) return bandes;

  // Récupération du bandeau d'en-tête, juste au-dessus.
  const i0 = meilleurDebut;
  if (i0 > 0) {
    const corps = bandes.slice(i0, i0 + meilleureLongueur);
    const ecarts: number[] = [];
    for (let k = 1; k < corps.length; k++) ecarts.push(corps[k].y0 - corps[k - 1].y1);
    const ecartTypique = ecarts.length ? mediane(ecarts) : hL;
    const largeurs = corps.map(b => etendue(carte, b)).filter((e): e is { x0: number; x1: number } => !!e);
    const gauche = Math.min(...largeurs.map(e => e.x0));
    const droite = Math.max(...largeurs.map(e => e.x1));
    const dessus = bandes[i0 - 1];
    const e = etendue(carte, dessus);
    const colle = corps[0].y0 - dessus.y1 <= Math.max(hL, ecartTypique * 2.5);
    const pleineLargeur = !!e && (e.x1 - e.x0) >= (droite - gauche) * 0.85;
    if (colle && pleineLargeur) return bandes.slice(i0 - 1, i0 + meilleureLongueur);
  }
  return bandes.slice(meilleurDebut, meilleurDebut + meilleureLongueur);
}

/**
 * Bandes décoratives : rangées d'icônes ou de pictogrammes (rappel, info,
 * nombre de pièces jointes…) que certains systèmes hospitaliers intercalent
 * SOUS la ligne de dates, une rangée par colonne. Ce ne sont pas des lignes
 * de texte : leur hauteur dépasse largement celle d'une ligne normale (des
 * icônes carrées, pas des chiffres). Les garder est doublement néfaste :
 * elles corrompent la découpe en colonnes (l'espacement des icônes n'a
 * aucun rapport avec celui des chiffres — une capture à 15 colonnes en
 * produisait 40) et, lues comme une ligne de résultats, elles fabriquent une
 * ligne fantôme sans la moindre valeur.
 *
 * On ne touche jamais à la première bande : c'est l'en-tête, et un en-tête
 * en gras sur deux graisses de police est parfois un peu plus haut qu'une
 * ligne de données — ce n'est pas une raison de l'écarter.
 */
export function ecarterBandesDecoratives(bandes: Bande[], hL: number): Bande[] {
  if (bandes.length <= 2) return bandes;
  const hauteurs = bandes.map(b => b.y1 - b.y0 + 1);
  const hRef = mediane(hauteurs.slice(1)) || hL;
  const seuil = Math.max(hL * 1.8, hRef * 1.8, 6);
  return bandes.filter((b, i) => i === 0 || b.y1 - b.y0 + 1 <= seuil);
}

/**
 * Plage d'en-tête d'une colonne : un en-tête déborde presque toujours la
 * largeur de ses valeurs (« 15/01/2024 » au-dessus de « 138 »). Découpé à la
 * largeur des valeurs, il ne reste que « 024 » et la colonne perd sa date —
 * c'est la cause exacte des « trois dates fondues en une ». On lui rend donc
 * l'espace qui va jusqu'à mi-chemin des colonnes voisines.
 */
export function plageEntete(colonnes: Colonne[], ci: number, largeur: number): Colonne {
  const g = ci > 0 ? Math.round((colonnes[ci - 1].x1 + colonnes[ci].x0) / 2) : 0;
  const d = ci < colonnes.length - 1
    ? Math.round((colonnes[ci].x1 + colonnes[ci + 1].x0) / 2)
    : largeur - 1;
  return { x0: g, x1: d };
}

/**
 * Blocs de texte d'une bande, mesurés sur les NIVEAUX DE GRIS et non sur la
 * carte d'encre.
 *
 * C'est indispensable pour la ligne d'en-tête, qui est presque toujours posée
 * sur un bandeau de couleur (gris pâle, ou bleu nuit à texte blanc). Le
 * seuillage local prend ce fond pour de l'encre : la bande devient un pavé
 * plein, tous les en-têtes se soudent en un seul bloc et les dates sont
 * perdues. Ici on prend le fond du bandeau comme référence (sa médiane) et on
 * ne retient que ce qui s'en écarte franchement — le texte, quelle que soit sa
 * polarité. Les filets de cellules, trop peu contrastés, disparaissent d'eux-
 * mêmes.
 */
export function blocsDeBande(
  gris: { largeur: number; hauteur: number; v: Float32Array },
  bande: Bande,
  hL: number,
  bornes: { gauche: number; droite: number },
  contraste = 60,
): Colonne[] {
  const w = gris.largeur;
  const x0 = Math.max(0, bornes.gauche), x1 = Math.min(w - 1, bornes.droite);
  const y0 = Math.max(0, bande.y0), y1 = Math.min(gris.hauteur - 1, bande.y1);
  if (x1 <= x0 || y1 < y0) return [];
  const largeur = x1 - x0 + 1;

  // Niveau du fond : la médiane de la bande (le bandeau occupe la majorité).
  const echantillon: number[] = [];
  for (let y = y0; y <= y1; y++) {
    const base = y * w;
    for (let x = x0; x <= x1; x += 2) echantillon.push(gris.v[base + x]);
  }
  const fond = mediane(echantillon);

  const vu = new Uint8Array(largeur);
  for (let y = y0; y <= y1; y++) {
    const base = y * w;
    for (let x = x0; x <= x1; x++) {
      if (Math.abs(gris.v[base + x] - fond) > contraste) vu[x - x0] = 1;
    }
  }

  const coupure = Math.max(3, Math.round(hL * 0.6));
  const minLargeur = Math.max(3, Math.round(hL * 0.3));
  const blocs: Colonne[] = [];
  let debut = -1, vide = 0;
  for (let i = 0; i < largeur; i++) {
    if (vu[i]) {
      if (debut < 0) debut = i;
      else if (vide >= coupure) { blocs.push({ x0: x0 + debut, x1: x0 + i - vide - 1 }); debut = i; }
      vide = 0;
    } else if (debut >= 0) vide++;
  }
  if (debut >= 0) blocs.push({ x0: x0 + debut, x1: x0 + largeur - 1 - vide });
  // Un filet vertical isolé n'est pas un en-tête.
  return blocs.filter(b => b.x1 - b.x0 + 1 >= minLargeur);
}

/**
 * Bloc d'en-tête d'une colonne : celui qui la recouvre le mieux ; à défaut de
 * recouvrement, le plus proche, et seulement s'il est vraiment au-dessus.
 */
export function blocPourColonne(blocs: Colonne[], col: Colonne, hL: number): Colonne | null {
  if (!blocs.length) return null;
  const recouvrement = (b: Colonne) => Math.min(b.x1, col.x1) - Math.max(b.x0, col.x0) + 1;
  const distance = (b: Colonne) => Math.max(b.x0 - col.x1, col.x0 - b.x1, 0);
  let meilleur = blocs[0];
  for (const b of blocs) {
    const rb = recouvrement(b), rm = recouvrement(meilleur);
    if (rb > rm || (rb === rm && distance(b) < distance(meilleur))) meilleur = b;
  }
  // Un en-tête est au-dessus de sa colonne, pas trois colonnes plus loin.
  return recouvrement(meilleur) > 0 || distance(meilleur) <= hL * 2 ? meilleur : null;
}

/**
 * Territoire finalement retenu pour l'en-tête d'une colonne, marge de garde
 * incluse.
 *
 * Un bloc de texte un peu plus large que sa colonne de valeurs (une date au-
 * dessus d'un nombre à trois chiffres) garde tout son débordement — c'est le
 * cas courant, et la plage (jusqu'à mi-chemin des colonnes voisines) est
 * justement faite pour ça.
 *
 * Un bloc ANORMALEMENT plus large (plus de trois fois sa colonne, et 1,5 fois
 * sa plage) est plafonné À la plage : c'est le signe que `blocsDeBande` a
 * fusionné plusieurs en-têtes voisins en un seul bloc (en-têtes denses qui se
 * touchent, beaucoup de colonnes de dates peu espacées) — sans ce plafond,
 * CHAQUE colonne se voyait attribuer la ligne entière, et une seule date
 * envahissait tous les rôles (plus de colonne de noms du tout).
 */
export function retenirBlocEntete(bloc: Colonne | null, col: Colonne, plage: Colonne, marge: number): Colonne {
  if (!bloc) return plage;
  const largeurCol = Math.max(1, col.x1 - col.x0 + 1);
  const largeurBloc = bloc.x1 - bloc.x0 + 1;
  const largeurPlage = plage.x1 - plage.x0 + 1;
  const enorme = largeurBloc > largeurCol * 3 && largeurBloc > largeurPlage * 1.5;
  return enorme
    ? { x0: Math.max(bloc.x0, plage.x0), x1: Math.min(bloc.x1, plage.x1) }
    : { x0: bloc.x0 - marge, x1: bloc.x1 + marge };
}

/** Découpe en colonnes, tolérante à une bande débordante (titre resté collé). */
export function decouperTableau(carte: CarteEncre, bandes: Bande[], hL: number): Colonne[] {
  const profil = profilBandes(carte, bandes);
  const minGouttiere = Math.max(5, Math.round(hL * 0.5));
  const minColonne = Math.max(4, Math.round(hL * 0.35));
  const tolerance = Math.floor(bandes.length * 0.12);
  return colonnesDepuisGouttieres(profil, minGouttiere, minColonne, tolerance);
}

// ── 2. Fabrique des images de cellule ───────────────────────────
