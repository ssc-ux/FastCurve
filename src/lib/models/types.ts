// ──────────────────────────────────────────────────────────────
// Types du domaine FastCurve
// ──────────────────────────────────────────────────────────────

export type ParamCategory = 'biologie' | 'efr' | 'immunologie' | 'libre';

/** Mode d'affichage pour les EFR (et paramètres avec théorique). */
export type EfrDisplay = 'absolute' | 'percent';

export interface Parameter {
  id: string;
  name: string;
  unit: string;
  category: ParamCategory;
  /** Bornes de normale usuelle (optionnelles), en valeur absolue. */
  refLow?: number | null;
  refHigh?: number | null;
  /** Pour EFR : affichage en valeur absolue ou en % de la théorique. */
  display?: EfrDisplay;
  /** Couleur explicite (sinon assignée automatiquement). */
  color?: string | null;
  /** Ordre d'affichage. */
  order: number;
}

export interface Measurement {
  id: string;
  parameterId: string;
  /** Date ISO 'YYYY-MM-DD'. */
  date: string;
  /** Valeur mesurée (valeur absolue). */
  value: number;
  /** Seuil de détection : '<' (inférieur à) ou '>' (supérieur à). */
  qualifier?: '<' | '>' | null;
}

export type TreatmentKind = 'continuous' | 'event';

/** Un palier de dose daté (pour représenter une décroissance). */
export interface DosePoint {
  date: string; // ISO
  dose: number; // valeur numérique (ex. mg/j)
}

export interface Treatment {
  id: string;
  name: string;
  dose?: string;
  kind: TreatmentKind;
  /** Date ISO début (ou date de l'événement). */
  start: string;
  /** Date ISO fin (traitement continu). Si absent = jusqu'à aujourd'hui / dernière donnée. */
  end?: string | null;
  /**
   * Paliers de dose pour une décroissance (optionnel). Si présents (≥1),
   * la barre est dessinée en « coin » dont la hauteur suit la dose dans le temps.
   * Sinon, barre pleine de dose constante.
   */
  dosePoints?: DosePoint[];
  /** Unité de dose affichée avec les paliers (ex. 'mg', 'mg/j'). */
  doseUnit?: string;
  color?: string | null;
  order: number;
}

export type ChartMode = 'stacked' | 'single';

export interface Settings {
  chartMode: ChartMode;
  title: string;
  subtitle: string;
  /** Afficher les bandes de normale sur les panneaux. */
  showReference: boolean;
  /** Afficher la légende. */
  showLegend: boolean;
  /** Afficher les valeurs (labels) sur les points. */
  showValues: boolean;
  /** Axe X : dates réelles (échelle temps) ou catégories régulières. */
  timeAxis: boolean;
  /** Entourer les points hors des normes usuelles. */
  markOutOfRange: boolean;
  /** Fenêtre temporelle affichée (ISO) — null = pas de borne. */
  fromDate?: string | null;
  toDate?: string | null;
}

/** Note libre ancrée à une date, dessinée sur le graphe (flèche + texte). */
export interface Annotation {
  id: string;
  date: string;
  text: string;
  order: number;
}

export interface StudyState {
  version: number;
  patientLabel: string;
  parameters: Parameter[];
  measurements: Measurement[];
  treatments: Treatment[];
  annotations: Annotation[];
  settings: Settings;
  /** Colonnes de dates ajoutées mais encore sans valeur (persistées entre onglets). */
  extraDates: string[];
}

/** Modèle de suivi réutilisable : un jeu de paramètres nommé. */
export interface Template {
  id: string;
  name: string;
  parameters: Omit<Parameter, 'id' | 'order' | 'color'>[];
}



// ──────────────────────────────────────────────────────────────
// Palette catégorielle validée CVD-safe (voir skill dataviz)
// Ordre = mécanisme de sécurité daltonisme, ne pas réordonner.
// ──────────────────────────────────────────────────────────────

export const SERIES_COLORS = [
  '#2a78d6', // bleu
  '#e34948', // rouge
  '#008300', // vert
  '#eb6834', // orange
  '#4a3aa7', // violet
  '#1baf7a', // aqua
  '#eda100', // jaune
  '#e87ba4', // magenta
];

// Teintes de traitements : distinctes entre elles et plus sourdes que les
// courbes biologiques (pour ne pas rivaliser avec les séries de données).
export const TREATMENT_COLORS = [
  '#5b6472', // ardoise
  '#8a6d3b', // ocre / brun
  '#3d7a70', // sarcelle
  '#7a4f6d', // prune
  '#6b7a3d', // olive
  '#4a5a8a', // indigo doux
  '#8a5a4a', // terracotta
];

