// ──────────────────────────────────────────────────────────────
// LE DOUTE DE LECTURE — et rien d'autre.
//
// Erreur de conception de la version précédente : l'écran d'import colorait
// l'ANORMALITÉ CLINIQUE (rouge « hors-norme », violet « incohérent »). Or on
// fait des courbes pour des patients malades : toutes leurs valeurs sont hors
// norme. Le code couleur signalait donc l'inverse de ce qu'il fallait — les
// bornes de normes lues comme des résultats restaient blanches, et une CRP
// correctement lue passait en rouge.
//
// Ici, une seule couleur, le jaune, et un seul sens :
//   « je ne suis pas sûr d'avoir bien LU cette case, vérifie-la ».
//
// Une valeur simplement pathologique n'est jamais jaune. À l'inverse, tout
// doute réel l'est : mieux vaut un jaune de trop qu'une valeur fausse acceptée
// en silence.
//
// Module PUR (aucun DOM) : entièrement testable hors navigateur.
// ──────────────────────────────────────────────────────────────

import { matchCatalog } from '../models/catalog';
import { decimalePerdue, ordreDeGrandeurSuspect, valeurDe } from './correction';
import type { DateLue } from './roles';
import { mediane } from './structure';

/**
 * En dessous de cette confiance Tesseract (bornes INCLUSES — une lecture
 * pile au seuil n'est pas plus sûre qu'une lecture juste en dessous), on
 * n'engage pas la lecture.
 */
export const SEUIL_CONFIANCE_VALEUR = 74;
export const SEUIL_CONFIANCE_NOM = 70;
export const SEUIL_CONFIANCE_DATE = 70;

/**
 * Écart de confiance, par rapport aux autres résultats de la MÊME ligne, en
 * dessous duquel une lecture par ailleurs « acceptable » (au-dessus du seuil
 * absolu) est quand même signalée.
 *
 * Une confusion de chiffres à risque (« 5 » lu « 9 », ou l'inverse — une
 * capture réelle du CHU l'a montré : confiance 72 quand les cinq autres
 * valeurs de la même ligne CPK étaient toutes à 95-96) ne donne pas
 * forcément une confiance BASSE dans l'absolu : Tesseract « hésite un peu »,
 * pas « refuse de lire ». C'est justement ce léger flottement, invisible à
 * un seuil absolu unique, qui trahit la case à vérifier — quand ses voisines
 * de ligne, elles, sont lues sans la moindre hésitation.
 */
const ECART_CONFIANCE_LIGNE = 15;
/** Confiance en dessous de laquelle l'écart relatif n'est plus pertinent : au-delà, une lecture est de toute façon excellente, l'écart ne trahit plus rien. */
const PLAFOND_CONFIANCE_RELATIVE = 90;

export interface Verdict {
  douteux: boolean;
  /** Raisons, en français, affichées en infobulle sur la case jaune. */
  motifs: string[];
}

const SUR: Verdict = { douteux: false, motifs: [] };

function verdict(motifs: string[]): Verdict {
  return motifs.length ? { douteux: true, motifs } : SUR;
}

/**
 * La valeur est-elle du même ordre de grandeur que le reste de sa ligne ?
 *
 * Un suivi biologique varie, parfois beaucoup, mais rarement d'un facteur
 * quatre d'un prélèvement à l'autre. C'est assez large pour laisser passer
 * toute la clinique, assez serré pour repérer une virgule mal replacée.
 */
function corrobore(texte: string, autresDeLaLigne: string[]): boolean {
  const v = valeurDe(texte);
  if (v === null || v === 0) return false;
  const vals = autresDeLaLigne
    .map(valeurDe)
    .filter((x): x is number => x !== null && x !== 0)
    .map(Math.abs)
    .sort((a, b) => a - b);
  if (vals.length < 2) return false;
  const med = vals[Math.floor(vals.length / 2)];
  if (med <= 0) return false;
  const r = Math.abs(v) / med;
  return r >= 0.25 && r <= 4;
}

