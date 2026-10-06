import type { StudyState, Parameter } from '../models/types';
import { niceScale } from './scale';
import { n, clamp } from './svg';
import { groupPanel } from './panneaux';

// ──────────────────────────────────────────────────────────────
// Préparation des données : période, index des mesures, points, échelles, axes.
// Extrait de render.ts ; module pur, aucune dépendance DOM.
// ──────────────────────────────────────────────────────────────

export interface PlotPoint { date: string; x: number; y: number; value: number; }

export interface RenderResult {
  svg: string;
  width: number;
  height: number;
  /** Zones interactives des points (coord SVG) pour le survol. */
  hotspots: { param: Parameter; date: string; value: number; cx: number; cy: number }[];
  /**
   * Vrai uniquement pour le placeholder « rien à afficher » (aucun paramètre,
   * aucune date). Sert à ChartPanel pour centrer verticalement cette petite
   * carte dans le canvas au lieu de la laisser collée en haut d'un grand vide.
   */
  empty: boolean;
  /**
   * Séries écrasées au ras de leur axe : deux échelles ne peuvent pas loger
   * des ordres de grandeur trop éloignés. La figure reste juste, mais ces
   * courbes n'y sont pas lisibles — autant le dire au médecin plutôt que de
   * le laisser croire à des paramètres restés plats. Peut venir du mode
   * « Graphe unique » (tous les paramètres) ou d'un panneau groupé en mode
   * « Panneaux » (les membres d'un même groupe).
   */
  ecrasees: string[];
}

export function plottedValue(_p: Parameter, value: number): number | null {
  return value;
}

export function unitLabel(p: Parameter): string {
  if (p.category === 'efr' && p.display === 'percent') return '% théo.';
  return p.unit || '';
}

/**
 * Libellé d'un axe partagé par plusieurs paramètres : leur unité commune, ou
 * rien si elle diffère. Un axe ne peut pas porter honnêtement plusieurs
 * unités à la fois (voir le commentaire de `repartirAxes`) ; dans ce cas
 * chaque série porte son unité dans sa propre entrée de légende.
 */
export function libelleAxe(liste: Parameter[]): string {
  const u = [...new Set(liste.map(unitLabel).filter(Boolean))];
  return u.length === 1 ? u[0] : '';
}

export interface GroupePanneau { params: Parameter[]; }

/**
 * Regroupe les paramètres à afficher par panneau (mode « Panneaux »).
 *
 * Chaque paramètre porte un `panelGroup` optionnel. Par défaut il est absent :
 * le paramètre forme alors un groupe à lui seul (sa propre id sert de clé),
 * exactement le comportement historique — un panneau par paramètre. Deux
 * paramètres qui partagent la même valeur de `panelGroup` sont rendus
 * ensemble par `groupPanel`. L'ordre des groupes suit l'ordre (`order`) du
 * premier de leurs membres, pour rester fidèle à l'ordre voulu par le
 * médecin dans la grille.
 */
export function grouperPourPanneaux(params: Parameter[]): GroupePanneau[] {
  const map = new Map<string, Parameter[]>();
  for (const p of params) {
    const cle = p.panelGroup || p.id;
    const liste = map.get(cle);
    if (liste) liste.push(p); else map.set(cle, [p]);
  }
  const groupes = [...map.values()].map(liste => ({
    params: [...liste].sort((a, b) => a.order - b.order),
  }));
  groupes.sort((a, b) => a.params[0].order - b.params[0].order);
  return groupes;
}

