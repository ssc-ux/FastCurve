import { parseDate } from '../models/types';

// ──────────────────────────────────────────────────────────────
// Analyse d'un tableau collé (Excel / texte tabulé) → dates × analytes.
// Deux dispositions gérées :
//  a) matrice : ligne d'en-tête = dates, 1re colonne = noms d'analytes
//  b) paires « nom<TAB>valeur » (une seule date, aujourd'hui par défaut)
// ──────────────────────────────────────────────────────────────

export interface PastedGrid {
  dates: string[];               // ISO
  rows: { name: string; values: (number | null)[]; qualifiers: Qualifier[] }[];
}

export type Qualifier = '<' | '>' | null;

function cleanNumber(text: string): number | null {
  const t = (text || '').replace(/\s/g, '').replace(/[<>]/g, '').replace(',', '.').replace(/[^0-9.\-]/g, '');
  if (!/\d/.test(t)) return null;
  const n = parseFloat(t);
  return isNaN(n) ? null : n;
}

/**
 * Valeur + seuil de détection. Sans cela un « <5 » collé depuis un tableur
 * devient un « 5 » : une CRP indétectable passerait pour une CRP à la limite
 * haute de la normale, alors que la saisie au clavier, elle, conserve le seuil.
 */
function cleanCell(text: string): { value: number | null; qualifier: Qualifier } {
  const raw = (text || '').trim();
  const qualifier: Qualifier = raw.startsWith('<') ? '<' : raw.startsWith('>') ? '>' : null;
  const value = cleanNumber(raw);
  return { value, qualifier: value === null ? null : qualifier };
}

function isDateCell(s: string): boolean {
  return !!parseDate((s || '').trim());
}

/** Sépare en cellules : tabulation prioritaire, sinon ≥2 espaces. */
function splitCells(line: string): string[] {
  if (line.includes('\t')) return line.split('\t').map(c => c.trim());
  return line.split(/ {2,}/).map(c => c.trim()).filter(c => c.length);
}

export function parseGridPaste(text: string): PastedGrid | null {
  if (!text || !text.trim()) return null;
  const lines = text.replace(/\r/g, '').split('\n').map(l => l).filter(l => l.trim().length > 0);
  if (lines.length === 0) return null;

  const rows = lines.map(splitCells);
  const header = rows[0];

  // Cas (a) : en-tête avec des dates en colonnes
  const headerDates = header.slice(1).filter(isDateCell);
  if (header.length >= 2 && headerDates.length >= Math.max(1, header.length - 2)) {
    const dateCells = header.slice(1);
    const dates = dateCells.map(d => parseDate(d.trim()) || '');
    const out: PastedGrid = { dates, rows: [] };
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const name = (r[0] || '').trim();
      if (!name) continue;
      const cells = dates.map((_, j) => cleanCell(r[j + 1] ?? ''));
      const values = cells.map(c => c.value);
      if (values.some(v => v !== null)) {
        out.rows.push({ name, values, qualifiers: cells.map(c => c.qualifier) });
      }
    }
    if (out.rows.length && out.dates.some(Boolean)) return out;
  }

  // Cas (b) : paires nom / valeur (une seule colonne, date à renseigner —
  // jamais devinée, cohérent avec la règle de l'import OCR).
  const pairRows = rows.filter(r => r.length >= 2);
  if (pairRows.length >= 1) {
    const out: PastedGrid = { dates: [''], rows: [] };
    for (const r of pairRows) {
      const name = (r[0] || '').trim();
      if (!name || isDateCell(name)) continue;
      // valeur = dernière cellule numérique
      let cell: { value: number | null; qualifier: Qualifier } = { value: null, qualifier: null };
      for (let k = r.length - 1; k >= 1; k--) { cell = cleanCell(r[k]); if (cell.value !== null) break; }
      if (cell.value !== null) out.rows.push({ name, values: [cell.value], qualifiers: [cell.qualifier] });
    }
    if (out.rows.length) return out;
  }

  return null;
}
