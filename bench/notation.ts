// Notation du banc d'épreuve : compare un tableau reconnu à la vérité terrain.
// Utilisé pour l'ancien comme pour le nouveau moteur (mêmes règles).

export interface LigneVerite { nom: string; unite: string; valeurs: string[]; }
export interface CasVerite { id: string; fichier: string; dates: string[]; lignes: LigneVerite[]; }

/** Forme commune renvoyée par les deux moteurs. */
export interface LigneMesuree {
  nom: string;
  unite: string;
  /** Texte de la cellule tel que proposé à l'utilisateur ('' si vide). */
  valeurs: string[];
  /** true = la cellule est signalée douteuse (surlignée en jaune). */
  douteux: boolean[];
}
export interface TableauMesure {
  dates: string[];            // ISO par colonne
  lignes: LigneMesuree[];
  datesDouteuses?: boolean[];
}

export interface Score {
  id: string;
  cellules: number;
  cellulesJustes: number;
  cellulesFausses: number;       // valeur produite ≠ vérité
  cellulesManquantes: number;    // aucune valeur produite
  fauxSilencieux: number;        // faux ET non signalé douteux
  jaunes: number;                // cellules signalées douteuses
  jaunesInutiles: number;        // signalées douteuses alors qu'elles étaient justes
  dates: number;
  datesJustes: number;
  lignes: number;
  lignesTrouvees: number;
}

function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function distance(a: string, b: string): number {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}

/** Deux noms d'analyte désignent-ils la même ligne ? (tolérant aux fautes d'OCR) */
export function memeLigne(a: string, b: string): boolean {
  const na = norm(a), nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length >= 4 && nb.length >= 4 && (na.startsWith(nb) || nb.startsWith(na))) return true;
  const seuil = Math.max(1, Math.floor(Math.max(na.length, nb.length) * 0.25));
  return distance(na, nb) <= seuil;
}

/** Normalise une cellule pour la comparaison : « 4,1 » → « 4.1 », « <5 » → « <5 ». */
export function normVal(s: string): string {
  const t = (s ?? '').trim().replace(/\s/g, '').replace(',', '.');
  if (!t) return '';
  const m = t.match(/^([<>]?)(-?\d*\.?\d+)$/);
  if (!m) return t;
  const n = parseFloat(m[2]);
  return m[1] + (isNaN(n) ? m[2] : String(n));
}

/**
 * Apparie les lignes lues aux lignes attendues, chacune une seule fois.
 *
 * Le rapprochement naïf (« la première ligne lue qui ressemble ») trompait la
 * mesure sur les paires d'analytes proches : « ALAT » à une lettre de « ASAT »
 * était noté contre la ligne ASAT, et l'on comptait deux valeurs fausses là où
 * la lecture était juste. On apparie donc par égalité d'abord, puis par
 * ressemblance décroissante, sans jamais réutiliser une ligne déjà prise.
 */
export function apparier(verite: LigneVerite[], mesurees: LigneMesuree[]): (LigneMesuree | undefined)[] {
  const pris = new Set<number>();
  const out: (LigneMesuree | undefined)[] = new Array(verite.length);

  verite.forEach((lv, i) => {
    const j = mesurees.findIndex((lm, k) => !pris.has(k) && norm(lm.nom) === norm(lv.nom));
    if (j >= 0) { pris.add(j); out[i] = mesurees[j]; }
  });

  verite.forEach((lv, i) => {
    if (out[i]) return;
    const nb = norm(lv.nom);
    let meilleur = -1, meilleureD = Infinity;
    mesurees.forEach((lm, k) => {
      if (pris.has(k)) return;
      const na = norm(lm.nom);
      if (!na || !nb) return;
      const prefixe = na.length >= 4 && nb.length >= 4 && (na.startsWith(nb) || nb.startsWith(na));
      const d = prefixe ? 0.5 : distance(na, nb);
      const seuil = Math.max(1, Math.floor(Math.max(na.length, nb.length) * 0.25));
      if (d <= seuil && d < meilleureD) { meilleureD = d; meilleur = k; }
    });
    if (meilleur >= 0) { pris.add(meilleur); out[i] = mesurees[meilleur]; }
  });

  return out;
}

export function noter(cas: CasVerite, res: TableauMesure): Score {
  const s: Score = {
    id: cas.id, cellules: 0, cellulesJustes: 0, cellulesFausses: 0, cellulesManquantes: 0,
    fauxSilencieux: 0, jaunes: 0, jaunesInutiles: 0,
    dates: cas.dates.length, datesJustes: 0, lignes: cas.lignes.length, lignesTrouvees: 0,
  };

  // Correspondance des colonnes : par date ISO exacte.
  const colDe = new Map<string, number>();
  cas.dates.forEach(d => {
    const i = res.dates.indexOf(d);
    if (i >= 0 && ![...colDe.values()].includes(i)) { colDe.set(d, i); s.datesJustes++; }
  });

  const appariees = apparier(cas.lignes, res.lignes);
  cas.lignes.forEach((lv, li) => {
    const lm = appariees[li];
    if (lm) s.lignesTrouvees++;
    lv.valeurs.forEach((attendu, k) => {
      s.cellules++;
      const ci = colDe.get(cas.dates[k]);
      const brut = lm && ci !== undefined ? (lm.valeurs[ci] ?? '') : '';
      const douteux = lm && ci !== undefined ? !!lm.douteux[ci] : false;
      if (douteux) s.jaunes++;
      if (!brut) { s.cellulesManquantes++; return; }
      if (normVal(brut) === normVal(attendu)) {
        s.cellulesJustes++;
        if (douteux) s.jaunesInutiles++;
      } else {
        s.cellulesFausses++;
        if (!douteux) s.fauxSilencieux++;
      }
    });
  });
  return s;
}

export function cumuler(scores: Score[]): Score {
  const t: Score = {
    id: 'TOTAL', cellules: 0, cellulesJustes: 0, cellulesFausses: 0, cellulesManquantes: 0,
    fauxSilencieux: 0, jaunes: 0, jaunesInutiles: 0, dates: 0, datesJustes: 0, lignes: 0, lignesTrouvees: 0,
  };
  for (const s of scores) {
    t.cellules += s.cellules; t.cellulesJustes += s.cellulesJustes; t.cellulesFausses += s.cellulesFausses;
    t.cellulesManquantes += s.cellulesManquantes; t.fauxSilencieux += s.fauxSilencieux;
    t.jaunes += s.jaunes; t.jaunesInutiles += s.jaunesInutiles;
    t.dates += s.dates; t.datesJustes += s.datesJustes; t.lignes += s.lignes; t.lignesTrouvees += s.lignesTrouvees;
  }
  return t;
}
