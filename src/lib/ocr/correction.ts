// ──────────────────────────────────────────────────────────────
// POST-CORRECTION ET PLAUSIBILITÉ.
//
// La liste blanche de caractères (une case de résultat ne contient que des
// chiffres, une virgule, un point, « < » ou « > ») empêche déjà la plupart des
// valeurs ubuesques. Restent trois choses à réparer ou à signaler :
//
//  · la VIRGULE DÉCIMALE perdue — « 12,2 » lu « 122 », faux d'un facteur 10.
//    On la rétablit quand la géométrie de l'encre la voit là où le texte ne
//    l'a pas mise ;
//  · les séparateurs de milliers (« 1 240 ») à retirer ;
//  · la PLAUSIBILITÉ : une valeur d'un ordre de grandeur hors de tout ce que
//    le catalogue connaît pour cet analyte, ou décalée d'un facteur 10 par
//    rapport au reste de sa ligne, n'est pas une valeur — c'est une lecture
//    ratée. On ne la corrige jamais en silence : on la signale.
//
// Module PUR (aucun DOM) : entièrement testable hors navigateur.
// ──────────────────────────────────────────────────────────────

import { matchCatalog } from '../models/catalog';

/** Résultat d'une réparation de nombre. */
export interface NombreRepare {
  /** Texte proposé au médecin ('' si rien d'exploitable). */
  texte: string;
  /** Valeur numérique correspondante (null si aucune). */
  valeur: number | null;
  /** Une virgule décimale a été rétablie d'après la géométrie de l'encre. */
  separateurRetabli: boolean;
}

const VIDE: NombreRepare = { texte: '', valeur: null, separateurRetabli: false };

/**
 * Nettoie le texte brut d'une case de résultat.
 *
 * `separateur` vient de l'analyse géométrique de l'encre : quand elle a vu un
 * point ou une virgule que Tesseract n'a pas rendu, on le rétablit à la bonne
 * position (nombre de chiffres à sa gauche).
 */
export function reparerNombre(brut: string, separateur?: { chiffresAvant: number } | null): NombreRepare {
  let t = (brut ?? '').trim();
  if (!t) return VIDE;

  // Symboles de comparaison en tête (« < 5 », « > 300 »).
  let prefixe = '';
  const mp = t.match(/^\s*([<>≤≥])\s*/);
  if (mp) { prefixe = mp[1] === '≤' ? '<' : mp[1] === '≥' ? '>' : mp[1]; t = t.slice(mp[0].length); }

  // Espace de milliers : « 1 240 » → « 1240 ».
  t = t.replace(/(\d)[   ](?=\d{3}\b)/g, '$1');
  t = t.replace(/\s+/g, '');
  t = t.replace(/,/g, '.');
  t = t.replace(/[^0-9.]/g, '');
  if (!/\d/.test(t)) return VIDE;

  // Plusieurs séparateurs : soit des milliers (« 1.234.567 »), soit du bruit.
  const parts = t.split('.');
  if (parts.length > 2) {
    const milliers = parts.slice(1).every(p => p.length === 3);
    t = milliers ? parts.join('') : parts[0] + '.' + parts.slice(1).join('');
  }
  t = t.replace(/^\./, '0.').replace(/\.$/, '');
  if (!/\d/.test(t)) return VIDE;

  let separateurRetabli = false;
  if (separateur && !t.includes('.')) {
    const n = separateur.chiffresAvant;
    if (n > 0 && n < t.length) {
      t = t.slice(0, n) + '.' + t.slice(n);
      separateurRetabli = true;
    }
  }

  const valeur = parseFloat(t);
  if (isNaN(valeur)) return VIDE;
  // On garde les décimales telles qu'elles sont écrites sur l'image : « 4,0 »
  // reste « 4.0 ». Le réduire à « 4 » ferait disparaître une virgule que l'encre
  // montre, et la case passerait en jaune pour rien.
  const texte = prefixe + t.replace(/^0+(?=\d)/, '');
  return { texte, valeur, separateurRetabli };
}

/** Valeur numérique d'une cellule déjà nettoyée ('' → null). */
export function valeurDe(texte: string): number | null {
  const t = (texte ?? '').trim().replace(',', '.').replace(/^[<>]/, '');
  if (!t) return null;
  const n = parseFloat(t);
  return isNaN(n) ? null : n;
}

/** La cellule porte-t-elle un séparateur décimal ? */
export function aSeparateur(texte: string): boolean {
  return /[.,]/.test(texte ?? '');
}

/** Facteur au-delà duquel une valeur n'est plus une valeur, mais une erreur de lecture. */
const FACTEUR_INVRAISEMBLABLE = 25;

/**
 * Valeur invraisemblable pour cet analyte — d'un ORDRE DE GRANDEUR hors de ce
 * que le catalogue connaît.
 *
 * Attention : ce test ne dit rien de la santé du patient. Une CRP à 96 mg/L
 * (norme < 5) ou une créatinine à 300 µmol/L (norme 60-110) sont des valeurs
 * parfaitement lisibles ; c'est le patient qui est malade, pas l'OCR. Le
 * facteur 25 est choisi pour laisser passer toute la pathologie courante et
 * n'attraper que les lectures aberrantes.
 */
export function ordreDeGrandeurSuspect(nomAnalyte: string, valeur: number | null): boolean {
  if (valeur === null || !isFinite(valeur)) return false;
  const e = matchCatalog(nomAnalyte);
  if (!e) return false;
  const v = Math.abs(valeur);
  if (v === 0) return false;
  if (e.refHigh != null && e.refHigh > 0 && v > e.refHigh * FACTEUR_INVRAISEMBLABLE) return true;
  if (e.refLow != null && e.refLow > 0 && v < e.refLow / FACTEUR_INVRAISEMBLABLE) return true;
  return false;
}

/**
 * Décimale perdue : la cellule n'a pas de séparateur alors que ses voisines de
 * la même ligne en ont un, et la diviser par dix la remettrait dans l'ordre de
 * grandeur de la ligne. C'est exactement le cas « Leucocytes 7,4 / 9,1 / 122 ».
 *
 * On exige que les autres valeurs de la ligne portent un séparateur : sans
 * cela, une CRP qui passe de 96 à 7 (une vraie évolution clinique) serait
 * signalée à tort, et le médecin est formel — une valeur simplement
 * pathologique ne doit jamais être surlignée.
 */
export function decimalePerdue(texte: string, autresDeLaLigne: string[]): boolean {
  if (aSeparateur(texte)) return false;
  const v = valeurDe(texte);
  if (v === null || v === 0) return false;

  const autres = autresDeLaLigne
    .map(t => ({ t, v: valeurDe(t) }))
    .filter((o): o is { t: string; v: number } => o.v !== null && o.v !== 0);
  if (autres.length < 2) return false;
  if (!autres.every(o => aSeparateur(o.t))) return false;

  const vals = autres.map(o => Math.abs(o.v)).sort((a, b) => a - b);
  const med = vals[Math.floor(vals.length / 2)];
  if (med <= 0) return false;

  const ecart = Math.abs(v) / med;
  if (ecart < 6) return false;                 // pas décalé : rien à dire
  const apres = Math.abs(v) / 10 / med;
  return apres >= 1 / 3 && apres <= 3;         // ÷10 le remet dans la ligne
}
