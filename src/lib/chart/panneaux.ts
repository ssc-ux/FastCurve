import type { StudyState, Parameter } from '../models/types';
import { niceScale, fmtNum, fmtTick } from './scale';
import { FONT, INK, AXIS, GRID, MUTED, REF_FILL, MARKER_SHAPES, motifTrait, esc, largeurTexte, n, marker, clamp } from './svg';
import { type Layout, buildXMapper } from './axeTemps';
import { type RenderResult, unitLabel, libelleAxe, type SeriesPoint, collectPoints, repartirAxes, valueScaleMulti } from './donnees';

// ──────────────────────────────────────────────────────────────
// Tracé des panneaux : un paramètre, un groupe à deux axes, une série.
// Extrait de render.ts ; module pur, aucune dépendance DOM.
// ──────────────────────────────────────────────────────────────

export function panel(
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
  out += `<text x="${marginLeft}" y="${n(y0 - 4)}" font-family="${FONT}" font-size="11.5" font-weight="800" fill="#3c4a63">${esc(title)}</text>`;

  out += series(p, pi, pts, yOf, s, hotspots, y0, y1);
  return out;
}

/**
 * Panneau à plusieurs paramètres (groupe choisi par le médecin).
 *
 * Répartit les séries du groupe entre un axe gauche et, au besoin, un axe
 * droit — la même règle que `repartirAxes` en mode « Graphe unique » (jamais
 * plus de deux axes, même unité jamais scindée). Contrairement au panneau
 * simple, le titre ne peut pas être « nom (unité) » : plusieurs séries aux
 * couleurs et unités propres se disputent la place, donc chaque série est
 * listée avec sa couleur, son marqueur et sa flèche d'axe (← / →) juste
 * au-dessus du panneau — une mini-légende locale, sur autant de lignes que
 * nécessaire si les noms ne tiennent pas sur une seule.
 *
 * Pas de bande de normale ici : avec deux échelles dans un même panneau, une
 * bande calée sur l'une des deux se lirait comme si elle valait pour l'autre
 * — plus trompeur qu'utile. Le médecin qui veut la bande d'un paramètre le
 * ressort de son groupe.
 */
