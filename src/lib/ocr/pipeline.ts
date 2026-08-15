// ──────────────────────────────────────────────────────────────
// LA CHAÎNE COMPLÈTE : d'une capture d'écran à un tableau vérifiable.
//
//   préparation → structure → rôles → OCR cellule par cellule
//                → correction → confiance
//
// Le principe qui gouverne tout le module : on ne demande JAMAIS à Tesseract de
// comprendre un tableau. On lui donne une case à la fois, agrandie, avec la
// liste des caractères qu'elle a le droit de contenir. La géométrie du tableau
// est établie AVANT, par analyse d'encre, et c'est elle qui dit ce qu'est une
// ligne, ce qu'est une colonne, et à quoi sert chaque colonne.
//
// Les cinq erreurs relevées par le médecin sont traitées ici, chacune à son
// endroit :
//   1 & 2. bornes de normes prises pour des résultats → `affecterRoles` écarte
//          toute colonne dont l'en-tête ou le contenu trahit des normes ;
//   3.     virgule décimale perdue → `analyserCellule` voit la virgule dans
//          l'encre et `reparerNombre` la rétablit ;
//   4.     unité agglutinée au nom → `nettoyerNom` ;
//   5.     colonnes de dates fondues en une → la découpe en colonnes est faite
//          par projection d'encre, pas par regroupement de mots OCR.
//
// 100% local : rien ne sort du navigateur.
// ──────────────────────────────────────────────────────────────

import { matchCatalog } from '../models/catalog';
import { jugerDate, jugerNom, jugerValeur } from './confiance';
import { reparerNombre } from './correction';
import { lireCellules, type ModeCellule } from './ocr';
import {
  canvasSource, carteEncreLocale, grisCanalMin, rendreCellule, vignette,
  type Boite,
} from './preparation';
import {
  affecterRoles, lireDate, nettoyerNom, roleDepuisEntete,
  type ColonneCandidate, type DateLue as DateEntete,
} from './roles';
import {
  analyserCellule, boiteEncre, colonnesDepuisGouttieres, detecterBandes,
  encreDansCellule, hauteurLigne, mediane, profilBandes,
  type Bande, type CarteEncre, type Colonne, type GeometrieCellule,
} from './structure';

// ── Ce que la chaîne rend ───────────────────────────────────────

export interface CelluleLue {
  /** Texte proposé au médecin ('' = case vide). */
  texte: string;
  /** Doute de LECTURE (jamais d'anormalité clinique) → case jaune. */
  douteux: boolean;
  /** Raisons du doute, en français, pour l'infobulle. */
  motifs: string[];
}

export interface LigneLue {
  nom: string;
  unite: string;
  nomDouteux: boolean;
  nomMotifs: string[];
  cellules: CelluleLue[];
  /** Portion de l'image d'origine correspondant à la ligne (data-URL). */
  vignette?: string;
}

export interface DateLue {
  iso: string | null;
  brut: string;
  douteux: boolean;
  motifs: string[];
}

export interface TableauLu {
  dates: DateLue[];
  lignes: LigneLue[];
  /** Vrai quand la capture n'a rien donné d'exploitable. */
  echec: boolean;
  /** Message en français à montrer au médecin en cas d'échec. */
  message: string;
}

export interface OptionsReconnaissance {
  /** Avancement : (fait, total, étape en français). */
  onProgress?: (fait: number, total: number, etape: string) => void;
  /** Année à supposer quand l'en-tête ne porte que « 12/03 ». */
  anneeParDefaut?: number;
  /** Produire les vignettes de ligne (inutile pour le banc). */
  vignettes?: boolean;
  /** Interrompt la lecture entre deux lots. */
  annule?: () => boolean;
}

/** Garde-fou : au-delà, la capture n'est pas un tableau de biologie. */
const MAX_CELLULES = 700;

function echec(message: string): TableauLu {
  return { dates: [], lignes: [], echec: true, message };
}

