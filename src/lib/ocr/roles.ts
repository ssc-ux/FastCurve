// ──────────────────────────────────────────────────────────────
// RÔLE DES COLONNES — le cœur de la refonte.
//
// La faute capitale de l'ancienne chaîne était de traiter toute colonne
// numérique comme une colonne de résultats. Elle lisait donc « 104 » (borne
// haute de la colonne « Normes 59 - 104 ») comme la créatinine du patient, et
// « 400 » (borne de « 150 - 400 ») comme ses plaquettes.
//
// Ici on décide d'ABORD à quoi sert chaque colonne — nom d'analyte, unité,
// normes, date — et on ne lit comme résultat que ce qui est sous une colonne
// de date. Une colonne « Normes » ne peut plus produire aucune valeur.
//
// Module PUR (aucun DOM) : entièrement testable hors navigateur.
// ──────────────────────────────────────────────────────────────

import { parseDate } from '../models/types';

export type RoleColonne = 'nom' | 'unite' | 'normes' | 'date' | 'ignoree';

// ── Reconnaissance de motifs ────────────────────────────────────

/** Normalisation sans accents ni ponctuation, pour comparer des en-têtes. */
export function normaliser(s: string): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Un intervalle de référence : « 59 - 104 », « 2,0 - 4,0 », « < 5 », « > 75 »,
 * « 13 à 17 », « [150-400] ». C'est le motif qui trahit la colonne des normes,
 * et le reconnaître élimine d'un coup les deux plus grosses erreurs relevées.
 */
export function estIntervalle(texte: string): boolean {
  const t = (texte ?? '').replace(/\s+/g, '').replace(/[\[\]()]/g, '');
  if (!t) return false;
  const nb = '\\d+(?:[.,]\\d+)?';
  if (new RegExp(`^${nb}[-–—]${nb}$`).test(t)) return true;
  if (new RegExp(`^${nb}a${nb}$`, 'i').test(texte.replace(/\s+/g, '').replace(/à/gi, 'a'))) return true;
  if (new RegExp(`^[<>≤≥]=?${nb}$`).test(t)) return true;
  return false;
}

/** Unités biologiques usuelles, y compris les formes que l'OCR agglutine (« umolL »). */
const UNITE_RE = new RegExp(
  '^(' +
  'g\\/?d?l|mg\\/?l|mg\\/?dl|[µu]g\\/?l|[µu]g\\/?ml|mmol\\/?l|[µu]mol\\/?l|nmol\\/?l|pmol\\/?l|mol\\/?l|' +
  'ng\\/?m?l|pg\\/?m?l|k?ui?\\/?m?l|mui\\/?l|u\\/?l|g\\/?l|t\\/?l|10\\d?\\/?l|' +
  'mm\\/?h|mmhg|ml\\/?min|mmol\\/?min\\/?kpa|l\\/?min|' +
  '%|fl|pg|mm|l|s|ratio|sans' +
  ')$', 'i');

/** Le texte est-il (seulement) une unité ? */
export function estUnite(texte: string): boolean {
  const t = (texte ?? '').trim().replace(/\s+/g, '');
  if (!t) return false;
  return UNITE_RE.test(t.normalize('NFD').replace(/[̀-ͯ]/g, ''));
}

/** Le texte contient-il un nombre exploitable (et pas une date) ? */
export function estNombre(texte: string): boolean {
  const t = (texte ?? '').replace(/\s+/g, '');
  if (!t) return false;
  if (/\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}/.test(t)) return false;
  return /^[<>≤≥]?-?\d+(?:[.,]\d+)?$/.test(t);
}

/** Le texte est-il essentiellement alphabétique (un libellé d'analyte) ? */
export function estLibelle(texte: string): boolean {
  const t = (texte ?? '').trim();
  if (t.length < 2) return false;
  const lettres = (t.match(/[A-Za-zÀ-ÿ]/g) ?? []).length;
  return lettres >= 2 && lettres >= t.replace(/\s/g, '').length * 0.4;
}

// ── Dates ───────────────────────────────────────────────────────