/** #8 : restreint l'étude à la fenêtre [fromDate, toDate] (les barres sont bornées). */
export function applyPeriod(study: StudyState): StudyState {
  const from = study.settings.fromDate || null;
  const to = study.settings.toDate || null;
  if (!from && !to) return study;
  const HI = '9999-12-31', LO = '0000-01-01';
  const inWin = (d: string) => (!from || d >= from) && (!to || d <= to);
  const clamp = (d: string) => (from && d < from ? from : to && d > to ? to : d);
  return {
    ...study,
    measurements: study.measurements.filter(m => inWin(m.date)),
    annotations: (study.annotations || []).filter(a => inWin(a.date)),
    treatments: study.treatments
      .filter(t => t.start <= (to || HI) && (t.end || HI) >= (from || LO))
      .map(t => ({
        ...t,
        start: clamp(t.start),
        end: t.end ? clamp(t.end) : t.end,
        dosePoints: (t.dosePoints || []).filter(dp => inWin(dp.date)),
      })),
  };
}

/**
 * Mesures rangées par paramètre et triées par date, en une seule lecture.
 *
 * Chaque étape du tracé refiltrait `study.measurements` pour son compte :
 * l'échelle, les points, la répartition des axes. Sur douze paramètres et
 * quatre-vingts prélèvements, cela faisait une vingtaine de traversées de neuf
 * cent soixante mesures. En mémoire ce n'est rien ; dans le navigateur, chaque
 * lecture passe par un proxy réactif, et le rendu qui coûte 2 ms hors page en
 * coûtait 19 dedans — à chaque caractère tapé. On ne lit donc plus qu'une fois.
 */
export type IndexMesures = Map<string, StudyState['measurements']>;
export function indexerMesures(study: StudyState): IndexMesures {
  const idx: IndexMesures = new Map();
  for (const m of study.measurements) {
    const l = idx.get(m.parameterId);
    if (l) l.push(m); else idx.set(m.parameterId, [m]);
  }
  for (const l of idx.values()) l.sort((a, b) => a.date.localeCompare(b.date));
  return idx;
}

export type SeriesPoint = { date: string; x: number; value: number; q: '<' | '>' | null; outOfRange: boolean; apresCoupure?: boolean };

export function collectPoints(mesures: StudyState['measurements'], p: Parameter, xOf: (d: string) => number, coupures: number[] = []): SeriesPoint[] {
  const pts = collectPointsBruts(mesures, p, xOf);
  // Premier point après une coupure d'axe : pas de trait plein à travers le
  // trou (on ne sait rien de ce qui s'y est passé).
  for (let i = 1; i < pts.length; i++) {
    const a = Math.min(pts[i - 1].x, pts[i].x), b = Math.max(pts[i - 1].x, pts[i].x);
    if (coupures.some(c => c > a && c < b)) pts[i].apresCoupure = true;
  }
  return pts;
}

export function collectPointsBruts(mesures: StudyState['measurements'], p: Parameter, xOf: (d: string) => number): SeriesPoint[] {
  const isPct = p.category === 'efr' && p.display === 'percent';
  return mesures
    .map(m => {
      const value = plottedValue(p, m.value);
      const oor = !isPct && value != null &&
        ((p.refLow != null && value < p.refLow) || (p.refHigh != null && value > p.refHigh));
      return { date: m.date, x: xOf(m.date), value, q: m.qualifier ?? null, outOfRange: !!oor };
    })
    .filter(pt => pt.value != null) as SeriesPoint[];
}

export function valueScale(mesures: StudyState['measurements'], p: Parameter, reglages: StudyState['settings']) {
  const vals = mesures
    .map(m => plottedValue(p, m.value))
    .filter((v): v is number => v != null);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  // Intégrer les bornes de normale si affichées et en valeur absolue
  if (reglages.showReference && !(p.category === 'efr' && p.display === 'percent')) {
    if (p.refLow != null) lo = Math.min(lo, p.refLow);
    if (p.refHigh != null) hi = Math.max(hi, p.refHigh);
  }
  // 5 graduations plutôt que 4 : avec 4, une CRP à 68 donnait un axe à 100,
  // soit un tiers de panneau vide. Dans une figure de compte-rendu qui doit
  // tenir en quart de page, c'est de la place perdue.
  return niceScale(lo, hi, 5);
}

