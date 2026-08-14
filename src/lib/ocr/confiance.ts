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

/** En dessous de cette confiance Tesseract, on n'engage pas la lecture. */
export const SEUIL_CONFIANCE_VALEUR = 72;
export const SEUIL_CONFIANCE_NOM = 70;
export const SEUIL_CONFIANCE_DATE = 70;

export interface Verdict {
  douteux: boolean;
  /** Raisons, en français, affichées en infobulle sur la case jaune. */
  motifs: string[];
}

const SUR: Verdict = { douteux: false, motifs: [] };

function verdict(motifs: string[]): Verdict {
  return motifs.length ? { douteux: true, motifs } : SUR;
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
    return SUR;
  }

  if (ctx.confiance > 0 && ctx.confiance < SEUIL_CONFIANCE_VALEUR) motifs.push('lecture peu sûre');
  if (ctx.desaccordRelecture) motifs.push('deux lectures ont donné des résultats différents');
  if (ctx.separateurRetabli) motifs.push('virgule décimale rétablie d’après l’image');
  else if (ctx.separateurGeometrique !== /[.,]/.test(ctx.texte)) motifs.push('virgule décimale incertaine');

  if (decimalePerdue(ctx.texte, ctx.autresDeLaLigne)) {
    motifs.push('valeur décalée d’un facteur 10 par rapport à la ligne');
  }
  if (ordreDeGrandeurSuspect(ctx.nomAnalyte, valeurDe(ctx.texte))) {
    motifs.push('valeur hors de tout ordre de grandeur connu pour cet analyte');
  }
  return verdict(motifs);
}

/** Juge un nom d'analyte : lecture peu sûre, ou libellé que l'application ne reconnaît pas. */
export function jugerNom(nom: string, confiance: number): Verdict {
  const motifs: string[] = [];
  const t = (nom ?? '').trim();
  if (!t) return verdict(['nom d’analyte non lu']);
  if (confiance > 0 && confiance < SEUIL_CONFIANCE_NOM) motifs.push('nom peu sûr à la lecture');
  if (!matchCatalog(t)) motifs.push('nom d’analyte non reconnu — vérifiez l’orthographe');
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
