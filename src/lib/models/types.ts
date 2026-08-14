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

/**
 * Lecture « tolérante » d'une date tapée à la main dans la grille.
 *
 * Dans un tableur on tape une date comme on la dit : « 5/12 », « 05122026 »,
 * « 5.12.26 ». Exiger un format unique oblige à réfléchir au clavier au lieu de
 * réfléchir au patient ; on accepte donc tout ce qui est lisible sans ambiguïté :
 *  - tous les formats de `parseDate` (ISO, JJ/MM/AAAA, JJ-MM-AA…) ;
 *  - JJ/MM sans année → année de référence (aujourd'hui par défaut) ;
 *  - 8 chiffres collés : JJMMAAAA, sinon AAAAMMJJ ;
 *  - 6 chiffres collés : JJMMAA ;
 *  - 4 chiffres collés : JJMM (année de référence).
 *
 * Retourne une date ISO, ou null si la saisie n'est pas interprétable — dans ce
 * cas l'appelant DOIT conserver l'ancienne date : deviner à la place du médecin
 * déplacerait des valeurs cliniques sur une date qu'il n'a pas choisie.
 */
export function parseDateSouple(input: string, reference?: string): string | null {
  if (!input) return null;
  const s = input.trim();
  if (!s) return null;

  const direct = parseDate(s);
  if (direct) return direct;

  const anneeRef = +(reference ?? todayISO()).slice(0, 4);

  // JJ/MM (ou JJ-MM, JJ.MM) sans année
  const sansAnnee = s.match(/^(\d{1,2})[\/\-.](\d{1,2})$/);
  if (sansAnnee) {
    const d = +sansAnnee[1], m = +sansAnnee[2];
    return validYMD(anneeRef, m, d) ? `${anneeRef}-${pad(m)}-${pad(d)}` : null;
  }

  // Suites de chiffres collées (frappe rapide au pavé numérique)
  const chiffres = s.match(/^(\d{4,8})$/);
  if (!chiffres) return null;
  const n = chiffres[1];

  if (n.length === 8) {
    // JJMMAAAA d'abord (c'est ce qu'on tape en français), AAAAMMJJ en repli.
    const jma = tenter(+n.slice(4, 8), +n.slice(2, 4), +n.slice(0, 2));
    if (jma) return jma;
    return tenter(+n.slice(0, 4), +n.slice(4, 6), +n.slice(6, 8));
  }
  if (n.length === 6) {
    const aa = +n.slice(4, 6);
    return tenter(aa >= 70 ? 1900 + aa : 2000 + aa, +n.slice(2, 4), +n.slice(0, 2));
  }
  if (n.length === 4) return tenter(anneeRef, +n.slice(2, 4), +n.slice(0, 2));
  return null;
}

function tenter(y: number, m: number, d: number): string | null {
  return validYMD(y, m, d) ? `${y}-${pad(m)}-${pad(d)}` : null;
}

function validYMD(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > 31) return false;
  if (y < 1900 || y > 2100) return false;
  return true;
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