/**
 * Répartition des séries entre l'axe de gauche et celui de droite, en mode
 * graphe unique.
 *
 * L'ancienne règle prenait la première unité rencontrée à gauche et la
 * deuxième à droite, les suivantes revenant à gauche. Sur un suivi ordinaire
 * (CRP, créatinine, hémoglobine, plaquettes, leucocytes, albumine) cela mettait
 * la créatinine seule à droite et tout le reste à gauche sur une échelle de
 * 0 à 500 : l'hémoglobine et l'albumine devenaient deux traits plats au ras du
 * zéro, et la courbe de créatinine culminait visuellement à « 490 » sur un axe
 * gradué en mg/L. On ne peut pas mettre ça dans un compte-rendu.
 *
 * On répartit donc selon l'ordre de grandeur. Deux règles :
 *  · une même unité ne se scinde jamais entre les deux axes — deux axes gradués
 *    en mg/L à des échelles différentes seraient pires que le mal ;
 *  · parmi les coupures possibles entre groupes d'unités triés par amplitude,
 *    on retient celle qui minimise le pire écart d'amplitude au sein d'un axe.
 */
export function repartirAxes(mesuresDe: (p: Parameter) => StudyState['measurements'], params: Parameter[]): { gauche: Parameter[]; droite: Parameter[] } {
  const ampli = (p: Parameter) => {
    const vs = mesuresDe(p).map(m => Math.abs(m.value));
    return vs.length ? Math.max(...vs) : 0;
  };
  // Groupes indivisibles : une unité, ses paramètres, son amplitude.
  const parUnite = new Map<string, { params: Parameter[]; max: number }>();
  for (const p of params) {
    const u = unitLabel(p);
    const g = parUnite.get(u) ?? { params: [], max: 0 };
    g.params.push(p);
    g.max = Math.max(g.max, ampli(p));
    parUnite.set(u, g);
  }
  const groupes = [...parUnite.values()].sort((a, b) => b.max - a.max);
  const tout = { gauche: params, droite: [] as Parameter[] };
  if (groupes.length < 2) return tout;

  const ecart = (g: typeof groupes) => {
    const maxs = g.map(x => x.max).filter(v => v > 0);
    if (maxs.length < 2) return 1;
    return Math.max(...maxs) / Math.min(...maxs);
  };
  // Un seul axe suffit tant que tout tient dans le même ordre de grandeur :
  // un deuxième axe est une charge de lecture, on ne l'impose pas sans raison.
  if (ecart(groupes) <= 8) return tout;

  let meilleure = -1;
  let pire = Infinity;
  for (let i = 1; i < groupes.length; i++) {
    const p = Math.max(ecart(groupes.slice(0, i)), ecart(groupes.slice(i)));
    if (p < pire) { pire = p; meilleure = i; }
  }
  if (meilleure < 0) return tout;
  const gGauche = groupes.slice(0, meilleure).flatMap(g => g.params);
  const gDroite = groupes.slice(meilleure).flatMap(g => g.params);
  // On conserve l'ordre voulu par l'utilisateur à l'intérieur de chaque axe.
  const rang = new Map(params.map((p, i) => [p.id, i]));
  const trier = (l: Parameter[]) => l.sort((a, b) => rang.get(a.id)! - rang.get(b.id)!);
  return { gauche: trier(gGauche), droite: trier(gDroite) };
}

export function valueScaleMulti(mesuresDe: (p: Parameter) => StudyState['measurements'], params: Parameter[]) {
  const vals: number[] = [];
  for (const p of params) {
    for (const m of mesuresDe(p)) {
      const v = plottedValue(p, m.value);
      if (v != null) vals.push(v);
    }
  }
  if (!vals.length) return niceScale(0, 1, 5);
  return niceScale(Math.min(...vals), Math.max(...vals), 5);
}
