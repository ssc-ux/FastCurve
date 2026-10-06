import { dayNumber, formatDate } from '../models/types';
import { FONT, AXIS, MUTED, esc, n } from './svg';

// ──────────────────────────────────────────────────────────────
// Axe du temps : mise en page, correspondance date → abscisse, coupures, graduations.
// Extrait de render.ts ; module pur, aucune dépendance DOM.
// ──────────────────────────────────────────────────────────────

export interface Layout {
  width: number;
  marginLeft: number;
  marginRight: number;
  plotWidth: number;
}

// Amincit une liste de dates pour que les étiquettes ne se chevauchent pas :
// on garde une graduation seulement si elle est à ≥ minGap px de la précédente
// (la première et la dernière sont toujours conservées).
//
// Priorités : première et dernière date, puis le début de chaque salve après
// une coupure d'axe (sinon une salve entière pouvait rester sans aucune date
// lisible), puis les autres dates de gauche à droite.
export function thinTicks(dates: string[], xOf: (d: string) => number, minGap: number, coupures: number[] = []) {
  if (!dates.length) return [];
  const xs = dates.map(xOf);
  const ordre: number[] = [0];
  if (dates.length > 1) ordre.push(dates.length - 1);
  for (let i = 1; i < dates.length - 1; i++) {
    if (coupures.some(c => c > xs[i - 1] && c < xs[i])) ordre.push(i);
  }
  for (let i = 1; i < dates.length - 1; i++) if (!ordre.includes(i)) ordre.push(i);
  const retenus: number[] = [];
  for (const i of ordre) {
    if (retenus.every(j => Math.abs(xs[j] - xs[i]) >= minGap)) retenus.push(i);
  }
  return retenus.sort((a, b) => a - b).map(i => ({ x: xs[i], label: formatDate(dates[i]) }));
}

// X mapping partagé par tous les panneaux
export function buildXMapper(dates: string[], timeAxis: boolean, layout: Layout) {
  const { marginLeft, plotWidth } = layout;
  const minGap = 78; // espace minimal entre étiquettes (format JJ/MM/AAAA plus large)
  if (dates.length === 0) {
    return { xOf: (_d: string) => marginLeft, ticks: [] as { x: number; label: string }[], dayOf: (_d: string) => 0, domain: [0, 1] as [number, number], coupures: [] as number[] };
  }
  if (timeAxis) {
    const days = dates.map(dayNumber);
    let min = Math.min(...days);
    let max = Math.max(...days);
    if (min === max) { min -= 1; max += 1; }
    // Coupures d'axe : un trou de plusieurs années entre deux salves de
    // prélèvements tasserait chacune en un trait vertical illisible. Le trou
    // est remplacé par un court intervalle fixe, marqué « // » sur l'axe ;
    // le temps reste proportionnel DE PART ET D'AUTRE.
    const trous = coupuresDeTemps(days);
    const conserve = max - min - trous.reduce((t, c) => t + (c.fin - c.debut), 0);
    const tailleCoupure = Math.max(1, conserve * 0.06);
    const virtuel = (d: number) => {
      let v = d;
      for (const c of trous) {
        if (d >= c.fin) v -= (c.fin - c.debut) - tailleCoupure;
        else if (d > c.debut) v -= (d - c.debut) * (1 - tailleCoupure / (c.fin - c.debut));
      }
      return v;
    };
    const vmin = virtuel(min), vmax = virtuel(max);
    const pad = (vmax - vmin) * 0.04;
    const dmin = vmin - pad;
    const dmax = vmax + pad;
    const scaleX = (d: number) => marginLeft + ((virtuel(d) - dmin) / (dmax - dmin)) * plotWidth;
    const xOf = (date: string) => scaleX(dayNumber(date));
    const coupures = trous.map(c => (scaleX(c.debut) + scaleX(c.fin)) / 2);
    return { xOf, ticks: thinTicks(dates, xOf, minGap, coupures), dayOf: (d: string) => dayNumber(d), domain: [dmin, dmax] as [number, number], coupures };
  }
  // Catégoriel : espacement régulier
  const n = dates.length;
  const step = n > 1 ? plotWidth / (n - 1) : 0;
  const idx = new Map(dates.map((d, i) => [d, i]));
  const xOf = (date: string) => marginLeft + (idx.get(date) ?? 0) * step;
  return { xOf, ticks: thinTicks(dates, xOf, minGap), dayOf: (d: string) => idx.get(d) ?? 0, domain: [0, n - 1] as [number, number], coupures: [] as number[] };
}

/**
 * Trous de temps à couper sur l'axe : un intervalle entre deux dates
 * consécutives est coupé s'il dépasse à la fois 180 jours, dix fois l'écart
 * médian entre prélèvements et le tiers de la période totale. Un suivi
 * régulier, même très espacé, n'est jamais coupé.
 */
export function coupuresDeTemps(days: number[]): { debut: number; fin: number }[] {
  const u = [...new Set(days)].sort((a, b) => a - b);
  if (u.length < 3) return [];
  const ecarts = u.slice(1).map((d, i) => d - u[i]);
  const tri = [...ecarts].sort((a, b) => a - b);
  const mediane = tri[Math.floor(tri.length / 2)];
  const span = u[u.length - 1] - u[0];
  const out: { debut: number; fin: number }[] = [];
  ecarts.forEach((e, i) => {
    if (e > 180 && e > mediane * 10 && e > span / 3) out.push({ debut: u[i], fin: u[i + 1] });
  });
  return out;
}

export function xAxis(xm: ReturnType<typeof buildXMapper>, y: number, layout: Layout): string {
  const { marginLeft, plotWidth } = layout;
  let out = `<line x1="${marginLeft}" y1="${n(y)}" x2="${marginLeft + plotWidth}" y2="${n(y)}" stroke="${AXIS}" stroke-width="1.2"/>`;
  // Coupure d'axe : fond blanc puis deux traits obliques « // ».
  for (const c of xm.coupures) {
    out += `<rect x="${n(c - 5)}" y="${n(y - 5)}" width="10" height="10" fill="#fff"/>`;
    out += `<line x1="${n(c - 6)}" y1="${n(y + 5)}" x2="${n(c - 1)}" y2="${n(y - 5)}" stroke="${AXIS}" stroke-width="1.2"/>`;
    out += `<line x1="${n(c + 1)}" y1="${n(y + 5)}" x2="${n(c + 6)}" y2="${n(y - 5)}" stroke="${AXIS}" stroke-width="1.2"/>`;
  }
  xm.ticks.forEach(t => {
    out += `<line x1="${n(t.x)}" y1="${n(y)}" x2="${n(t.x)}" y2="${n(y + 4)}" stroke="${AXIS}" stroke-width="1"/>`;
    out += `<text x="${n(t.x)}" y="${n(y + 16)}" text-anchor="middle" font-family="${FONT}" font-size="9.5" fill="${MUTED}">${esc(t.label)}</text>`;
  });
  return out;
}