export interface DateLue {
  iso: string | null;
  brut: string;
  /** Vrai quand l'année a dû être devinée (date sans année dans l'en-tête). */
  anneeDevinee: boolean;
}

/**
 * Extrait une date d'un en-tête de colonne. Tolère les séparateurs mal lus et
 * les formes courtes fréquentes dans les logiciels de laboratoire :
 * « 12/03/2025 », « 12/03/25 », « 12-03-2025 », « 12/03 » (année absente).
 */
export function lireDate(texte: string, anneeParDefaut?: number): DateLue | null {
  const t = (texte ?? '')
    .replace(/[OoQ]/g, '0')
    .replace(/[lI|]/g, '1')
    .replace(/\s+/g, '');
  if (!t) return null;

  const complet = t.match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
  if (complet) {
    const brut = `${complet[1]}/${complet[2]}/${complet[3]}`;
    return { iso: parseDate(brut), brut, anneeDevinee: false };
  }
  // Forme ISO recopiée telle quelle
  const iso = t.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return { iso: parseDate(iso[0]), brut: iso[0], anneeDevinee: false };

  // « 12/03 » : jour/mois sans année. On ne devine que si l'appelant fournit
  // une année de contexte, et on signale la déduction (case en jaune).
  const court = t.match(/^(\d{1,2})[\/.\-](\d{1,2})$/);
  if (court) {
    const j = +court[1], m = +court[2];
    if (j >= 1 && j <= 31 && m >= 1 && m <= 12) {
      const brut = `${court[1]}/${court[2]}`;
      if (anneeParDefaut) {
        return { iso: parseDate(`${brut}/${anneeParDefaut}`), brut, anneeDevinee: true };
      }
      return { iso: null, brut, anneeDevinee: true };
    }
  }
  return null;
}

/** L'en-tête ressemble-t-il à une date (même si elle n'est pas lisible) ? */
export function ressembleDate(texte: string): boolean {
  return !!lireDate(texte);
}

// ── En-têtes nommés ─────────────────────────────────────────────

const ENTETE_NOM = ['analyte', 'analytes', 'parametre', 'parametres', 'libelle', 'libelles', 'analyse', 'analyses', 'examen', 'examens', 'designation', 'intitule', 'dosage', 'test', 'tests', 'nom'];
const ENTETE_UNITE = ['unite', 'unites', 'u', 'un'];
const ENTETE_NORMES = [
  'normes', 'norme', 'normales', 'normale', 'valeurs usuelles', 'valeur usuelle', 'usuelles', 'usuel',
  'valeurs de reference', 'valeur de reference', 'valeurs references', 'reference', 'references', 'ref',
  'intervalle', 'intervalle de reference', 'vn', 'vr', 'normal',
];

/** Rôle déduit du seul libellé d'en-tête (null si l'en-tête ne dit rien). */
export function roleDepuisEntete(entete: string): RoleColonne | null {
  const n = normaliser(entete);
  if (!n) return null;
  if (ressembleDate(entete)) return 'date';
  if (ENTETE_NORMES.some(e => n === e || n.startsWith(e + ' ') || n.includes(e))) return 'normes';
  if (ENTETE_UNITE.includes(n)) return 'unite';
  if (ENTETE_NOM.some(e => n === e || n.startsWith(e))) return 'nom';
  return null;
}

// ── Rôle déduit du contenu ──────────────────────────────────────

export interface StatsColonne {
  /** Textes des cellules de données de la colonne (chaînes vides comprises). */
  cellules: string[];
}

/**
 * Rôle déduit du CONTENU quand l'en-tête ne tranche pas. C'est le filet de
 * sécurité qui attrape une colonne de normes sans titre (fréquent : le titre
 * est sur deux lignes, ou coupé par le recadrage).
 */
export function roleDepuisContenu(cellules: string[]): RoleColonne | null {
  const pleines = cellules.map(c => (c ?? '').trim()).filter(c => c !== '');
  if (pleines.length < 2) return null;
  const part = (f: (t: string) => boolean) => pleines.filter(f).length / pleines.length;

  if (part(estIntervalle) >= 0.5) return 'normes';
  if (part(estUnite) >= 0.5) return 'unite';
  if (part(estLibelle) >= 0.6 && part(estNombre) < 0.2) return 'nom';
  return null;
}

