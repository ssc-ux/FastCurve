import type { StudyState, Parameter } from '../models/types';
import { dayNumber, formatDate } from '../models/types';
import { niceScale, fmtNum, fmtTick } from './scale';

// ──────────────────────────────────────────────────────────────
// Rendu SVG type publication scientifique (NEJM)
// Fonction pure : StudyState → chaîne SVG. Aucune dépendance DOM.
// ──────────────────────────────────────────────────────────────

const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif";
const INK = '#111111';
const AXIS = '#333333';
const GRID = '#e6e6e6';
const MUTED = '#666666';
const REF_FILL = '#f0f4f8';

const MARKER_SHAPES = ['circle', 'square', 'triangle', 'diamond', 'circle-open', 'square-open'] as const;
type MarkerShape = typeof MARKER_SHAPES[number];

export interface PlotPoint { date: string; x: number; y: number; value: number; }

export interface RenderResult {
  svg: string;
  width: number;
  height: number;
  /** Zones interactives des points (coord SVG) pour le survol. */
  hotspots: { param: Parameter; date: string; value: number; cx: number; cy: number }[];
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Valeur à tracer. Pour les EFR, le mode « % théorique » ne change que
 * l'étiquette/échelle : les valeurs saisies (des pourcentages) sont tracées
 * telles quelles.
 */
function plottedValue(_p: Parameter, value: number): number | null {
  return value;
}

function unitLabel(p: Parameter): string {
  if (p.category === 'efr' && p.display === 'percent') return '% théo.';
  return p.unit || '';
}

function marker(shape: MarkerShape, cx: number, cy: number, r: number, color: string): string {
  switch (shape) {
    case 'circle':
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" stroke="#fff" stroke-width="1"/>`;
    case 'circle-open':
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#fff" stroke="${color}" stroke-width="2"/>`;
    case 'square':
      return `<rect x="${cx - r}" y="${cy - r}" width="${2 * r}" height="${2 * r}" fill="${color}" stroke="#fff" stroke-width="1"/>`;
    case 'square-open':
      return `<rect x="${cx - r}" y="${cy - r}" width="${2 * r}" height="${2 * r}" fill="#fff" stroke="${color}" stroke-width="2"/>`;
    case 'triangle': {
      const p = `${cx},${cy - r * 1.2} ${cx - r * 1.1},${cy + r} ${cx + r * 1.1},${cy + r}`;
      return `<polygon points="${p}" fill="${color}" stroke="#fff" stroke-width="1"/>`;
    }
    case 'diamond': {
      const p = `${cx},${cy - r * 1.3} ${cx + r * 1.3},${cy} ${cx},${cy + r * 1.3} ${cx - r * 1.3},${cy}`;
      return `<polygon points="${p}" fill="${color}" stroke="#fff" stroke-width="1"/>`;
    }
  }
}

interface Layout {
  width: number;
  marginLeft: number;
  marginRight: number;
  plotWidth: number;
}

// Amincit une liste de dates pour que les étiquettes ne se chevauchent pas :
// on garde une graduation seulement si elle est à ≥ minGap px de la précédente
// (la première et la dernière sont toujours conservées).
function thinTicks(dates: string[], xOf: (d: string) => number, minGap: number) {
  const ticks: { x: number; label: string }[] = [];
  let lastX = -Infinity;
  const lastIdx = dates.length - 1;
  dates.forEach((d, i) => {
    const x = xOf(d);
    const isEdge = i === 0 || i === lastIdx;
    if (isEdge || x - lastX >= minGap) {
      ticks.push({ x, label: formatDate(d) });
      lastX = x;
    }
  });
  // Si la dernière étiquette est trop proche de l'avant-dernière, retirer l'avant-dernière.
  if (ticks.length >= 2 && ticks[ticks.length - 1].x - ticks[ticks.length - 2].x < minGap) {
    ticks.splice(ticks.length - 2, 1);
  }
  return ticks;
}

// X mapping partagé par tous les panneaux
function buildXMapper(dates: string[], timeAxis: boolean, layout: Layout) {
  const { marginLeft, plotWidth } = layout;
  const minGap = 78; // espace minimal entre étiquettes (format JJ/MM/AAAA plus large)
  if (dates.length === 0) {
    return { xOf: (_d: string) => marginLeft, ticks: [] as { x: number; label: string }[], dayOf: (_d: string) => 0, domain: [0, 1] as [number, number] };
  }
  if (timeAxis) {
    const days = dates.map(dayNumber);
    let min = Math.min(...days);
    let max = Math.max(...days);
    if (min === max) { min -= 1; max += 1; }
    const span = max - min;
    const pad = span * 0.04;
    const dmin = min - pad;
    const dmax = max + pad;
    const scaleX = (d: number) => marginLeft + ((d - dmin) / (dmax - dmin)) * plotWidth;
    const xOf = (date: string) => scaleX(dayNumber(date));
    return { xOf, ticks: thinTicks(dates, xOf, minGap), dayOf: (d: string) => dayNumber(d), domain: [dmin, dmax] as [number, number] };
  }
  // Catégoriel : espacement régulier
  const n = dates.length;
  const step = n > 1 ? plotWidth / (n - 1) : 0;
  const idx = new Map(dates.map((d, i) => [d, i]));
  const xOf = (date: string) => marginLeft + (idx.get(date) ?? 0) * step;
  return { xOf, ticks: thinTicks(dates, xOf, minGap), dayOf: (d: string) => idx.get(d) ?? 0, domain: [0, n - 1] as [number, number] };
}

/** #8 : restreint l'étude à la fenêtre [fromDate, toDate] (les barres sont bornées). */
function applyPeriod(study: StudyState): StudyState {
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

export function renderChart(study: StudyState, width = 920): RenderResult {
  study = applyPeriod(study);
  const s = study.settings;
  const params = [...study.parameters].sort((a, b) => a.order - b.order)
    .filter(p => study.measurements.some(m => m.parameterId === p.id));
  const dates = [...new Set(study.measurements.map(m => m.date))].sort();

  // Domaine de l'axe X : toutes les dates (mesures + traitements + repères),
  // pour que la frise s'étale même sans valeurs biologiques (import carré bleu).
  const allDatesSet = new Set<string>(dates);
  for (const t of study.treatments) {
    if (t.start) allDatesSet.add(t.start);
    if (t.end) allDatesSet.add(t.end);
    for (const dp of t.dosePoints || []) if (dp.date) allDatesSet.add(dp.date);
  }
  for (const a of study.annotations || []) if (a.date) allDatesSet.add(a.date);
  const allDates = [...allDatesSet].sort();

  const marginLeft = 66;
  const marginRight = s.chartMode === 'single' ? 66 : 24;
  const plotWidth = width - marginLeft - marginRight;
  const layout: Layout = { width, marginLeft, marginRight, plotWidth };

  const xm = buildXMapper(allDates, s.timeAxis, layout);

  const hotspots: RenderResult['hotspots'] = [];
  const parts: string[] = [];
  /** Paramètres tracés sur l'axe de droite (mode graphe unique à 2 axes). */
  const axeDroite = new Set<string>();

  // En-tête
  let cursorY = 8;
  const titleH = s.title ? 26 : 0;
  const subtitleH = s.subtitle ? 18 : 0;
  if (s.title) {
    parts.push(`<text x="${marginLeft}" y="${cursorY + 18}" font-family="${FONT}" font-size="17" font-weight="700" fill="${INK}">${esc(s.title)}</text>`);
    cursorY += titleH;
  }
  if (s.subtitle) {
    parts.push(`<text x="${marginLeft}" y="${cursorY + 12}" font-family="${FONT}" font-size="12" fill="${MUTED}">${esc(s.subtitle)}</text>`);
    cursorY += subtitleH;
  }
  // Un export réalisé avec un filtre de période ne doit pas laisser croire que
  // le suivi est complet : la fenêtre est inscrite dans le graphique lui-même.
  if (s.fromDate || s.toDate) {
    const du = s.fromDate ? formatDate(s.fromDate) : '…';
    const au = s.toDate ? formatDate(s.toDate) : '…';
    parts.push(`<text x="${marginLeft}" y="${cursorY + 11}" font-family="${FONT}" font-size="11" font-style="italic" fill="${MUTED}">${esc(`Période affichée : du ${du} au ${au}`)}</text>`);
    cursorY += 16;
  }
  cursorY += 6;

  const plotStartY = cursorY;

  // Empreinte des traitements (calculée en amont pour dimensionner)
  const continuousTr = [...study.treatments].filter(t => t.kind === 'continuous').sort((a, b) => a.order - b.order);
  const eventTr = [...study.treatments].filter(t => t.kind === 'event').sort((a, b) => a.start.localeCompare(b.start));
  const annotations = [...(study.annotations || [])].sort((a, b) => a.date.localeCompare(b.date));
  const trRowH = 38;
  const xAxisH = 34;

  // Bande réservée en haut pour les annotations libres (les événements sont
  // désormais dessinés sous la courbe). + marge pour le titre du 1er panneau.
  const hasEvents = eventTr.length > 0;
  const hasAnnos = annotations.length > 0;
  const eventLaneH = hasAnnos ? 30 : 0;
  const availTop = plotStartY + eventLaneH + 14;
  let plotAreaBottom = availTop; // bas du dernier panneau (hors axe X)

  let panelsSVG = '';
  let plotBottom = 0;

  if (s.chartMode === 'stacked' && params.length) {
    // ── Mode panneaux empilés ──
    const gap = 26;
    /*
     * Hauteur PAR panneau, pas hauteur totale répartie : à six paramètres, une
     * enveloppe fixe de 520 px donnait des bandes de 65 px où toutes les courbes
     * paraissaient plates. Une figure de compte-rendu doit rester lisible quel
     * que soit le nombre de séries — elle grandit, elle ne s'écrase pas.
     */
    const hauteurConfort = params.length <= 2 ? 240 : params.length <= 4 ? 170 : 130;
    const panelH = Math.max(110, Math.min(hauteurConfort, 560 / Math.min(params.length, 3)));
    let py = availTop;
    params.forEach((p, pi) => {
      const pts = collectPoints(study, p, xm.xOf);
      const sc = valueScale(study, p);
      const y0 = py;
      const y1 = py + panelH;
      const yOf = (v: number) => y1 - ((v - sc.min) / (sc.max - sc.min)) * (y1 - y0);

      panelsSVG += panel(p, pi, pts, sc, yOf, y0, y1, layout, xm, s, hotspots, false);
      py = y1 + gap;
      plotBottom = y1;
    });
    plotAreaBottom = plotBottom;
    // Axe X commun sous le dernier panneau
    panelsSVG += xAxis(xm, plotBottom, layout);
    plotBottom += xAxisH;
  } else if (s.chartMode === 'single' && params.length) {
    // ── Mode graphe unique, 2 axes ──
    const plotH = 420;
    const y0 = availTop;
    const y1 = availTop + plotH;
    // Répartition gauche/droite par unité
    const units = [...new Set(params.map(p => unitLabel(p)))];
    const leftUnit = units[0];
    const rightUnit = units.find(u => u !== leftUnit);
    const leftParams = params.filter(p => unitLabel(p) === leftUnit);
    const rightParams = rightUnit ? params.filter(p => unitLabel(p) === rightUnit) : [];
    const otherParams = params.filter(p => !leftParams.includes(p) && !rightParams.includes(p));
    leftParams.push(...otherParams); // les unités surnuméraires vont à gauche

    /*
     * L'axe de gauche peut porter plusieurs unités (CRP en mg/L, plaquettes en
     * G/L…). L'étiqueter avec la seule première est faux à la lecture : on
     * annonce toutes celles qu'il porte réellement.
     */
    const libelleAxe = (liste: Parameter[]) =>
      [...new Set(liste.map(unitLabel).filter(Boolean))].join(' · ');
    const titreGauche = libelleAxe(leftParams);
    const titreDroite = libelleAxe(rightParams);

    const scL = valueScaleMulti(study, leftParams);
    const scR = rightParams.length ? valueScaleMulti(study, rightParams) : null;
    const yOfL = (v: number) => y1 - ((v - scL.min) / (scL.max - scL.min)) * (y1 - y0);
    const yOfR = scR ? (v: number) => y1 - ((v - scR.min) / (scR.max - scR.min)) * (y1 - y0) : yOfL;

    // Grille + axe gauche
    panelsSVG += `<line x1="${marginLeft}" y1="${y0}" x2="${marginLeft}" y2="${y1}" stroke="${AXIS}" stroke-width="1.2"/>`;
    scL.ticks.forEach(t => {
      const yy = yOfL(t);
      panelsSVG += `<line x1="${marginLeft}" y1="${yy}" x2="${marginLeft + plotWidth}" y2="${yy}" stroke="${GRID}" stroke-width="1"/>`;
      panelsSVG += `<text x="${marginLeft - 8}" y="${yy + 3.5}" text-anchor="end" font-family="${FONT}" font-size="10.5" fill="${MUTED}">${fmtTick(t, scL.step)}</text>`;
    });
    panelsSVG += `<text transform="translate(16,${(y0 + y1) / 2}) rotate(-90)" text-anchor="middle" font-family="${FONT}" font-size="11" fill="${INK}">${esc(titreGauche)}</text>`;

    if (scR) {
      panelsSVG += `<line x1="${marginLeft + plotWidth}" y1="${y0}" x2="${marginLeft + plotWidth}" y2="${y1}" stroke="${AXIS}" stroke-width="1.2"/>`;
      scR.ticks.forEach(t => {
        const yy = yOfR(t);
        panelsSVG += `<text x="${marginLeft + plotWidth + 8}" y="${yy + 3.5}" text-anchor="start" font-family="${FONT}" font-size="10.5" fill="${MUTED}">${fmtTick(t, scR.step)}</text>`;
      });
      panelsSVG += `<text transform="translate(${width - 14},${(y0 + y1) / 2}) rotate(90)" text-anchor="middle" font-family="${FONT}" font-size="11" fill="${INK}">${esc(titreDroite)}</text>`;
    }

    for (const p of rightParams) axeDroite.add(p.id);
    params.forEach((p) => {
      const onRight = rightParams.includes(p);
      const yOf = onRight ? yOfR : yOfL;
      const pts = collectPoints(study, p, xm.xOf);
      panelsSVG += series(p, params.indexOf(p), pts, yOf, s, hotspots, y0, y1);
    });

    panelsSVG += xAxis(xm, y1, layout);
    plotAreaBottom = y1;
    plotBottom = y1 + xAxisH;
  } else if (allDates.length) {
    // Pas de courbe mais des repères datés (ex. frise de traitements seule)
    panelsSVG += `<text x="${width / 2}" y="${availTop + 60}" text-anchor="middle" font-family="${FONT}" font-size="13" fill="${MUTED}">Frise des traitements — ajoutez des valeurs pour tracer les courbes</text>`;
    plotAreaBottom = availTop + 110;
    panelsSVG += xAxis(xm, plotAreaBottom, layout);
    plotBottom = plotAreaBottom + xAxisH;
  } else {
    // Rien à afficher : placeholder
    panelsSVG += `<text x="${width / 2}" y="${availTop + 120}" text-anchor="middle" font-family="${FONT}" font-size="14" fill="${MUTED}">Ajoutez des valeurs pour générer la courbe</text>`;
    plotAreaBottom = availTop + 200;
    plotBottom = availTop + 240;
  }

  parts.push(panelsSVG);

  // ── Annotations libres (repères datés, dans la bande du haut) ──
  if (hasAnnos && params.length) {
    const annLabelY = plotStartY + 11;
    let lastAx = -Infinity;
    annotations.forEach((a) => {
      const x = xm.xOf(a.date);
      if (x < marginLeft - 1 || x > marginLeft + plotWidth + 1) return;
      parts.push(`<line x1="${x}" y1="${availTop}" x2="${x}" y2="${plotAreaBottom}" stroke="#2a6fb0" stroke-width="1" opacity="0.55"/>`);
      parts.push(`<polygon points="${x},${availTop} ${x - 3.5},${availTop - 6} ${x + 3.5},${availTop - 6}" fill="#2a6fb0"/>`);
      if (x - lastAx >= 30) {
        parts.push(`<text x="${x}" y="${annLabelY}" text-anchor="middle" font-family="${FONT}" font-size="9.5" font-style="italic" fill="#2a6fb0">${esc(a.text)}</text>`);
        lastAx = x;
      }
    });
  }

  // ── Bande des traitements : continus = barres, ponctuels = flèches colorées ──
  let bandY = plotBottom + 12;
  const bandStartY = bandY;
  const bandBgIndex = parts.length; // le fond sera inséré ici (derrière la bande)
  const hasBand = continuousTr.length > 0 || eventTr.length > 0;
  if (hasBand) {
    bandY += 8; // léger espace en haut de la bande (plus d'en-tête « Traitements »)
  }
  if (continuousTr.length) {
    continuousTr.forEach((t) => {
      const x1 = clamp(xm.xOf(t.start), marginLeft, marginLeft + plotWidth);
      const endDate = t.end || (allDates.length ? allDates[allDates.length - 1] : t.start);
      const x2 = clamp(xm.xOf(endDate), marginLeft, marginLeft + plotWidth);
      const yy = bandY + trRowH / 2;
      const color = t.color || '#5b6472';
      const w = Math.max(10, x2 - x1);
      const rowBot = bandY + trRowH - 4;
      const rowTop = bandY + 3;
      const rowH = rowBot - rowTop;

      const dp = (t.dosePoints || [])
        .filter(p => typeof p.dose === 'number' && !isNaN(p.dose))
        .sort((a, b) => a.date.localeCompare(b.date));

      // Paliers cochés mais doses encore vides (toutes à 0) : le « coin » serait
      // d'une hauteur nulle et le traitement disparaîtrait. On garde la barre pleine.
      const taper = dp.some(p => p.dose > 0);

      if (taper) {
        // ── Décroissance : « coin » dont la hauteur suit la dose ──
        const maxDose = Math.max(...dp.map(p => p.dose), 1);
        const usable = rowH - 9; // laisse la place aux libellés de dose au-dessus
        const yOfDose = (d: number) => rowBot - (d / maxDose) * usable;
        const pts = dp.map(p => ({ x: clamp(xm.xOf(p.date), marginLeft, marginLeft + plotWidth), dose: p.dose }));
        if (x1 < pts[0].x) pts.unshift({ x: x1, dose: dp[0].dose });
        if (x2 > pts[pts.length - 1].x) pts.push({ x: x2, dose: dp[dp.length - 1].dose });
        let poly = `${pts[0].x},${rowBot}`;
        for (const pt of pts) poly += ` ${pt.x.toFixed(1)},${yOfDose(pt.dose).toFixed(1)}`;
        poly += ` ${pts[pts.length - 1].x},${rowBot}`;
        parts.push(`<polygon points="${poly}" fill="${color}"/>`);
        // Libellés de dose (aux paliers), sans doublon rapproché
        let lastLx = -Infinity;
        for (const p of dp) {
          const px = clamp(xm.xOf(p.date), marginLeft, marginLeft + plotWidth);
          if (px - lastLx < 20) continue;
          parts.push(`<text x="${px}" y="${(yOfDose(p.dose) - 2.5).toFixed(1)}" text-anchor="middle" font-family="${FONT}" font-size="9.5" font-weight="600" fill="${MUTED}">${fmtNum(p.dose)}</text>`);
          lastLx = px;
        }
      } else {
        // ── Dose constante : barre pleine ──
        const h = Math.min(24, trRowH - 6);
        parts.push(`<rect x="${x1}" y="${bandY + (trRowH - h) / 2}" width="${w}" height="${h}" rx="4" fill="${color}"/>`);
      }
      // Traitement toujours en cours : chevron « se poursuit » en bout de barre.
      // Sans lui, un traitement débuté à la dernière date connue se lit comme un
      // événement ponctuel alors qu'il n'est pas terminé.
      if (!t.end) {
        const cx = Math.min(x1 + w + 4, marginLeft + plotWidth - 7);
        parts.push(`<polygon points="${cx},${yy - 6} ${cx + 6},${yy} ${cx},${yy + 6}" fill="${color}" opacity="0.75"/>`);
      }

      const label = t.name;
      const estW = label.length * 6.1;
      const rightEdge = marginLeft + plotWidth;
      if (taper) {
        // Décroissance : nom en bas à gauche du coin (les doses sont en haut)
        if (x2 + 6 + estW <= rightEdge) {
          parts.push(`<text x="${x2 + 6}" y="${yy + 3.5}" font-family="${FONT}" font-size="13.5" font-weight="600" fill="${INK}">${esc(label)}</text>`);
        } else {
          parts.push(`<text x="${x1 + 5}" y="${rowBot - 3}" font-family="${FONT}" font-size="10.5" font-weight="600" fill="#ffffff">${esc(label)}</text>`);
        }
      } else if (x2 + 6 + estW <= rightEdge) {
        // À droite de la barre
        parts.push(`<text x="${x2 + 6}" y="${yy + 3.5}" font-family="${FONT}" font-size="13.5" font-weight="600" fill="${INK}">${esc(label)}</text>`);
      } else if (w > estW + 12) {
        // À l'intérieur de la barre (texte blanc)
        parts.push(`<text x="${x1 + 6}" y="${yy + 3.5}" font-family="${FONT}" font-size="13.5" font-weight="700" fill="#ffffff">${esc(label)}</text>`);
      } else {
        // À gauche de la barre
        parts.push(`<text x="${x1 - 6}" y="${yy + 3.5}" text-anchor="end" font-family="${FONT}" font-size="13.5" font-weight="600" fill="${INK}">${esc(label)}</text>`);
      }
      bandY += trRowH;
    });
    bandY += 6;
  }

  // ── Événements ponctuels : grosses flèches colorées, libellé DESSOUS ──
  if (eventTr.length) {
    const tipY = bandY + 2;         // pointe de la flèche (vers la courbe)
    const baseY = tipY + 26;        // base de la flèche
    const labelY0 = baseY + 16;     // libellé sous la flèche (pas de chevauchement)
    let lastLabelX = -Infinity;
    let lastLabelName = '';
    let row = 0;                    // alternance sur 2 rangs si libellés proches
    eventTr.forEach((t) => {
      const x = clamp(xm.xOf(t.start), marginLeft, marginLeft + plotWidth);
      const color = t.color || '#5b6472';
      // Grosse flèche pleine pointant vers le haut
      parts.push(`<line x1="${x}" y1="${baseY}" x2="${x}" y2="${tipY + 13}" stroke="${color}" stroke-width="4"/>`);
      parts.push(`<polygon points="${x},${tipY} ${x - 10},${tipY + 15} ${x + 10},${tipY + 15}" fill="${color}"/>`);
      // Libellé sous la flèche, une seule fois pour un même nom répété
      const label = t.dose ? `${t.name} (${t.dose})` : t.name;
      const sameNameNear = t.name === lastLabelName && x - lastLabelX < 150;
      if (!sameNameNear) {
        const estW = label.length * 6.6;
        row = (x - lastLabelX < estW + 12) ? (row === 0 ? 1 : 0) : 0; // évite le chevauchement horizontal
        const ly = labelY0 + row * 15;
        parts.push(`<text x="${x}" y="${ly}" text-anchor="middle" font-family="${FONT}" font-size="12.5" font-weight="700" fill="${INK}">${esc(label)}</text>`);
        lastLabelX = x;
        lastLabelName = t.name;
      }
    });
    bandY += 58; // place pour la flèche + 2 rangs de libellés
  }

  // Fond léger derrière toute la bande des traitements (meilleure visibilité)
  if (hasBand) {
    const bg = `<rect x="${marginLeft - 8}" y="${bandStartY - 5}" width="${plotWidth + 16}" height="${bandY - bandStartY + 4}" rx="7" fill="#f3f6fa" stroke="#dfe6ee" stroke-width="1"/>`;
    parts.splice(bandBgIndex, 0, bg);
  }

  // ── Légende ──
  let legendBottom = bandY;
  if (s.showLegend && params.length) {
    const perRow = Math.max(1, Math.floor(plotWidth / 160));
    // Avec deux axes, savoir lequel porte quelle série est indispensable :
    // sans repère, on lit une créatinine sur l'axe des plaquettes.
    const deuxAxes = axeDroite.size > 0;
    let lx = marginLeft;
    let ly = bandY + 8;
    let col = 0;
    params.forEach((p, i) => {
      const color = p.color || '#2a78d6';
      const shape = MARKER_SHAPES[i % MARKER_SHAPES.length];
      parts.push(marker(shape, lx + 5, ly, 4, color));
      parts.push(`<line x1="${lx - 3}" y1="${ly}" x2="${lx + 13}" y2="${ly}" stroke="${color}" stroke-width="2"/>`);
      const repere = deuxAxes ? (axeDroite.has(p.id) ? ' →' : ' ←') : '';
      parts.push(`<text x="${lx + 18}" y="${ly + 3.5}" font-family="${FONT}" font-size="11" fill="${INK}">${esc(p.name + repere)}</text>`);
      col++;
      if (col >= perRow) { col = 0; lx = marginLeft; ly += 20; }
      else { lx += 160; }
    });
    legendBottom = ly + 18;
  }

  const height = Math.ceil(legendBottom + 8);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="${FONT}">`
    + `<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`
    + parts.join('')
    + `</svg>`;

  return { svg, width, height, hotspots };
}

// ── Helpers de tracé ──────────────────────────────────────────

type SeriesPoint = { date: string; x: number; value: number; q: '<' | '>' | null; outOfRange: boolean };

function collectPoints(study: StudyState, p: Parameter, xOf: (d: string) => number): SeriesPoint[] {
  const isPct = p.category === 'efr' && p.display === 'percent';
  return study.measurements
    .filter(m => m.parameterId === p.id)
    .map(m => {
      const value = plottedValue(p, m.value);
      const oor = !isPct && value != null &&
        ((p.refLow != null && value < p.refLow) || (p.refHigh != null && value > p.refHigh));
      return { date: m.date, x: xOf(m.date), value, q: m.qualifier ?? null, outOfRange: !!oor };
    })
    .filter(pt => pt.value != null)
    .sort((a, b) => a.date.localeCompare(b.date)) as SeriesPoint[];
}

function valueScale(study: StudyState, p: Parameter) {
  const vals = study.measurements
    .filter(m => m.parameterId === p.id)
    .map(m => plottedValue(p, m.value))
    .filter((v): v is number => v != null);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  // Intégrer les bornes de normale si affichées et en valeur absolue
  if (study.settings.showReference && !(p.category === 'efr' && p.display === 'percent')) {
    if (p.refLow != null) lo = Math.min(lo, p.refLow);
    if (p.refHigh != null) hi = Math.max(hi, p.refHigh);
  }
  // 5 graduations plutôt que 4 : avec 4, une CRP à 68 donnait un axe à 100,
  // soit un tiers de panneau vide. Dans une figure de compte-rendu qui doit
  // tenir en quart de page, c'est de la place perdue.
  return niceScale(lo, hi, 5);
}

function valueScaleMulti(study: StudyState, params: Parameter[]) {
  const vals: number[] = [];
  for (const p of params) {
    for (const m of study.measurements.filter(m => m.parameterId === p.id)) {
      const v = plottedValue(p, m.value);
      if (v != null) vals.push(v);
    }
  }
  if (!vals.length) return niceScale(0, 1, 5);
  return niceScale(Math.min(...vals), Math.max(...vals), 5);
}

function panel(
  p: Parameter, pi: number,
  pts: SeriesPoint[],
  sc: ReturnType<typeof niceScale>,
  yOf: (v: number) => number,
  y0: number, y1: number,
  layout: Layout, xm: ReturnType<typeof buildXMapper>,
  s: StudyState['settings'],
  hotspots: RenderResult['hotspots'],
  _isSingle: boolean,
): string {
  const { marginLeft, plotWidth } = layout;
  let out = '';

  // Bande de normale — bornée au panneau.
  //
  // Sans ce bornage, une normale située hors de l'échelle (CRP « < 5 » sur un
  // panneau gradué de 60 à 160 parce que le patient n'est jamais redescendu)
  // faisait peindre la bande SOUS l'axe, c'est-à-dire par-dessus le panneau
  // voisin : on lisait « créatinine normale entre 155 et 250 ». Une figure de
  // compte-rendu ne peut pas se permettre ça.
  if (s.showReference && !(p.category === 'efr' && p.display === 'percent') && (p.refLow != null || p.refHigh != null)) {
    const bordHaut = yOf(p.refHigh != null ? p.refHigh : sc.max);
    const bordBas = yOf(p.refLow != null ? p.refLow : sc.min);
    const haut = clamp(Math.min(bordHaut, bordBas), y0, y1);
    const bas = clamp(Math.max(bordHaut, bordBas), y0, y1);
    // Bande entièrement hors du panneau : rien à dessiner (mieux vaut pas de
    // repère qu'un repère faux).
    if (bas - haut >= 0.5) {
      out += `<rect x="${marginLeft}" y="${haut}" width="${plotWidth}" height="${bas - haut}" fill="${REF_FILL}"/>`;
    }
  }

  // Grille horizontale + ticks Y
  sc.ticks.forEach(t => {
    const yy = yOf(t);
    if (yy < y0 - 0.5 || yy > y1 + 0.5) return;
    out += `<line x1="${marginLeft}" y1="${yy}" x2="${marginLeft + plotWidth}" y2="${yy}" stroke="${GRID}" stroke-width="1"/>`;
    out += `<text x="${marginLeft - 8}" y="${yy + 3.5}" text-anchor="end" font-family="${FONT}" font-size="10" fill="${MUTED}">${fmtTick(t, sc.step)}</text>`;
  });

  // Axe Y
  out += `<line x1="${marginLeft}" y1="${y0}" x2="${marginLeft}" y2="${y1}" stroke="${AXIS}" stroke-width="1.2"/>`;
  out += `<line x1="${marginLeft}" y1="${y1}" x2="${marginLeft + plotWidth}" y2="${y1}" stroke="${AXIS}" stroke-width="1.2"/>`;

  // Étiquette du panneau (nom + unité) au dessus à gauche
  const ul = unitLabel(p);
  const title = ul ? `${p.name} (${ul})` : p.name;
  out += `<text x="${marginLeft}" y="${y0 - 4}" font-family="${FONT}" font-size="11.5" font-weight="600" fill="${INK}">${esc(title)}</text>`;

  out += series(p, pi, pts, yOf, s, hotspots, y0, y1);
  return out;
}

/**
 * Rayon des marqueurs, réduit quand les points se serrent.
 *
 * À quarante prélèvements sur la largeur d'une page, des marqueurs de 4 px
 * cerclés à 7 px se touchaient : la série devenait un ruban continu où l'on ne
 * distinguait plus un point d'un autre. Le marqueur rétrécit donc avec
 * l'espacement réel, sans jamais descendre sous 2,2 px (en deçà il disparaît à
 * l'impression).
 */
function rayonMarqueur(pts: SeriesPoint[]): number {
  if (pts.length < 2) return 4;
  const ecarts: number[] = [];
  for (let i = 1; i < pts.length; i++) ecarts.push(Math.abs(pts[i].x - pts[i - 1].x));
  ecarts.sort((a, b) => a - b);
  const median = ecarts[Math.floor(ecarts.length / 2)];
  if (median >= 26) return 4;
  return clamp(median / 6.5, 2.2, 4);
}

function series(
  p: Parameter, idx: number,
  pts: SeriesPoint[],
  yOf: (v: number) => number,
  s: StudyState['settings'],
  hotspots: RenderResult['hotspots'],
  topY = -Infinity,
  botY = Infinity,
): string {
  if (!pts.length) return '';
  const color = p.color || '#2a78d6';
  const shape = MARKER_SHAPES[idx % MARKER_SHAPES.length];
  const rayon = rayonMarqueur(pts);
  const rAnneau = rayon + 3;
  let out = '';
  // Ligne
  const d = pts.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt.x.toFixed(1)},${yOf(pt.value).toFixed(1)}`).join(' ');
  out += `<path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  // Marqueurs + indicateurs
  pts.forEach((pt, i) => {
    const cy = yOf(pt.value);
    // Anneau hors-norme
    if (s.markOutOfRange && pt.outOfRange) {
      out += `<circle cx="${pt.x}" cy="${cy}" r="${rAnneau}" fill="none" stroke="#c0392b" stroke-width="1.4"/>`;
    }
    out += marker(shape, pt.x, cy, rayon, color);
    // Flèche de seuil (< : vraie valeur en dessous ; > : au dessus)
    //
    // Elle ne doit JAMAIS sortir du panneau : elle empiétait sur le panneau
    // voisin et sur son titre, parce qu'une longueur plancher de 6 px était
    // imposée avant même de regarder la place disponible. Son SENS porte
    // l'information : on la raccourcit, on ne la retourne pas, et si la place
    // manque vraiment on l'omet plutôt que de déborder — le qualificatif reste
    // lisible dans l'étiquette de valeur et dans l'infobulle.
    let fleche = 0; // encombrement effectif de la flèche (0 = pas de flèche)
    if (pt.q === '<' || pt.q === '>') {
      const dir = pt.q === '<' ? 1 : -1;
      const limite = dir === 1 ? botY - 1 : topY + 1;
      const place = Math.max(0, Math.abs(limite - cy));
      const total = Math.min(16, place);
      if (total >= 5) {
        const pointe = Math.min(5, total - 1);
        const yb = cy + dir * (total - pointe); // base du triangle
        const yPointe = cy + dir * total;
        const ya = cy + dir * (rayon + 1);
        if ((yb - ya) * dir > 1) {
          out += `<line x1="${pt.x}" y1="${ya}" x2="${pt.x}" y2="${yb}" stroke="${color}" stroke-width="1.5"/>`;
        }
        out += `<polygon points="${pt.x},${yPointe} ${pt.x - 3},${yb} ${pt.x + 3},${yb}" fill="${color}"/>`;
        fleche = total * dir;
      }
    }
    // Un point au seuil de détection est toujours légendé, même quand les
    // valeurs sont masquées : quand la flèche ne tient pas (valeur au ras du
    // plancher de l'échelle, cas normal d'un anticorps devenu indétectable),
    // c'est le seul endroit où « < » subsiste. Sans cela « <3 » se lit « 3 »,
    // ce qui est faux. Ils sont rares : deux ou trois par série au plus.
    if (s.showValues || (pt.q && fleche === 0)) {
      const lbl = (pt.q ?? '') + fmtNum(pt.value);
      // On place l'étiquette du côté où la courbe ne passe pas : sur une pente
      // forte, l'écrire au-dessus la fait traverser par le trait.
      const voisinHaut = (i > 0 && yOf(pts[i - 1].value) < cy - 2) || (i < pts.length - 1 && yOf(pts[i + 1].value) < cy - 2);
      let placeDessous = (cy - 10 < topY + 6) || (voisinHaut && cy + 16 < botY);
      // Une flèche de seuil occupe déjà un côté du point : « >200 » écrit
      // par-dessus sa propre flèche était illisible. On passe de l'autre côté
      // dès que la place le permet.
      if (fleche > 0 && cy - 8 > topY + 4) placeDessous = false;
      else if (fleche < 0 && cy + 16 < botY) placeDessous = true;
      const decale = Math.abs(fleche) + 4;
      let ly = placeDessous ? cy + 15 : cy - 8;
      if (fleche > 0 && placeDessous) ly = Math.min(cy + decale + 10, botY - 2);
      if (fleche < 0 && !placeDessous) ly = Math.max(cy - decale - 4, topY + 9);
      out += `<text x="${pt.x}" y="${ly}" text-anchor="middle" font-family="${FONT}" font-size="9.5" fill="${INK}">${lbl}</text>`;
    }
    hotspots.push({ param: p, date: pt.date, value: pt.value, cx: pt.x, cy });
  });
  return out;
}

function xAxis(xm: ReturnType<typeof buildXMapper>, y: number, layout: Layout): string {
  const { marginLeft, plotWidth } = layout;
  let out = `<line x1="${marginLeft}" y1="${y}" x2="${marginLeft + plotWidth}" y2="${y}" stroke="${AXIS}" stroke-width="1.2"/>`;
  xm.ticks.forEach(t => {
    out += `<line x1="${t.x}" y1="${y}" x2="${t.x}" y2="${y + 4}" stroke="${AXIS}" stroke-width="1"/>`;
    out += `<text x="${t.x}" y="${y + 16}" text-anchor="middle" font-family="${FONT}" font-size="10" fill="${MUTED}">${esc(t.label)}</text>`;
  });
  return out;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