// ── 1. Isoler le tableau dans la page ───────────────────────────

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
function etendue(carte: CarteEncre, bande: Bande): { x0: number; x1: number } | null {
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

/** Découpe en colonnes, tolérante à une bande débordante (titre resté collé). */
export function decouperTableau(carte: CarteEncre, bandes: Bande[], hL: number): Colonne[] {
  const profil = profilBandes(carte, bandes);
  const minGouttiere = Math.max(5, Math.round(hL * 0.5));
  const minColonne = Math.max(4, Math.round(hL * 0.35));
  const tolerance = Math.floor(bandes.length * 0.12);
  return colonnesDepuisGouttieres(profil, minGouttiere, minColonne, tolerance);
}

// ── 2. Fabrique des images de cellule ───────────────────────────

interface Cellule {
  boite: Boite;
  encre: number;
  inverse: boolean;
}

/**
 * Boîte d'une cellule, resserrée sur son encre pour que l'agrandissement porte.
 *
 * `limites` donne le droit de déborder la colonne jusqu'au milieu des
 * gouttières voisines, et ce détail vaut plusieurs points : les valeurs étant
 * alignées à droite, la colonne est calée au pixel près sur le chiffre le plus
 * à gauche de la plus longue valeur. Découpée à ras, cette valeur-là perd son
 * premier chiffre — « 1240 » devenait « 240 », faux d'un facteur cinq et
 * parfaitement crédible.
 */
function celluleDe(
  carte: CarteEncre, polarite: Uint8Array, bande: Bande, col: Colonne, hL: number,
  limites?: Colonne,
): Cellule {
  const marge = Math.max(3, Math.round(hL * 0.45));
  const bornes = limites ?? col;
  const encre = encreDansCellule(carte, bande, col);
  const b = boiteEncre(carte, bande, col);
  const x0 = b ? Math.max(bornes.x0, b.x0 - marge) : col.x0;
  const x1 = b ? Math.min(bornes.x1, b.x1 + marge) : col.x1;
  let sombres = 0;
  for (let y = Math.max(0, bande.y0); y <= Math.min(polarite.length - 1, bande.y1); y++) {
    sombres += polarite[y];
  }
  const hauteur = bande.y1 - bande.y0 + 1;
  return {
    boite: { x0, y0: bande.y0 - marge, x1, y1: bande.y1 + marge },
    encre,
    inverse: sombres > hauteur / 2,
  };
}

// ── 3. La chaîne ────────────────────────────────────────────────

export async function reconnaitreTableau(
  img: HTMLImageElement | HTMLCanvasElement,
  opts: OptionsReconnaissance = {},
): Promise<TableauLu> {
  const annule = () => !!opts.annule?.();
  const avancer = (f: number, t: number, e: string) => opts.onProgress?.(f, t, e);

  // — Préparation —
  avancer(0, 1, 'Préparation de l’image…');
  const source = canvasSource(img);
  const gris = grisCanalMin(source);
  const { carte, polarite } = carteEncreLocale(gris);

  // — Structure —
  const toutes = detecterBandes(carte);
  if (toutes.length < 2) {
    return echec('Je n’ai trouvé aucun tableau dans cette image.');
  }
  const hL = hauteurLigne(toutes) || 12;
  const bandes = isolerTableau(carte, toutes, hL);
  if (bandes.length < 2) {
    return echec('Je n’ai trouvé qu’une seule ligne de texte : ce n’est pas un tableau.');
  }
  // Les colonnes sont établies sur les LIGNES DE DONNÉES seulement : la ligne
  // d'en-tête, plus large (une date au-dessus d'un nombre à trois chiffres) et
  // parfois posée sur un fond plein, boucherait toutes les gouttières.
  const colonnes = decouperTableau(carte, bandes.slice(1), hL);
  if (colonnes.length < 2) {
    return echec(
      'Je n’ai pas su séparer les colonnes de cette capture. ' +
      'Essayez une capture plus large, ou collez le tableau depuis Excel.',
    );
  }
  if (bandes.length * colonnes.length > MAX_CELLULES) {
    return echec('Cette image est trop dense pour être lue d’un bloc — recadrez sur le tableau.');
  }

  const cellule = (bi: number, ci: number) =>
    celluleDe(carte, polarite, bandes[bi], colonnes[ci], hL, plageEntete(colonnes, ci, carte.largeur));
  // Une case de résultat est agrandie plus fort que les autres : c'est là que
  // se joue la virgule décimale, et une virgule de deux pixels ne survit pas à
  // un agrandissement timide.
  const rendre = (c: Cellule, mode: ModeCellule) =>
    rendreCellule(source, c.boite, { inverse: c.inverse, hauteurCible: mode === 'valeur' ? 68 : 46 });

  const bornesTable = {
    gauche: colonnes[0].x0,
    droite: colonnes[colonnes.length - 1].x1,
  };
  const blocsEntete = new Map<number, Colonne[]>();

  /**
   * Cellule d'en-tête : on part du bloc de texte réellement présent dans la
   * bande d'en-tête, pas de la largeur des valeurs. À défaut, la plage élargie.
   */
  const celluleEntete = (bi: number, ci: number): Cellule => {
    if (!blocsEntete.has(bi)) blocsEntete.set(bi, blocsDeBande(gris, bandes[bi], hL, bornesTable));
    const col = colonnes[ci];
    const plage = plageEntete(colonnes, ci, carte.largeur);
    const bloc = blocPourColonne(blocsEntete.get(bi)!, col, hL);
    // Les valeurs étant alignées à droite et l'en-tête centré, le bloc déborde
    // très souvent la colonne vers la gauche : on le suit tel quel. La plage
    // ne sert que si aucun bloc ne se rattache à la colonne.
    const marge = Math.max(2, Math.round(hL * 0.2));
    const retenu = bloc ? { x0: bloc.x0 - marge, x1: bloc.x1 + marge } : plage;
    return {
      boite: {
        x0: retenu.x0, y0: bandes[bi].y0 - marge,
        x1: retenu.x1, y1: bandes[bi].y1 + marge,
      },
      encre: Math.max(1, encreDansCellule(carte, bandes[bi], retenu)),
      inverse: celluleDe(carte, polarite, bandes[bi], col, hL).inverse,
    };
  };

  /** Lit un lot de cellules ; les cases sans encre ne coûtent aucun appel OCR. */
  async function lire(
    cases: Cellule[], mode: ModeCellule, etape: string,
  ): Promise<{ texte: string; confiance: number }[]> {
    const utiles: number[] = [];
    const canvases: HTMLCanvasElement[] = [];
    cases.forEach((c, i) => {
      if (c.encre >= 3) { utiles.push(i); canvases.push(rendre(c, mode)); }
    });
    const out = cases.map(() => ({ texte: '', confiance: 0 }));
    if (!canvases.length) return out;
    const lus = await lireCellules(canvases, mode, (f, t) => avancer(f, t, etape));
    utiles.forEach((i, k) => { out[i] = { texte: lus[k].texte, confiance: lus[k].confiance }; });
    return out;
  }

  // — En-tête : quelle bande, et que dit-elle ? —
  avancer(0, 1, 'Lecture de l’en-tête…');
  let iEntete = 0;
  let entetes = (await lire(colonnes.map((_, ci) => celluleEntete(0, ci)), 'texte', 'En-tête')).map(r => r.texte);
  if (annule()) return echec('Lecture interrompue.');

  const scoreEntete = (txts: string[]) =>
    txts.filter(t => !!lireDate(t)).length * 2 + txts.filter(t => !!roleDepuisEntete(t)).length;

  // La bande retenue peut être un reliquat de titre resté collé au tableau :
  // si elle ne dit rien, on essaie la suivante, une seule fois.
  if (scoreEntete(entetes) === 0 && bandes.length >= 3) {
    const suivantes = (await lire(colonnes.map((_, ci) => celluleEntete(1, ci)), 'texte', 'En-tête')).map(r => r.texte);
    if (scoreEntete(suivantes) > 0) { iEntete = 1; entetes = suivantes; }
  }
  if (annule()) return echec('Lecture interrompue.');

  const iDonnees: number[] = [];
  for (let i = iEntete + 1; i < bandes.length; i++) iDonnees.push(i);
  if (!iDonnees.length) return echec('Le tableau ne contient aucune ligne de résultats.');

  // — Relecture chiffrée des en-têtes indécis : une date mal lue en mode texte
  //   (« 12I03I2025 ») redevient lisible avec la liste blanche des dates. C'est
  //   ce qui évite trois colonnes de dates fondues en une seule sans date. —
  const indecis = colonnes.map((_, ci) => ci)
    .filter(ci => !lireDate(entetes[ci]) && !roleDepuisEntete(entetes[ci]));
  if (indecis.length) {
    const relus = await lire(indecis.map(ci => celluleEntete(iEntete, ci)), 'date', 'En-tête (dates)');
    indecis.forEach((ci, k) => { if (lireDate(relus[k].texte)) entetes[ci] = relus[k].texte; });
  }
  if (annule()) return echec('Lecture interrompue.');

  // — Échantillon de contenu, seulement là où l'en-tête n'a pas tranché —
  const aEchantillonner = colonnes.map((_, ci) => ci)
    .filter(ci => !lireDate(entetes[ci]) && !roleDepuisEntete(entetes[ci]));
  const echantillons: string[][] = colonnes.map(() => []);
  if (aEchantillonner.length) {
    const pris = [0, Math.floor(iDonnees.length / 2), iDonnees.length - 1]
      .filter((v, i, a) => v >= 0 && a.indexOf(v) === i);
    const cases: Cellule[] = [];
    const ref: number[] = [];
    for (const ci of aEchantillonner) for (const p of pris) { cases.push(cellule(iDonnees[p], ci)); ref.push(ci); }
    const lus = await lire(cases, 'texte', 'Reconnaissance des colonnes');
    lus.forEach((r, k) => echantillons[ref[k]].push(r.texte));
  }
  if (annule()) return echec('Lecture interrompue.');

  // — Rôles —
  const anneeParDefaut = opts.anneeParDefaut ?? anneeDominante(entetes);
  const candidates: ColonneCandidate[] = colonnes.map((_, ci) => ({
    index: ci, entete: entetes[ci], echantillon: echantillons[ci],
  }));
  const roles = affecterRoles(candidates, anneeParDefaut);

  const colDates = roles.filter(r => r.role === 'date');
  const colNoms = roles.filter(r => r.role === 'nom').map(r => r.index).sort((a, b) => a - b);
  const colUnite = roles.find(r => r.role === 'unite')?.index ?? -1;

  if (!colDates.length) {
    return echec(
      'Je n’ai reconnu aucune colonne de résultats dans cette capture. ' +
      'Essayez une capture plus nette, ou collez le tableau depuis Excel.',
    );
  }
  if (!colNoms.length) {
    return echec(
      'Je n’ai pas trouvé la colonne des noms d’analytes. ' +
      'Essayez une capture plus large, ou collez le tableau depuis Excel.',
    );
  }

  // — Noms d'analytes : les colonnes de libellés contiguës sont relues d'un
  //   seul tenant (« Anticorps anti-DNA » coupé en deux redevient entier). —
  const colNom: Colonne = {
    x0: colonnes[colNoms[0]].x0,
    x1: colonnes[colNoms[colNoms.length - 1]].x1,
  };
  avancer(0, 1, 'Lecture des analytes…');
  const limitesNom = {
    x0: plageEntete(colonnes, colNoms[0], carte.largeur).x0,
    x1: plageEntete(colonnes, colNoms[colNoms.length - 1], carte.largeur).x1,
  };
  const casNoms = iDonnees.map(bi => celluleDe(carte, polarite, bandes[bi], colNom, hL, limitesNom));
  const lusNoms = await lire(casNoms, 'texte', 'Analytes');
  if (annule()) return echec('Lecture interrompue.');

  // — Valeurs, colonne de résultats par colonne de résultats —
  const brutes: { texte: string; confiance: number }[][] = [];
  const geos: GeometrieCellule[][] = [];
  for (const d of colDates) {
    const col = colonnes[d.index];
    const limites = plageEntete(colonnes, d.index, carte.largeur);
    const cases = iDonnees.map(bi => celluleDe(carte, polarite, bandes[bi], col, hL, limites));
    brutes.push(await lire(cases, 'valeur', 'Valeurs'));
    geos.push(iDonnees.map(bi => analyserCellule(carte, bandes[bi], col)));
    if (annule()) return echec('Lecture interrompue.');
  }

  // — Encre typique d'une case pleine : sert à distinguer « case vide » de
  //   « case encrée mais non lue » (une valeur perdue, elle, doit être jaune). —
  const encres: number[] = [];
  for (const g of geos) for (const c of g) if (c.encre > 0) encres.push(c.encre);
  const encreTypique = encres.length ? mediane(encres) : 0;

  // — Dates de colonnes —
  const dates: DateLue[] = colDates.map(d => {
    const v = jugerDate(d.date as DateEntete | null, 100);
    return { iso: d.date?.iso ?? null, brut: d.date?.brut ?? '', douteux: v.douteux, motifs: v.motifs };
  });

  // — Assemblage des lignes —
  const lignes: LigneLue[] = [];
  const unitesALire: { ligne: number; bande: number }[] = [];

  for (let r = 0; r < iDonnees.length; r++) {
    const nom = nettoyerNom(lusNoms[r].texte);
    const valeurs = colDates.map((_, c) => {
      const g = geos[c][r];
      const brut = brutes[c][r];
      const rep = reparerNombre(brut.texte, g.separateur);
      return {
        texte: rep.texte, retabli: rep.separateurRetabli,
        sepGeo: !!g.separateur, conf: brut.confiance, encre: g.encre,
        glyphes: g.glyphes,
        // Une virgule rétablie compte comme lue : sans cela, la réparation
        // déclencherait elle-même l'alerte « un signe n'a pas été lu ».
        lus: (brut.texte.match(/[0-9.,<>]/g) ?? []).length + (rep.separateurRetabli ? 1 : 0),
      };
    });

    // Une ligne sans nom ET sans valeur n'est pas une ligne : filet, séparateur.
    if (!nom && valeurs.every(v => !v.texte)) continue;

    const cat = matchCatalog(nom);
    const cellules: CelluleLue[] = valeurs.map((v, c) => {
      const verdict = jugerValeur({
        texte: v.texte,
        confiance: v.conf,
        encre: v.encre,
        encreTypique,
        separateurGeometrique: v.sepGeo,
        separateurRetabli: v.retabli,
        desaccordRelecture: false,
        nomAnalyte: nom,
        autresDeLaLigne: valeurs.filter((_, k) => k !== c).map(o => o.texte),
        glyphes: v.glyphes,
        caracteresLus: v.lus,
      });
      return { texte: v.texte, douteux: verdict.douteux, motifs: verdict.motifs };
    });

    const vNom = jugerNom(nom, lusNoms[r].confiance);
    lignes.push({
      nom,
      unite: cat ? cat.unit : '',
      nomDouteux: vNom.douteux,
      nomMotifs: vNom.motifs,
      cellules,
      vignette: opts.vignettes
        ? vignette(source, {
            x0: colNom.x0, y0: bandes[iDonnees[r]].y0 - 2,
            x1: colonnes[colDates[colDates.length - 1].index].x1,
            y1: bandes[iDonnees[r]].y1 + 2,
          })
        : undefined,
    });
    if (!cat && colUnite >= 0) unitesALire.push({ ligne: lignes.length - 1, bande: iDonnees[r] });
  }

  // — Unité : le catalogue d'abord (c'est la demande du médecin) ; on ne va la
  //   chercher sur l'image que pour les analytes que l'application ne connaît
  //   pas, sinon on paierait dix reconnaissances pour rien. —
  if (unitesALire.length && colUnite >= 0) {
    const lus = await lire(
      unitesALire.map(u => celluleDe(carte, polarite, bandes[u.bande], colonnes[colUnite], hL,
        plageEntete(colonnes, colUnite, carte.largeur))),
      'texte', 'Unités',
    );
    unitesALire.forEach((u, k) => { lignes[u.ligne].unite = lus[k].texte.replace(/\s+/g, ''); });
  }

  // Un « tableau » d'une seule ligne n'est pas un bilan : c'est une découpe qui
  // a échoué. Mieux vaut le dire franchement que proposer une ligne inventée.
  if (lignes.length < 2) {
    return echec('Je n’ai su lire aucune ligne de résultats dans cette capture.');
  }

  // — Verdict global : mieux vaut un échec net que cinq valeurs fausses. —
  const cellulesTotal = lignes.length * dates.length;
  const remplies = lignes.reduce((s, l) => s + l.cellules.filter(c => c.texte).length, 0);
  if (cellulesTotal > 0 && remplies < cellulesTotal * 0.25) {
    return echec(
      `Je n’ai su lire que ${remplies} valeur(s) sur ${cellulesTotal}. ` +
      'Essayez une capture plus large ou plus nette, ou collez le tableau depuis Excel.',
    );
  }

  return { dates, lignes, echec: false, message: '' };
}

/** Année la plus fréquente parmi les en-têtes lisibles (contexte des « 12/03 »). */
export function anneeDominante(entetes: string[]): number | undefined {
  const compte = new Map<number, number>();
  for (const e of entetes) {
    const d = lireDate(e);
    if (d?.iso) {
      const a = +d.iso.slice(0, 4);
      compte.set(a, (compte.get(a) ?? 0) + 1);
    }
  }
  let meilleure: number | undefined, n = 0;
  for (const [a, c] of compte) if (c > n) { n = c; meilleure = a; }
  return meilleure;
}