// ──────────────────────────────────────────────────────────────
// Utilitaires date
// ──────────────────────────────────────────────────────────────

/**
 * Parse une date en divers formats (DD/MM/YYYY, DD-MM-YYYY, DD/MM/YY,
 * YYYY-MM-DD) et retourne une chaîne ISO 'YYYY-MM-DD', ou null.
 */
export function parseDate(input: string): string | null {
  if (!input) return null;
  const s = input.trim();

  // Déjà ISO
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const [, y, m, d] = iso;
    if (validYMD(+y, +m, +d)) return `${y}-${m}-${d}`;
    return null;
  }

  // DD/MM/YYYY ou DD-MM-YYYY ou DD.MM.YYYY (année 2 ou 4 chiffres)
  const m1 = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m1) {
    let [, d, mo, y] = m1;
    let year = +y;
    if (y.length === 2) year = year >= 70 ? 1900 + year : 2000 + year;
    const dd = +d, mm = +mo;
    if (!validYMD(year, mm, dd)) return null;
    return `${year}-${pad(mm)}-${pad(dd)}`;
  }

  // DD/MM (année courante implicite) — le parseur d'import gère ce cas séparément
  return null;
}

/** Précision réellement fournie par la saisie : jour complet, mois seul, année seule. */
export type PrecisionDate = 'jour' | 'mois' | 'annee';

export interface DateLue {
  /** Date ISO 'YYYY-MM-DD' (1er du mois / 1er janvier quand la saisie est partielle). */
  iso: string;
  precision: PrecisionDate;
}

// Mois en toutes lettres — le médecin dicte souvent « mars 2024 ».
const MOIS_FR = [
  'janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre',
];

