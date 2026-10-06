import type { StudyState, Parameter } from '../models/types';
import { formatDate } from '../models/types';
import { fmtNum, fmtTick } from './scale';
import { versionImpression } from './impression';
import { FONT, INK, AXIS, GRID, MUTED, MARKER_SHAPES, motifTrait, esc, largeurTexte, couperLignes, n, marker, clamp } from './svg';
import { type Layout, buildXMapper, xAxis } from './axeTemps';
import { type RenderResult, unitLabel, libelleAxe, grouperPourPanneaux, applyPeriod, indexerMesures, collectPoints, valueScale, repartirAxes, valueScaleMulti } from './donnees';
import { panel, groupPanel, series } from './panneaux';
export type { PlotPoint, RenderResult } from './donnees';
export { largeurTexte, couperLignes } from './svg';
export { coupuresDeTemps } from './axeTemps';

// ──────────────────────────────────────────────────────────────
// Rendu SVG type publication scientifique (NEJM)
// Fonction pure : StudyState → chaîne SVG. Aucune dépendance DOM.
// ──────────────────────────────────────────────────────────────

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

  /*
   * Marge gauche ajustée à la largeur réelle des graduations.
   *
   * Elle valait 66 px quoi qu'il arrive. Les analyses rendues en unités
   * « brutes » — charge virale en copies/mL, plaquettes ou leucocytes par mm³ —
   * graduent l'axe à sept chiffres : « 1 500 000 » demande une soixantaine de
   * pixels et sortait du cadre par la gauche, tronqué. Les échelles Y ne
   * dépendant pas de la largeur du tracé, on peut les calculer d'abord et
   * dimensionner la marge en conséquence.
   */
  const echelles = new Map(params.map(p => [p.id, valueScale(mesuresDe(p), p, s)]));
  const largeurGraduations = () => {
    let max = 0;
    for (const sc of echelles.values()) {
      for (const t of sc.ticks) max = Math.max(max, largeurTexte(fmtTick(t, sc.step), 10.5));
    }
    return max;
  };
  // Groupes de panneaux (mode « Panneaux ») : calculés ici, avant la mise en
  // page, parce qu'un groupe à deux axes a besoin d'une marge de droite —
  // comme le mode « Graphe unique » en a déjà besoin pour son propre axe
  // droit. Sans groupe (cas par défaut), chaque groupe ne contient qu'un
  // paramètre : aucun n'a besoin d'un second axe, la marge ne change pas.
  const groupesPanneaux = grouperPourPanneaux(params);
  const needsGroupRightAxis = s.chartMode === 'stacked' &&
    groupesPanneaux.some(g => g.params.length > 1 && repartirAxes(mesuresDe, g.params).droite.length > 0);
  const marginLeft = Math.round(clamp(largeurGraduations() + 16, 66, Math.max(66, width * 0.22)));
  const marginRight = (s.chartMode === 'single' || needsGroupRightAxis) ? marginLeft : 24;
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
  // Titre et sous-titre passent à la ligne plutôt que d'être coupés par le
  // bord du graphique (écran de téléphone, titre long de compte-rendu).
  const largeurEnTete = width - marginLeft - 12;
  if (s.title) {
    for (const ligne of couperLignes(s.title, 17, largeurEnTete, true)) {
      parts.push(`<text x="${marginLeft}" y="${cursorY + 18}" font-family="${FONT}" font-size="17" font-weight="700" fill="${INK}">${esc(ligne)}</text>`);
      cursorY += 23;
    }
    cursorY += 3;
  }
  if (s.subtitle) {
    for (const ligne of couperLignes(s.subtitle, 12, largeurEnTete)) {
      parts.push(`<text x="${marginLeft}" y="${cursorY + 12}" font-family="${FONT}" font-size="12" fill="${MUTED}">${esc(ligne)}</text>`);
      cursorY += 16;
    }
    cursorY += 2;
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
  let isEmpty = false;

  if (s.chartMode === 'stacked' && params.length) {
    // ── Mode panneaux empilés ──
    //
    // Un panneau par GROUPE, pas par paramètre : par défaut chaque paramètre
    // est seul dans son groupe (voir `grouperPourPanneaux`), et cette boucle
    // se comporte exactement comme avant — un panneau par paramètre, dans le
    // même ordre. Un groupe à plusieurs membres (choisi par le médecin) est
    // rendu par `groupPanel`, qui répartit ses séries sur un ou deux axes
    // avec la même règle que le mode « Graphe unique ».
    const gap = 26;
    /*
     * Hauteur PAR panneau, pas hauteur totale répartie : à six paramètres, une
     * enveloppe fixe de 520 px donnait des bandes de 65 px où toutes les courbes
     * paraissaient plates. Une figure de compte-rendu doit rester lisible quel
     * que soit le nombre de séries — elle grandit, elle ne s'écrase pas.
     *
     * Le calcul porte sur le nombre de PANNEAUX affichés (groupes), pas le
     * nombre de paramètres : deux paramètres réunis dans un même panneau ne
     * doivent pas le faire rétrécir comme s'il y en avait deux à afficher.
     */
    const nbPanneaux = groupesPanneaux.length;
    const hauteurConfort = nbPanneaux <= 2 ? 240 : nbPanneaux <= 4 ? 170 : 130;
    const panelH = Math.max(110, Math.min(hauteurConfort, 560 / Math.min(nbPanneaux, 3)));
    const globalIndex = new Map(params.map((p, i) => [p.id, i]));
    let py = availTop;
    for (const g of groupesPanneaux) {
      if (g.params.length === 1) {
        const p = g.params[0];
        const pi = globalIndex.get(p.id)!;
        const pts = collectPoints(mesuresDe(p), p, xm.xOf, xm.coupures);
        const sc = echelles.get(p.id)!;
        const y0 = py;
        const y1 = py + panelH;
        const yOf = (v: number) => y1 - ((v - sc.min) / (sc.max - sc.min)) * (y1 - y0);

        panelsSVG += panel(p, pi, pts, sc, yOf, y0, y1, layout, xm, s, hotspots, false);
        py = y1 + gap;
        plotBottom = y1;
      } else {
        const indices = g.params.map(p => globalIndex.get(p.id)!);
        const rendu = groupPanel(g.params, indices, mesuresDe, py, panelH, layout, xm, s, hotspots, ecrasees);
        panelsSVG += rendu.svg;
        py = rendu.y1 + gap;
        plotBottom = rendu.y1;
      }
    }
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
      const pts = collectPoints(mesuresDe(p), p, xm.xOf, xm.coupures);
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
    // Rien à afficher : placeholder. Repris de l'icône du logo (même tracé
    // que `chart-spline` dans Icon.svelte) pour rester dans le même langage
    // visuel plutôt que d'inventer une illustration — un simple ton neutre,
    // assez clair pour ne jamais rivaliser avec une vraie courbe le jour où
    // il y en a une.
    isEmpty = true;
    const iconSize = 56;
    const iconX = width / 2 - iconSize / 2;
    const iconY = availTop + 4;
    panelsSVG += `<g transform="translate(${n(iconX)},${n(iconY)}) scale(${n(iconSize / 24)})" fill="none" stroke="#c7ced6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M7 16c.5-2 1.5-7 4-7 2 0 2 3 4 3 2.5 0 4.5-5 5-7"/></g>`;
    const titreY = iconY + iconSize + 30;
    panelsSVG += `<text x="${width / 2}" y="${n(titreY)}" text-anchor="middle" font-family="${FONT}" font-size="15" font-weight="600" fill="${MUTED}">Ajoutez des valeurs pour générer la courbe</text>`;
    panelsSVG += `<text x="${width / 2}" y="${n(titreY + 21)}" text-anchor="middle" font-family="${FONT}" font-size="12.5" fill="#8a929b">La courbe apparaît automatiquement, dès la première valeur saisie</text>`;
    plotAreaBottom = titreY + 40;
    plotBottom = titreY + 70;
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

  return { svg: study.settings.impression ? versionImpression(svg) : svg, width, height, hotspots, ecrasees, empty: isEmpty };
}

// ── Helpers de tracé ──────────────────────────────────────────