export interface ContexteValeur {
  /** Texte finalement proposé au médecin. */
  texte: string;
  /** Confiance Tesseract 0..100 sur la case (0 si la case n'a pas été lue). */
  confiance: number;
  /** Pixels d'encre dans la case (analyse géométrique). */
  encre: number;
  /** Encre typique d'une case pleine sur cette capture (médiane). */
  encreTypique: number;
  /** La géométrie a vu un séparateur décimal. */
  separateurGeometrique: boolean;
  /** Le séparateur a dû être rétabli parce que Tesseract l'avait perdu. */
  separateurRetabli: boolean;
  /** Une relecture indépendante a donné un texte différent. */
  desaccordRelecture: boolean;
  /** Nom de l'analyte de la ligne (pour la plausibilité). */
  nomAnalyte: string;
  /** Textes des autres cases de résultat de la même ligne. */
  autresDeLaLigne: string[];
  /**
   * Confiances Tesseract des autres cases de résultat de la même ligne
   * (0 ou absentes = case vide, ignorées). Sert à repérer une case dont la
   * lecture, sans être franchement mauvaise, est nettement moins sûre que
   * ses voisines — le signe d'une confusion de chiffres (« 5 »/« 9 »…) que
   * le seuil absolu, à lui seul, ne voit pas.
   */
  confiancesAutresDeLaLigne?: number[];
  /** Signes comptés dans l'encre par l'analyse géométrique. */
  glyphes?: number;
  /** Signes effectivement rendus par la reconnaissance (texte brut). */
  caracteresLus?: number;
  /**
   * La colonne de cette case est anormalement large par rapport aux autres
   * colonnes de dates — signe qu'elle a probablement avalé deux dates
   * voisines faute de gouttière détectée entre elles (un bilan cumulé réel,
   * où chaque analyte n'a pas de résultat à chaque date, laisse des colonnes
   * de dates sans AUCUNE encre sur les quelques lignes lues, qui se
   * dissolvent alors dans la colonne voisine). Toute case de cette colonne
   * est signalée, MÊME quand elle a l'air parfaitement lisible : une lecture
   * nette de deux chiffres recollés est le plus trompeur des cas.
   */
  colonneAnormale?: boolean;
  /**
   * Un pictogramme (badge d'information, flèche de tendance) a dû être
   * découpé de cette case avant lecture — voir `structure.ts#sansDecorationsCouleur`.
   * Une case ainsi retouchée est structurellement plus fragile : Tesseract y
   * renvoie parfois un texte non vide à confiance NULLE (un résidu d'icône
   * mal découpé, lu comme un signe parasite) — un cas que le seuil de
   * confiance ordinaire ne voit pas, puisqu'il traite justement 0 comme
   * « case non lue » plutôt que « lecture ratée ». Ici, 0 redevient un
   * signal : la case porte du texte, mais Tesseract ne s'y fie pas du tout.
   */
  picto?: boolean;
}

/**
 * Juge une case de résultat. Les six motifs de doute :
 *  1. la case n'est pas vide mais rien n'a été lu ;
 *  2. Tesseract lui-même n'est pas sûr ;
 *  3. deux lectures indépendantes ne disent pas la même chose ;
 *  4. la virgule décimale a dû être rétablie (ou l'encre en montre une que le
 *     texte n'a pas) ;
 *  5. la valeur est décalée d'un facteur 10 par rapport au reste de sa ligne ;
 *  6. la valeur est hors de tout ordre de grandeur connu pour cet analyte.
 */