export function groupPanel(
  groupParams: Parameter[],
  indices: number[],
  mesuresDe: (p: Parameter) => StudyState['measurements'],
  py: number,
  panelH: number,
  layout: Layout, xm: ReturnType<typeof buildXMapper>,
  s: StudyState['settings'],
  hotspots: RenderResult['hotspots'],
  ecrasees: string[],
): { svg: string; y1: number } {
  const { marginLeft, plotWidth } = layout;
  const { gauche, droite } = repartirAxes(mesuresDe, groupParams);

  // Mini-légende : une entrée par série, mise en ligne(s) au-dessus du panneau.
  const entrees = groupParams.map((p, idx) => {
    const onRight = droite.includes(p);
    const repere = droite.length ? (onRight ? ' →' : ' ←') : '';
    const ul = unitLabel(p);
    const texte = (ul ? `${p.name} (${ul})` : p.name) + repere;
    return { p, i: indices[idx], texte, w: 14 + largeurTexte(texte, 11.5, true) + 16 };
  });
  const lignes: (typeof entrees)[] = [];
  {
    let cur: typeof entrees = [];
    let used = 0;
    for (const e of entrees) {
      if (cur.length && used + e.w > plotWidth) { lignes.push(cur); cur = []; used = 0; }
      cur.push(e); used += e.w;
    }
    if (cur.length) lignes.push(cur);
  }
  const LIGNE_H = 15;
  // Un panneau simple loge son titre sur une ligne dans les ~22 px d'air déjà
  // laissés par l'écart entre panneaux (`gap`) : au-delà, il faut repousser
  // le panneau vers le bas pour ne pas chevaucher celui du dessus.
  const HEADROOM = 22;
  const titreH = lignes.length * LIGNE_H;
  const y0 = py + Math.max(0, titreH - HEADROOM);
  const y1 = y0 + panelH;

  let out = '';
  const baseY = y0 - 4;
  lignes.forEach((ligne, li) => {
    const y = baseY - (lignes.length - 1 - li) * LIGNE_H;
    let lx = marginLeft;
    for (const e of ligne) {
      const color = e.p.color || '#2a78d6';
      const shape = MARKER_SHAPES[e.i % MARKER_SHAPES.length];
      out += marker(shape, lx + 4, y - 3.5, 3.5, color);
      out += `<text x="${n(lx + 12)}" y="${n(y)}" font-family="${FONT}" font-size="11.5" font-weight="600" fill="${INK}">${esc(e.texte)}</text>`;
      lx += e.w;
    }
  });

  const scL = valueScaleMulti(mesuresDe, gauche);
  const scR = droite.length ? valueScaleMulti(mesuresDe, droite) : null;
  const yOfL = (v: number) => y1 - ((v - scL.min) / (scL.max - scL.min)) * (y1 - y0);
  const yOfR = scR ? (v: number) => y1 - ((v - scR.min) / (scR.max - scR.min)) * (y1 - y0) : yOfL;

  scL.ticks.forEach(t => {
    const yy = yOfL(t);
    if (yy < y0 - 0.5 || yy > y1 + 0.5) return;
    out += `<line x1="${marginLeft}" y1="${n(yy)}" x2="${marginLeft + plotWidth}" y2="${n(yy)}" stroke="${GRID}" stroke-width="1"/>`;
    out += `<text x="${marginLeft - 8}" y="${n(yy + 3.5)}" text-anchor="end" font-family="${FONT}" font-size="10" fill="${MUTED}">${fmtTick(t, scL.step)}</text>`;
  });
  out += `<line x1="${marginLeft}" y1="${n(y0)}" x2="${marginLeft}" y2="${n(y1)}" stroke="${AXIS}" stroke-width="1.2"/>`;
  out += `<line x1="${marginLeft}" y1="${n(y1)}" x2="${marginLeft + plotWidth}" y2="${n(y1)}" stroke="${AXIS}" stroke-width="1.2"/>`;
  const titreGauche = libelleAxe(gauche);
  if (titreGauche) {
    out += `<text transform="translate(16,${n((y0 + y1) / 2)}) rotate(-90)" text-anchor="middle" font-family="${FONT}" font-size="10.5" fill="${INK}">${esc(titreGauche)}</text>`;
  }

  if (scR) {
    out += `<line x1="${marginLeft + plotWidth}" y1="${n(y0)}" x2="${marginLeft + plotWidth}" y2="${n(y1)}" stroke="${AXIS}" stroke-width="1.2"/>`;
    scR.ticks.forEach(t => {
      const yy = yOfR(t);
      if (yy < y0 - 0.5 || yy > y1 + 0.5) return;
      out += `<text x="${marginLeft + plotWidth + 8}" y="${n(yy + 3.5)}" text-anchor="start" font-family="${FONT}" font-size="10" fill="${MUTED}">${fmtTick(t, scR.step)}</text>`;
    });
    const titreDroite = libelleAxe(droite);
    if (titreDroite) {
      out += `<text transform="translate(${layout.width - 14},${n((y0 + y1) / 2)}) rotate(90)" text-anchor="middle" font-family="${FONT}" font-size="10.5" fill="${INK}">${esc(titreDroite)}</text>`;
    }
  }

  // Même règle qu'en mode « Graphe unique » : une série écrasée au ras de son
  // axe n'est pas mensongère (elle est tracée juste), mais illisible. On le
  // signale plutôt que de laisser croire à un paramètre resté plat.
  for (const p of groupParams) {
    const sc = droite.includes(p) ? scR! : scL;
    const vs = mesuresDe(p).map(m => m.value).filter(v => isFinite(v));
    if (!vs.length) continue;
    const etendue = sc.max - sc.min;
    if (etendue > 0 && (Math.max(...vs) - Math.min(...vs)) / etendue < 0.04) ecrasees.push(p.name);
  }

  groupParams.forEach((p, idx) => {
    const i = indices[idx];
    const onRight = droite.includes(p);
    const yOf = onRight ? yOfR : yOfL;
    const pts = collectPoints(mesuresDe(p), p, xm.xOf, xm.coupures);
    out += series(p, i, pts, yOf, s, hotspots, y0, y1, motifTrait(i, true));
  });

  return { svg: out, y1 };
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
export function rayonMarqueur(pts: SeriesPoint[]): number {
  if (pts.length < 2) return 4;
  const ecarts: number[] = [];
  for (let i = 1; i < pts.length; i++) ecarts.push(Math.abs(pts[i].x - pts[i - 1].x));
  ecarts.sort((a, b) => a - b);
  const median = ecarts[Math.floor(ecarts.length / 2)];
  if (median >= 26) return 4;
  return clamp(median / 6.5, 2.2, 4);
}

export function series(
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
  const d = pts.map((pt, i) => `${i === 0 || pt.apresCoupure ? 'M' : 'L'}${pt.x.toFixed(1)},${yOf(pt.value).toFixed(1)}`).join(' ');
  const trait = dash ? ` stroke-dasharray="${dash}"` : '';
  out += `<path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"${trait}/>`;
  // À travers une coupure d'axe : aucun trait. Relier deux prélèvements
  // séparés de plusieurs années, même en pointillé, suggérait une tendance
  // que rien ne mesure.
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
      out += `<text x="${n(pt.x)}" y="${n(ly)}" text-anchor="middle" font-family="${FONT}" font-size="10" font-weight="700" fill="${INK}">${lbl}</text>`;
    }
    hotspots.push({ param: p, date: pt.date, value: pt.value, cx: pt.x, cy });
  });
  return out;
}