/** Enlève accents, ponctuation et casse : « Févr. » et « fevrier » se rejoignent. */
function sansAccent(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/**
 * Numéro de mois d'un libellé écrit en lettres (1-12), ou null.
 * Un préfixe ambigu (« jui » = juin ou juillet) est refusé : mieux vaut ne rien
 * comprendre que ranger des valeurs un mois trop loin.
 */
function moisEnLettres(mot: string): number | null {
  const m = sansAccent(mot).replace(/\.$/, '');
  if (m.length < 3) return null;
  const exact = MOIS_FR.indexOf(m);
  if (exact >= 0) return exact + 1;
  const prefixes = MOIS_FR.map((n, i) => ({ n, i })).filter(x => x.n.startsWith(m));
  return prefixes.length === 1 ? prefixes[0].i + 1 : null;
}

/** Année sur 2 chiffres → siècle (pivot 70, comme partout dans l'application). */
function annee2(n: number): number {
  return n >= 70 ? 1900 + n : 2000 + n;
}

/**
 * Lecture « tolérante » d'une date tapée à la main dans la grille.
 *
 * Le cahier des charges du médecin (« Bonus indispensable : taper une date à ma
 * manière ») fixe la liste : `12/03/2024`, `12/03/24`, `12032024`, `03/2024`,
 * `mars 2024`, `2024`. On l'élargit à ce qui est lisible sans ambiguïté :
 *  - tous les formats de `parseDate` (ISO, JJ/MM/AAAA, JJ-MM-AA…) ;
 *  - JJ/MM sans année → année de référence (aujourd'hui par défaut) ;
 *  - JJ mois AAAA / mois AAAA / mois (« 12 mars 2024 », « mars 2024 », « mars ») ;
 *  - MM/AAAA → 1er du mois ;
 *  - AAAA seule → 1er janvier ;
 *  - 8 chiffres collés : JJMMAAAA, sinon AAAAMMJJ ;
 *  - 6 chiffres collés : JJMMAA ;
 *  - 4 chiffres collés : une année plausible (1900-2100), sinon JJMM.
 *
 * Retourne la date ISO et sa précision, ou null si la saisie n'est pas
 * interprétable — dans ce cas l'appelant DOIT conserver l'ancienne date :
 * deviner à la place du médecin déplacerait des valeurs cliniques sur une date
 * qu'il n'a pas choisie. C'est ce garde-fou qui interdit les dates de l'an 1
 * fabriquées à mi-frappe.
 */
export function lireDateSouple(input: string, reference?: string): DateLue | null {
  if (!input) return null;
  const s = input.trim();
  if (!s) return null;

  const direct = parseDate(s);
  if (direct) return { iso: direct, precision: 'jour' };

  const anneeRef = +(reference ?? todayISO()).slice(0, 4);
  const jour = (y: number, m: number, d: number): DateLue | null =>
    validYMD(y, m, d) ? { iso: `${y}-${pad(m)}-${pad(d)}`, precision: 'jour' } : null;

  // ── Formes écrites en lettres : « 12 mars 2024 », « mars 2024 », « mars » ──
  const lettres = s.match(/^(?:(\d{1,2})\s+)?([A-Za-zÀ-ÿ.]{3,10})\.?(?:\s+(\d{2,4}))?$/);
  if (lettres) {
    const mo = moisEnLettres(lettres[2]);
    if (mo) {
      const an = lettres[3] ? (lettres[3].length <= 2 ? annee2(+lettres[3]) : +lettres[3]) : anneeRef;
      if (lettres[1]) return jour(an, mo, +lettres[1]);
      return validYMD(an, mo, 1) ? { iso: `${an}-${pad(mo)}-01`, precision: 'mois' } : null;
    }
    return null;
  }

  // ── JJ/MM sans année, sinon MM/AAAA ──
  const deux = s.match(/^(\d{1,2})[\/\-.](\d{1,4})$/);
  if (deux) {
    const a = +deux[1], b = +deux[2];
    // « 12/03 » est un jour ; « 03/2024 » est un mois. La longueur tranche.
    if (deux[2].length <= 2) {
      const j = jour(anneeRef, b, a);
      if (j) return j;
      // « 3/24 » : pas un jour valide → mois 3 de 2024
      const an = annee2(b);
      return validYMD(an, a, 1) ? { iso: `${an}-${pad(a)}-01`, precision: 'mois' } : null;
    }
    return validYMD(b, a, 1) ? { iso: `${b}-${pad(a)}-01`, precision: 'mois' } : null;
  }

  // ── Suites de chiffres collées (frappe rapide au pavé numérique) ──
  const chiffres = s.match(/^(\d{4,8})$/);
  if (!chiffres) return null;
  const n = chiffres[1];

  if (n.length === 8) {
    // JJMMAAAA d'abord (c'est ce qu'on tape en français), AAAAMMJJ en repli.
    return jour(+n.slice(4, 8), +n.slice(2, 4), +n.slice(0, 2))
        ?? jour(+n.slice(0, 4), +n.slice(4, 6), +n.slice(6, 8));
  }
  if (n.length === 6) {
    // JJMMAA d'abord, AAAAMM (« 202403 ») en repli.
    return jour(annee2(+n.slice(4, 6)), +n.slice(2, 4), +n.slice(0, 2))
        ?? (validYMD(+n.slice(0, 4), +n.slice(4, 6), 1)
              ? { iso: `${n.slice(0, 4)}-${n.slice(4, 6)}-01`, precision: 'mois' as const }
              : null);
  }
  if (n.length === 4) {
    // Une année plausible prime sur JJMM : le médecin qui tape « 2024 » veut
    // l'année 2024, pas le 20 du mois 24 (qui n'existe pas de toute façon).
    const an = +n;
    if (an >= 1900 && an <= 2100) return { iso: `${an}-01-01`, precision: 'annee' };
    return jour(anneeRef, +n.slice(2, 4), +n.slice(0, 2));
  }
  return null;
}

/** Même lecture, réduite à l'ISO (ou null). */
export function parseDateSouple(input: string, reference?: string): string | null {
  return lireDateSouple(input, reference)?.iso ?? null;
}

/**
 * Une date calendaire qui n'existe pas (31 février, 30 février, 31 avril…)
 * doit être refusée ici, pas plus loin : sinon elle produit un ISO qui a l'air
 * valide (`2024-02-31`) mais qui, converti en jour réel pour positionner le
 * point sur l'axe du temps, déborde silencieusement sur le mois suivant — le
 * libellé affiché et la position du point divergent, et la courbe fait un
 * zigzag qui n'existe pas dans les données.
 */
function validYMD(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12) return false;
  if (y < 1900 || y > 2100) return false;
  const bissextile = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const joursDuMois = [31, bissextile ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return d >= 1 && d <= joursDuMois[m - 1];
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** ISO 'YYYY-MM-DD' → 'DD/MM/YYYY' pour l'affichage. */
export function formatDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** ISO 'YYYY-MM-DD' → 'JJ mmm' court (ex '12 juil'). */
export function formatDateShort(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const months = ['janv', 'févr', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc'];
  return `${+m[3]} ${months[+m[2] - 1]}`;
}

/** Nombre de jours depuis epoch pour une date ISO (pour l'échelle temps). */
export function dayNumber(iso: string): number {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return 0;
  return Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000);
}

export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