export interface ColonneCandidate {
  /** Index de la colonne dans la découpe géométrique. */
  index: number;
  /** Texte lu dans la bande d'en-tête. */
  entete: string;
  /** Textes lus dans quelques bandes de données (échantillon). */
  echantillon: string[];
}

export interface AffectationColonne {
  index: number;
  role: RoleColonne;
  entete: string;
  date: DateLue | null;
}

/**
 * Affecte un rôle à chaque colonne détectée.
 *
 * Ordre de décision, du plus sûr au moins sûr :
 *  1. l'en-tête est une date        → colonne de résultats ;
 *  2. l'en-tête nomme la colonne    → nom / unité / normes ;
 *  3. le contenu trahit la colonne  → normes (intervalles) / unité / nom ;
 *  4. par défaut : la colonne la plus à gauche encore libre devient le nom ;
 *     une colonne numérique restante devient une colonne de résultats à date
 *     manquante ; tout le reste est ignoré.
 */
export function affecterRoles(colonnes: ColonneCandidate[], anneeParDefaut?: number): AffectationColonne[] {
  const out: AffectationColonne[] = colonnes.map(c => ({ index: c.index, role: 'ignoree' as RoleColonne, entete: c.entete, date: null }));

  // 1 & 2 : d'après l'en-tête.
  colonnes.forEach((c, i) => {
    const d = lireDate(c.entete, anneeParDefaut);
    if (d) { out[i].role = 'date'; out[i].date = d; return; }
    const r = roleDepuisEntete(c.entete);
    if (r) out[i].role = r;
  });

  // 3 : d'après le contenu, pour ce qui reste indécis.
  colonnes.forEach((c, i) => {
    if (out[i].role !== 'ignoree') return;
    const r = roleDepuisContenu(c.echantillon);
    if (r) out[i].role = r;
  });

  // 4a : la colonne de noms — la plus à gauche encore indécise et alphabétique.
  if (!out.some(o => o.role === 'nom')) {
    const i = colonnes.findIndex((c, k) => out[k].role === 'ignoree' && c.echantillon.some(estLibelle));
    if (i >= 0) out[i].role = 'nom';
    else if (out.length && out[0].role === 'ignoree') out[0].role = 'nom';
  }

  // 4b : une colonne numérique restante est une colonne de résultats dont la
  // date n'a pas été lue. On la garde (le médecin veut ses valeurs) mais sa
  // date sera signalée en jaune — jamais devinée.
  colonnes.forEach((c, i) => {
    if (out[i].role !== 'ignoree') return;
    const pleines = c.echantillon.filter(t => t && t.trim() !== '');
    if (pleines.length >= 2 && pleines.filter(estNombre).length / pleines.length >= 0.6) {
      out[i].role = 'date';
      out[i].date = null;
    }
  });

  return out;
}

// ── Nettoyage d'un nom d'analyte ────────────────────────────────

/**
 * Retire l'unité agglutinée au nom (« Créatinine umolL » → « Créatinine »),
 * la ponctuation de fin et les intervalles qui auraient débordé.
 */
export function nettoyerNom(brut: string): string {
  let t = (brut ?? '').replace(/\s+/g, ' ').trim();
  t = t.replace(/[:;.,]+$/, '').trim();
  // Unité entre parenthèses en fin de nom
  t = t.replace(/\s*\(([^)]{1,14})\)\s*$/, (m, u) => (estUnite(u) ? '' : m)).trim();
  // Unité collée en fin de nom, éventuellement sur plusieurs jetons
  for (let i = 0; i < 2; i++) {
    const mots = t.split(' ');
    if (mots.length < 2) break;
    const dernier = mots[mots.length - 1];
    if (estUnite(dernier) || estIntervalle(dernier)) { mots.pop(); t = mots.join(' ').trim(); }
    else break;
  }
  t = t.replace(/[\s\-–—]+$/, '').trim();
  return t;
}
