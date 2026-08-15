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

/**
 * Motif de trait, en secours de la couleur et de la forme.
 *
 * La palette compte huit teintes et les marqueurs six formes : à partir de la
 * septième série d'un même graphe, deux courbes peuvent devenir jumelles — sur
 * douze paramètres, la créatinine et la ferritine sortaient du même rouge, et
 * se croisaient. Le motif de trait change tous les six rangs : forme et motif
 * combinés donnent dix-huit signatures distinctes.
 *
 * C'est aussi ce qui sauve la figure imprimée en noir et blanc, cas courant à
 * l'hôpital : les teintes y deviennent des gris voisins, la forme et le motif
 * restent.
 */
const TRAITS = ['', '7 4', '2 3', '9 3 2 3'] as const;
function motifTrait(idx: number, plusieursSeries: boolean): string {
  if (!plusieursSeries) return '';
  return TRAITS[Math.floor(idx / MARKER_SHAPES.length) % TRAITS.length];
}

export interface PlotPoint { date: string; x: number; y: number; value: number; }

export interface RenderResult {
  svg: string;
  width: number;
  height: number;
  /** Zones interactives des points (coord SVG) pour le survol. */
  hotspots: { param: Parameter; date: string; value: number; cx: number; cy: number }[];
  /**
   * Séries que le graphe unique écrase au ras de leur axe : deux échelles ne
   * peuvent pas loger des ordres de grandeur trop éloignés. La figure reste
   * juste, mais ces courbes n'y sont pas lisibles — autant le dire au médecin
   * plutôt que de le laisser croire à des paramètres restés plats.
   */
  ecrasees: string[];
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Largeur approchée d'un texte, en pixels.
 *
 * Le rendu est une fonction pure sans DOM : impossible de mesurer réellement.
 * Les largeurs étaient jusqu'ici estimées par « nombre de caractères × 6,1 »,
 * ce qui sous-estime lourdement les noms pleins de lettres larges — d'où la
 * légende où « Anticorps anti-membrane basale glomérulaire » recouvrait
 * « Rapport protéinurie/créatininurie ». On pondère donc par classe de
 * caractère : c'est grossier, mais l'erreur reste sous les 5 % sur les libellés
 * médicaux réels, largement dans la marge de sécurité qu'on s'accorde.
 */
const LARGEURS: Record<string, number> = {
  i: 0.24, j: 0.24, l: 0.24, I: 0.28, '.': 0.28, ',': 0.28, ':': 0.28, ';': 0.28,
  "'": 0.20, '’': 0.20, '(': 0.33, ')': 0.33, '/': 0.28, ' ': 0.28, '·': 0.33,
  f: 0.30, t: 0.33, r: 0.36, '-': 0.33, '–': 0.56, '—': 0.83,
  m: 0.83, w: 0.72, M: 0.83, W: 0.94, '%': 0.89,
};
export function largeurTexte(texte: string, taille: number, gras = false): number {
  let u = 0;
  for (const c of texte) {
    if (LARGEURS[c] !== undefined) u += LARGEURS[c];
    else if (c >= '0' && c <= '9') u += 0.56;
    else if (c >= 'A' && c <= 'Z') u += 0.68;
    else u += 0.55; // minuscules courantes et lettres accentuées
  }
  return u * taille * (gras ? 1.06 : 1);
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

/**
 * Coordonnée écrite dans le SVG, arrondie au dixième de pixel.
 *
 * Les positions sortaient telles que calculées : « cx="96.74074074073943" ».
 * Sur un suivi de douze paramètres et quatre-vingts prélèvements, ces décimales
 * sans objet — l'écran ne descend pas sous le pixel, l'imprimante non plus —
 * représentaient un quart des 211 Ko du fichier. Autant de texte à analyser et
 * à réinsérer dans la page à chaque frappe, et autant de poids dans le SVG
 * exporté.
 */
function n(v: number): string {
  return String(Math.round(v * 10) / 10);
}

function marker(shape: MarkerShape, cx: number, cy: number, r: number, color: string): string {
  switch (shape) {
    case 'circle':
      return `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="${color}" stroke="#fff" stroke-width="1"/>`;
    case 'circle-open':
      return `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="#fff" stroke="${color}" stroke-width="2"/>`;
    case 'square':
      return `<rect x="${n(cx - r)}" y="${n(cy - r)}" width="${n(2 * r)}" height="${n(2 * r)}" fill="${color}" stroke="#fff" stroke-width="1"/>`;
    case 'square-open':
      return `<rect x="${n(cx - r)}" y="${n(cy - r)}" width="${n(2 * r)}" height="${n(2 * r)}" fill="#fff" stroke="${color}" stroke-width="2"/>`;
    case 'triangle': {
      const p = `${n(cx)},${n(cy - r * 1.2)} ${n(cx - r * 1.1)},${n(cy + r)} ${n(cx + r * 1.1)},${n(cy + r)}`;
      return `<polygon points="${p}" fill="${color}" stroke="#fff" stroke-width="1"/>`;
    }
    case 'diamond': {
      const p = `${n(cx)},${n(cy - r * 1.3)} ${n(cx + r * 1.3)},${n(cy)} ${n(cx)},${n(cy + r * 1.3)} ${n(cx - r * 1.3)},${n(cy)}`;
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
type IndexMesures = Map<string, StudyState['measurements']>;
function indexerMesures(study: StudyState): IndexMesures {
  const idx: IndexMesures = new Map();
  for (const m of study.measurements) {
    const l = idx.get(m.parameterId);
    if (l) l.push(m); else idx.set(m.parameterId, [m]);
  }
  for (const l of idx.values()) l.sort((a, b) => a.date.localeCompare(b.date));
  return idx;
}

export function renderChart(study: StudyState, width = 920): RenderResult {
  study = applyPeriod(study);
  const s = study.settings;
  const mesures = indexerMesures(study);
  const mesuresDe = (p: Parameter) => mesures.get(p.id) ?? [];
  const params = [...study.parameters].sort((a, b) => a.order - b.order)
    .filter(p => mesures.has(p.id));
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
  const ecrasees: string[] = [];
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
      const pts = collectPoints(mesuresDe(p), p, xm.xOf);
      const sc = valueScale(mesuresDe(p), p, s);
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
    const { gauche: leftParams, droite: rightParams } = repartirAxes(mesuresDe, params);

    /*
     * Un axe ne peut pas porter honnêtement dix unités : « mg/L · g/dL · G/L ·
     * UI/mL · L · mmol/min/kPa · µg/L · U/L · mUI/L » était une phrase tournée
     * à 90° plus haute que le graphique, et surtout fausse à la lecture. On ne
     * titre l'axe que lorsqu'il ne porte qu'une seule unité ; sinon l'unité est
     * portée par chaque entrée de légende, où elle est rattachée à sa série.
     */
    const libelleAxe = (liste: Parameter[]) => {
      const u = [...new Set(liste.map(unitLabel).filter(Boolean))];
      return u.length === 1 ? u[0] : '';
    };
    const titreGauche = libelleAxe(leftParams);
    const titreDroite = libelleAxe(rightParams);

    const scL = valueScaleMulti(mesuresDe, leftParams);
    const scR = rightParams.length ? valueScaleMulti(mesuresDe, rightParams) : null;
    const yOfL = (v: number) => y1 - ((v - scL.min) / (scL.max - scL.min)) * (y1 - y0);
    const yOfR = scR ? (v: number) => y1 - ((v - scR.min) / (scR.max - scR.min)) * (y1 - y0) : yOfL;

    // Grille + axe gauche
    panelsSVG += `<line x1="${marginLeft}" y1="${n(y0)}" x2="${marginLeft}" y2="${n(y1)}" stroke="${AXIS}" stroke-width="1.2"/>`;
    scL.ticks.forEach(t => {
      const yy = yOfL(t);
      panelsSVG += `<line x1="${marginLeft}" y1="${n(yy)}" x2="${marginLeft + plotWidth}" y2="${n(yy)}" stroke="${GRID}" stroke-width="1"/>`;
      panelsSVG += `<text x="${marginLeft - 8}" y="${n(yy + 3.5)}" text-anchor="end" font-family="${FONT}" font-size="10.5" fill="${MUTED}">${fmtTick(t, scL.step)}</text>`;
    });
    if (titreGauche) {
      panelsSVG += `<text transform="translate(16,${n((y0 + y1) / 2)}) rotate(-90)" text-anchor="middle" font-family="${FONT}" font-size="11" fill="${INK}">${esc(titreGauche)}</text>`;
    }

    if (scR) {
      panelsSVG += `<line x1="${marginLeft + plotWidth}" y1="${n(y0)}" x2="${marginLeft + plotWidth}" y2="${n(y1)}" stroke="${AXIS}" stroke-width="1.2"/>`;
      scR.ticks.forEach(t => {
        const yy = yOfR(t);
        panelsSVG += `<text x="${marginLeft + plotWidth + 8}" y="${n(yy + 3.5)}" text-anchor="start" font-family="${FONT}" font-size="10.5" fill="${MUTED}">${fmtTick(t, scR.step)}</text>`;
      });
      if (titreDroite) {
        panelsSVG += `<text transform="translate(${width - 14},${n((y0 + y1) / 2)}) rotate(90)" text-anchor="middle" font-family="${FONT}" font-size="11" fill="${INK}">${esc(titreDroite)}</text>`;
      }
    }

    // Une série dont toute l'amplitude tient dans 4 % de la hauteur du graphe
    // est un trait plat : elle est tracée, mais on ne peut rien y lire.
    for (const p of params) {
      const sc = rightParams.includes(p) ? scR! : scL;
      const vs = mesuresDe(p).map(m => m.value).filter(v => isFinite(v));
      if (!vs.length) continue;
      const etendue = sc.max - sc.min;
      if (etendue > 0 && (Math.max(...vs) - Math.min(...vs)) / etendue < 0.04) ecrasees.push(p.name);
    }

    for (const p of rightParams) axeDroite.add(p.id);
    params.forEach((p, i) => {
      const onRight = rightParams.includes(p);
      const yOf = onRight ? yOfR : yOfL;
      const pts = collectPoints(mesuresDe(p), p, xm.xOf);
      panelsSVG += series(p, i, pts, yOf, s, hotspots, y0, y1, motifTrait(i, params.length > MARKER_SHAPES.length));
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
      parts.push(`<line x1="${n(x)}" y1="${availTop}" x2="${n(x)}" y2="${n(plotAreaBottom)}" stroke="#2a6fb0" stroke-width="1" opacity="0.55"/>`);
      parts.push(`<polygon points="${n(x)},${availTop} ${n(x - 3.5)},${availTop - 6} ${n(x + 3.5)},${availTop - 6}" fill="#2a6fb0"/>`);
      if (x - lastAx >= 30) {
        parts.push(`<text x="${n(x)}" y="${n(annLabelY)}" text-anchor="middle" font-family="${FONT}" font-size="9.5" font-style="italic" fill="#2a6fb0">${esc(a.text)}</text>`);
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
          parts.push(`<text x="${n(px)}" y="${n(yOfDose(p.dose) - 2.5)}" text-anchor="middle" font-family="${FONT}" font-size="9.5" font-weight="600" fill="${MUTED}">${fmtNum(p.dose)}</text>`);
          lastLx = px;
        }
      } else {
        // ── Dose constante : barre pleine ──
        const h = Math.min(24, trRowH - 6);
        parts.push(`<rect x="${n(x1)}" y="${n(bandY + (trRowH - h) / 2)}" width="${n(w)}" height="${n(h)}" rx="4" fill="${color}"/>`);
      }
      // Traitement toujours en cours : chevron « se poursuit » en bout de barre.
      // Sans lui, un traitement débuté à la dernière date connue se lit comme un
      // événement ponctuel alors qu'il n'est pas terminé.
      if (!t.end) {
        const cx = Math.min(x1 + w + 4, marginLeft + plotWidth - 7);
        parts.push(`<polygon points="${n(cx)},${n(yy - 6)} ${n(cx + 6)},${n(yy)} ${n(cx)},${n(yy + 6)}" fill="${color}" opacity="0.75"/>`);
      }

      const label = t.name;
      const estW = label.length * 6.1;
      const rightEdge = marginLeft + plotWidth;
      if (taper) {
        // Décroissance : nom en bas à gauche du coin (les doses sont en haut)
        if (x2 + 6 + estW <= rightEdge) {
          parts.push(`<text x="${n(x2 + 6)}" y="${n(yy + 3.5)}" font-family="${FONT}" font-size="13.5" font-weight="600" fill="${INK}">${esc(label)}</text>`);
        } else {
          parts.push(`<text x="${n(x1 + 5)}" y="${n(rowBot - 3)}" font-family="${FONT}" font-size="10.5" font-weight="600" fill="#ffffff">${esc(label)}</text>`);
        }
      } else if (x2 + 6 + estW <= rightEdge) {
        // À droite de la barre
        parts.push(`<text x="${n(x2 + 6)}" y="${n(yy + 3.5)}" font-family="${FONT}" font-size="13.5" font-weight="600" fill="${INK}">${esc(label)}</text>`);
      } else if (w > estW + 12) {
        // À l'intérieur de la barre (texte blanc)
        parts.push(`<text x="${n(x1 + 6)}" y="${n(yy + 3.5)}" font-family="${FONT}" font-size="13.5" font-weight="700" fill="#ffffff">${esc(label)}</text>`);
      } else {
        // À gauche de la barre
        parts.push(`<text x="${n(x1 - 6)}" y="${n(yy + 3.5)}" text-anchor="end" font-family="${FONT}" font-size="13.5" font-weight="600" fill="${INK}">${esc(label)}</text>`);
      }
      bandY += trRowH;
    });
    bandY += 6;
  }

  // ── Événements ponctuels : grosses flèches colorées, libellé DESSOUS ──
  //
  // Trois défauts vus sur captures, tous porteurs de contresens :
  //  · une cure répétée (quatre perfusions de rituximab) sortait avec une
  //    flèche sur deux étiquetée — la muette du milieu se lisait comme un
  //    autre produit. Les administrations rapprochées d'un même produit sont
  //    donc regroupées sous une seule étiquette qui en donne le nombre ;
  //  · ces flèches prenaient chacune la couleur de leur ligne de traitement :
  //    trois couleurs pour un seul médicament. La couleur suit maintenant le
  //    nom du produit ;
  //  · le libellé du premier événement, centré sur une flèche collée au bord,
  //    débordait du cadre à gauche. Il est désormais retenu dans le cadre.
  if (eventTr.length) {
    const tipY = bandY + 2;         // pointe de la flèche (vers la courbe)
    const baseY = tipY + 26;        // base de la flèche
    const labelY0 = baseY + 16;     // libellé sous la flèche
    const gauche = marginLeft, droite = marginLeft + plotWidth;

    // Couleur de référence par nom de produit (celle de sa première ligne).
    const couleurProduit = new Map<string, string>();
    for (const t of eventTr) if (!couleurProduit.has(t.name)) couleurProduit.set(t.name, t.color || '#5b6472');

    // Regroupement des administrations consécutives d'un même produit.
    type Groupe = { nom: string; dose?: string; xs: number[]; couleur: string };
    const groupes: Groupe[] = [];
    for (const t of eventTr) {
      const x = clamp(xm.xOf(t.start), gauche, droite);
      const dernier = groupes[groupes.length - 1];
      if (dernier && dernier.nom === t.name && x - dernier.xs[dernier.xs.length - 1] < 170) {
        dernier.xs.push(x);
        if (!dernier.dose && t.dose) dernier.dose = t.dose;
      } else {
        groupes.push({ nom: t.name, dose: t.dose, xs: [x], couleur: couleurProduit.get(t.name)! });
      }
      parts.push(`<line x1="${n(x)}" y1="${n(baseY)}" x2="${n(x)}" y2="${n(tipY + 13)}" stroke="${couleurProduit.get(t.name)}" stroke-width="4"/>`);
      parts.push(`<polygon points="${n(x)},${n(tipY)} ${n(x - 10)},${n(tipY + 15)} ${n(x + 10)},${n(tipY + 15)}" fill="${couleurProduit.get(t.name)}"/>`);
    }

    // Étiquettes : une par groupe, centrée sur lui, retenue dans le cadre, et
    // renvoyée au rang du dessous si elle empiète sur la précédente.
    let finRang0 = -Infinity, finRang1 = -Infinity;
    for (const g of groupes) {
      const nb = g.xs.length;
      const label = (g.dose ? `${g.nom} (${g.dose})` : g.nom) + (nb > 1 ? ` ×${nb}` : '');
      const w = largeurTexte(label, 12.5, true);
      const centre = (g.xs[0] + g.xs[nb - 1]) / 2;
      const x = clamp(centre, gauche + w / 2, Math.max(gauche + w / 2, droite - w / 2));
      const rang = x - w / 2 >= finRang0 + 14 ? 0 : (x - w / 2 >= finRang1 + 14 ? 1 : 0);
      if (rang === 0) finRang0 = x + w / 2; else finRang1 = x + w / 2;
      parts.push(`<text x="${n(x)}" y="${n(labelY0 + rang * 16)}" text-anchor="middle" font-family="${FONT}" font-size="12.5" font-weight="700" fill="${INK}">${esc(label)}</text>`);
    }
    bandY += finRang1 > -Infinity ? 74 : 58; // 2e rang de libellés seulement s'il sert
  }

  // Fond léger derrière toute la bande des traitements (meilleure visibilité)
  if (hasBand) {
    const bg = `<rect x="${marginLeft - 8}" y="${n(bandStartY - 5)}" width="${plotWidth + 16}" height="${n(bandY - bandStartY + 4)}" rx="7" fill="#f3f6fa" stroke="#dfe6ee" stroke-width="1"/>`;
    parts.splice(bandBgIndex, 0, bg);
  }

  // ── Légende ──
  //
  // Les entrées étaient posées sur une grille fixe de 160 px : deux libellés
  // médicaux un peu longs (« Anticorps anti-membrane basale glomérulaire » et
  // « Rapport protéinurie/créatininurie ») s'écrivaient l'un par-dessus l'autre.
  // Chaque entrée occupe donc maintenant la largeur qu'elle demande vraiment,
  // et on passe à la ligne quand la suivante ne tient plus.
  let legendBottom = bandY;
  if (s.showLegend && params.length) {
    // Avec deux axes, savoir lequel porte quelle série est indispensable :
    // sans repère, on lit une créatinine sur l'axe des plaquettes.
    const deuxAxes = axeDroite.size > 0;
    const entrees = params.map((p, i) => {
      const repere = deuxAxes ? (axeDroite.has(p.id) ? ' →' : ' ←') : '';
      // En graphe unique les séries partagent un axe : l'unité doit voyager
      // avec le nom, sinon rien ne dit dans quelle unité se lit la courbe.
      const ul = s.chartMode === 'single' ? unitLabel(p) : '';
      const texte = (ul ? `${p.name} (${ul})` : p.name) + repere;
      return { p, i, texte, w: 18 + largeurTexte(texte, 11) + 22 };
    });
    // Un traitement occupe le bas de la figure sur un fond gris : la légende
    // s'y collait. On lui laisse de l'air.
    let ly = bandY + (hasBand ? 15 : 8);
    let lx = marginLeft;
    for (const e of entrees) {
      if (lx > marginLeft && lx + e.w - 22 > marginLeft + plotWidth) { lx = marginLeft; ly += 20; }
      const color = e.p.color || '#2a78d6';
      const shape = MARKER_SHAPES[e.i % MARKER_SHAPES.length];
      const dash = s.chartMode === 'single' ? motifTrait(e.i, params.length > MARKER_SHAPES.length) : '';
      const trait = dash ? ` stroke-dasharray="${dash}"` : '';
      parts.push(`<line x1="${n(lx - 3)}" y1="${n(ly)}" x2="${n(lx + 13)}" y2="${n(ly)}" stroke="${color}" stroke-width="2"${trait}/>`);
      parts.push(marker(shape, lx + 5, ly, 4, color));
      parts.push(`<text x="${n(lx + 18)}" y="${n(ly + 3.5)}" font-family="${FONT}" font-size="11" fill="${INK}">${esc(e.texte)}</text>`);
      lx += e.w;
    }
    legendBottom = ly + 18;
  }

  const height = Math.ceil(legendBottom + 8);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="${FONT}">`
    + `<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`
    + parts.join('')
    + `</svg>`;

  return { svg, width, height, hotspots, ecrasees };
}

// ── Helpers de tracé ──────────────────────────────────────────

type SeriesPoint = { date: string; x: number; value: number; q: '<' | '>' | null; outOfRange: boolean };

function collectPoints(mesures: StudyState['measurements'], p: Parameter, xOf: (d: string) => number): SeriesPoint[] {
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

function valueScale(mesures: StudyState['measurements'], p: Parameter, reglages: StudyState['settings']) {
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
function repartirAxes(mesuresDe: (p: Parameter) => StudyState['measurements'], params: Parameter[]): { gauche: Parameter[]; droite: Parameter[] } {
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

function valueScaleMulti(mesuresDe: (p: Parameter) => StudyState['measurements'], params: Parameter[]) {
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
      out += `<rect x="${marginLeft}" y="${n(haut)}" width="${plotWidth}" height="${n(bas - haut)}" fill="${REF_FILL}"/>`;
    }
  }

  // Grille horizontale + ticks Y
  sc.ticks.forEach(t => {
    const yy = yOf(t);
    if (yy < y0 - 0.5 || yy > y1 + 0.5) return;
    out += `<line x1="${marginLeft}" y1="${n(yy)}" x2="${marginLeft + plotWidth}" y2="${n(yy)}" stroke="${GRID}" stroke-width="1"/>`;
    out += `<text x="${marginLeft - 8}" y="${n(yy + 3.5)}" text-anchor="end" font-family="${FONT}" font-size="10" fill="${MUTED}">${fmtTick(t, sc.step)}</text>`;
  });

  // Axe Y
  out += `<line x1="${marginLeft}" y1="${n(y0)}" x2="${marginLeft}" y2="${n(y1)}" stroke="${AXIS}" stroke-width="1.2"/>`;
  out += `<line x1="${marginLeft}" y1="${n(y1)}" x2="${marginLeft + plotWidth}" y2="${n(y1)}" stroke="${AXIS}" stroke-width="1.2"/>`;

  // Étiquette du panneau (nom + unité) au dessus à gauche
  const ul = unitLabel(p);
  const title = ul ? `${p.name} (${ul})` : p.name;
  out += `<text x="${marginLeft}" y="${n(y0 - 4)}" font-family="${FONT}" font-size="11.5" font-weight="600" fill="${INK}">${esc(title)}</text>`;

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
  dash = '',
): string {
  if (!pts.length) return '';
  const color = p.color || '#2a78d6';
  const shape = MARKER_SHAPES[idx % MARKER_SHAPES.length];
  const rayon = rayonMarqueur(pts);
  const rAnneau = rayon + 3;
  let out = '';
  // Ligne
  const d = pts.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt.x.toFixed(1)},${yOf(pt.value).toFixed(1)}`).join(' ');
  const trait = dash ? ` stroke-dasharray="${dash}"` : '';
  out += `<path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"${trait}/>`;
  // Marqueurs + indicateurs
  pts.forEach((pt, i) => {
    const cy = yOf(pt.value);
    // Anneau hors-norme
    if (s.markOutOfRange && pt.outOfRange) {
      out += `<circle cx="${n(pt.x)}" cy="${n(cy)}" r="${n(rAnneau)}" fill="none" stroke="#c0392b" stroke-width="1.4"/>`;
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
          out += `<line x1="${n(pt.x)}" y1="${n(ya)}" x2="${n(pt.x)}" y2="${n(yb)}" stroke="${color}" stroke-width="1.5"/>`;
        }
        out += `<polygon points="${n(pt.x)},${n(yPointe)} ${n(pt.x - 3)},${n(yb)} ${n(pt.x + 3)},${n(yb)}" fill="${color}"/>`;
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
      out += `<text x="${n(pt.x)}" y="${n(ly)}" text-anchor="middle" font-family="${FONT}" font-size="9.5" fill="${INK}">${lbl}</text>`;
    }
    hotspots.push({ param: p, date: pt.date, value: pt.value, cx: pt.x, cy });
  });
  return out;
}

function xAxis(xm: ReturnType<typeof buildXMapper>, y: number, layout: Layout): string {
  const { marginLeft, plotWidth } = layout;
  let out = `<line x1="${marginLeft}" y1="${n(y)}" x2="${marginLeft + plotWidth}" y2="${n(y)}" stroke="${AXIS}" stroke-width="1.2"/>`;
  xm.ticks.forEach(t => {
    out += `<line x1="${n(t.x)}" y1="${n(y)}" x2="${n(t.x)}" y2="${n(y + 4)}" stroke="${AXIS}" stroke-width="1"/>`;
    out += `<text x="${n(t.x)}" y="${n(y + 16)}" text-anchor="middle" font-family="${FONT}" font-size="10" fill="${MUTED}">${esc(t.label)}</text>`;
  });
  return out;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
