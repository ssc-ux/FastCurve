// Utilitaires d'échelle et de graduations « jolies » pour axes.

export interface NiceScale {
  min: number;
  max: number;
  ticks: number[];
  step: number;
}

/** Calcule des bornes et graduations arrondies pour un axe. */
export function niceScale(dataMin: number, dataMax: number, targetTicks = 5): NiceScale {
  if (!isFinite(dataMin) || !isFinite(dataMax)) {
    return { min: 0, max: 1, ticks: [0, 1], step: 1 };
  }
  if (dataMin === dataMax) {
    const pad = dataMin === 0 ? 1 : Math.abs(dataMin) * 0.1;
    dataMin -= pad;
    dataMax += pad;
  }
  const range = niceNum(dataMax - dataMin, false);
  const step = niceNum(range / (targetTicks - 1), true);
  const min = Math.floor(dataMin / step) * step;
  const max = Math.ceil(dataMax / step) * step;
  const ticks: number[] = [];
  // Éviter les erreurs d'arrondi flottant
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  for (let v = min; v <= max + step * 0.5; v += step) {
    ticks.push(parseFloat(v.toFixed(decimals + 2)));
  }
  return { min, max, ticks, step };
}

function niceNum(range: number, round: boolean): number {
  const exp = Math.floor(Math.log10(range));
  const frac = range / Math.pow(10, exp);
  let niceFrac: number;
  if (round) {
    if (frac < 1.5) niceFrac = 1;
    else if (frac < 3) niceFrac = 2;
    else if (frac < 7) niceFrac = 5;
    else niceFrac = 10;
  } else {
    if (frac <= 1) niceFrac = 1;
    else if (frac <= 2) niceFrac = 2;
    else if (frac <= 5) niceFrac = 5;
    else niceFrac = 10;
  }
  return niceFrac * Math.pow(10, exp);
}

function sansZeros(s: string): string {
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

/**
 * Écriture française d'un nombre déjà formaté : virgule décimale et espace fine
 * insécable pour les milliers à partir de 5 chiffres (20 000, mais 4000).
 * L'application est intégralement en français : un axe gradué « 2.40 » y détonne.
 */
export function frNum(s: string): string {
  const neg = s.startsWith('-');
  const [ent, dec] = (neg ? s.slice(1) : s).split('.');
  const groupe = ent.length > 4 ? ent.replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f') : ent;
  return (neg ? '-' : '') + groupe + (dec ? ',' + dec : '');
}

/** Formatte un nombre pour l'affichage (max 3 significatifs pertinents). */
export function fmtNum(v: number): string {
  if (!isFinite(v)) return '';
  if (Number.isInteger(v)) return frNum(String(v));
  const abs = Math.abs(v);
  if (abs >= 100) return frNum(v.toFixed(0));
  // Les zéros de fin sont retirés : une hémoglobine saisie « 9,8 » ne doit pas
  // s'afficher « 9,80 » sur le graphique.
  if (abs >= 10) return frNum(sansZeros(v.toFixed(1)));
  return frNum(sansZeros(v.toFixed(2)));
}

/**
 * Graduation d'axe : nombre de décimales déduit du pas, pour que toutes les
 * graduations d'un même axe soient homogènes (2,0 / 2,2 / 2,4 et non 2 / 2.20).
 */
export function fmtTick(v: number, step: number): string {
  if (!isFinite(v)) return '';
  const dec = Math.max(0, Math.min(3, -Math.floor(Math.log10(Math.abs(step) || 1))));
  return frNum(v.toFixed(dec));
}