export function jugerValeur(ctx: ContexteValeur): Verdict {
  const motifs: string[] = [];
  const vide = !ctx.texte.trim();

  if (vide) {
    // Une case sans encre est simplement vide : le médecin n'a rien à vérifier.
    // Une case ENCRÉE mais non lue, en revanche, cache une valeur perdue.
    if (ctx.encre >= Math.max(6, ctx.encreTypique * 0.35)) {
      return verdict(['une valeur semble présente sur l’image mais n’a pas pu être lue']);
    }
    return ctx.colonneAnormale
      ? verdict(['colonne anormalement large — peut mélanger deux dates voisines'])
      : SUR;
  }

  if (ctx.colonneAnormale) motifs.push('colonne anormalement large — peut mélanger deux dates voisines');

  // Un pictogramme a été découpé de cette case ET Tesseract n'y a placé
  // AUCUNE confiance (0, alors que le texte n'est pas vide) : le seuil
  // ordinaire ci-dessous ignore ce cas précis (il traite 0 comme « non
  // lue », pas comme « lecture ratée ») — à tort ici, puisqu'une lecture a
  // bel et bien eu lieu. Un résidu d'icône mal découpé produit exactement
  // ce symptôme.
  if (ctx.picto && ctx.confiance <= 0) motifs.push('pictogramme repéré près du nombre — lecture à vérifier');

  if (ctx.confiance > 0 && ctx.confiance <= SEUIL_CONFIANCE_VALEUR) motifs.push('lecture peu sûre');
  else if (ctx.confiance > 0 && ctx.confiance < PLAFOND_CONFIANCE_RELATIVE) {
    // Un seuil ABSOLU unique ne voit pas la case qui « hésite un peu » quand
    // tout le reste de sa ligne est lu sans la moindre hésitation : c'est
    // justement la signature d'une confusion de chiffres à risque (5/9,
    // 3/8, 1/7…), pas d'une image globalement difficile — auquel cas TOUTE
    // la ligne aurait une confiance médiocre, et l'écart ne se verrait pas.
    const autres = (ctx.confiancesAutresDeLaLigne ?? []).filter(c => c > 0);
    if (autres.length >= 2) {
      const med = mediane(autres);
      if (med - ctx.confiance >= ECART_CONFIANCE_LIGNE) {
        motifs.push('lecture nettement moins sûre que le reste de la ligne');
      }
    }
  }
  if (ctx.desaccordRelecture) motifs.push('deux lectures ont donné des résultats différents');
  // Virgule rétablie d'après l'encre : on ne dérange le médecin que si le
  // résultat ne colle pas avec le reste de sa ligne. « 7,4 · 9,1 · 12,2 » se
  // corrobore tout seul — le signaler serait un jaune pour rien ; « 9,8 · 10,9
  // · 1,17 » ne se corrobore pas, et là il faut regarder.
  if (ctx.separateurRetabli && !corrobore(ctx.texte, ctx.autresDeLaLigne)) {
    motifs.push('virgule décimale rétablie d’après l’image');
  }
  // L'encre montre une virgule que le texte n'a pas, et la réparation n'a pas
  // pu la replacer : c'est le cas « 12,2 lu 122 », toujours signalé.
  // L'inverse (texte ponctué, encre muette) n'est PAS signalé : une virgule
  // collée à un chiffre échappe souvent à l'analyse de composantes, et le
  // signaler noierait le médecin sous des jaunes inutiles.
  else if (ctx.separateurGeometrique && !/[.,]/.test(ctx.texte)) motifs.push('virgule décimale incertaine');

  // L'encre porte plus de signes que la reconnaissance n'en a rendu : il manque
  // quelque chose. C'est ce qui attrape « > 300 » rendu « 300 » — une valeur
  // fausse et parfaitement crédible, donc la plus dangereuse de toutes.
  if (ctx.glyphes != null && ctx.caracteresLus != null && ctx.glyphes > ctx.caracteresLus) {
    motifs.push('un signe de l’image n’a pas été lu (peut-être « < » ou « > »)');
  }

  if (decimalePerdue(ctx.texte, ctx.autresDeLaLigne)) {
    motifs.push('valeur décalée d’un facteur 10 par rapport à la ligne');
  }
  if (ordreDeGrandeurSuspect(ctx.nomAnalyte, valeurDe(ctx.texte))) {
    motifs.push('valeur hors de tout ordre de grandeur connu pour cette variable');
  }
  return verdict(motifs);
}

/** Juge un nom d'analyte : lecture peu sûre, ou libellé que l'application ne reconnaît pas. */
export function jugerNom(nom: string, confiance: number): Verdict {
  const motifs: string[] = [];
  const t = (nom ?? '').trim();
  if (!t) return verdict(['nom de variable non lu']);
  if (confiance > 0 && confiance < SEUIL_CONFIANCE_NOM) motifs.push('nom peu sûr à la lecture');
  if (!matchCatalog(t)) motifs.push('nom de variable non reconnu — vérifiez l’orthographe');
  return verdict(motifs);
}

/** Juge une date de colonne : illisible, incomplète, ou lue avec peu de certitude. */
export function jugerDate(date: DateLue | null, confiance: number): Verdict {
  if (!date || !date.iso) return verdict(['date non reconnue — renseignez-la']);
  const motifs: string[] = [];
  if (date.anneeDevinee) motifs.push('année absente de l’image — à confirmer');
  if (confiance > 0 && confiance < SEUIL_CONFIANCE_DATE) motifs.push('date peu sûre à la lecture');
  return verdict(motifs);
}
