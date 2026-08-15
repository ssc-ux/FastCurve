import type { OcrWord } from './ocr';
import { parseDate } from '../../src/lib/models/types';

// ──────────────────────────────────────────────────────────────
// Reconstruction d'un tableau à partir des mots OCR (avec bbox).
// Bien plus robuste que le découpage par espaces : on regroupe en
// lignes par recouvrement vertical, en colonnes par position x.
// ──────────────────────────────────────────────────────────────

export interface BBox { x0: number; y0: number; x1: number; y1: number; }

export interface ParsedRow {
  name: string;
  unit: string;
  values: (number | null)[];
  raw: string[];
  conf: number[];
  /** Zone de la ligne dans l'image OCR (pour la vignette de vérification). */
  bbox?: BBox;
  /** Abscisse (centre) du mot lu pour chaque cellule — sert à centrer la relecture ciblée. */
  cellX?: (number | null)[];
}

export interface ParsedTable {
  dates: string[];          // ISO, une par colonne détectée
  rawDates: string[];       // texte brut de l'en-tête
  rows: ParsedRow[];
  singleColumn: boolean;    // vrai si compte-rendu mono-date
  /** Abscisses (centre) des colonnes dans le canvas OCR — pour la relecture ciblée des cases vides. */
  colXs?: number[];
}

const UNIT_RE = /^(g\/[dl]?[lL]?|mg\/[lL]|µg\/[lL]|ug\/[lL]|mmol\/[lL]|µmol\/[lL]|umol\/[lL]|mol\/[lL]|nmol\/[lL]|pmol\/[lL]|ng\/m?[lL]|pg\/m?[lL]|kU\/[lL]|U\/[lL]|UI\/[lL]|mUI\/[lL]|G\/[lL]|T\/[lL]|10\d?\/[lL]|mm\/h|mm|%|fl|fL|pg|mmHg|mL\/min|min|s|ratio)$/i;

function cleanNumber(text: string): number | null {
  let t = text
    .replace(/[↑↓▲▼<>*]/g, '')
    .replace(/\s/g, '')
    .replace(/[OQ]/g, '0')
    .replace(/[lI](?=\d)|(?<=\d)[lI]/g, '1')
    .replace(',', '.')
    .replace(/[^0-9.\-]/g, '');
  // Un seul point décimal
  const firstDot = t.indexOf('.');
  if (firstDot >= 0) {
    t = t.slice(0, firstDot + 1) + t.slice(firstDot + 1).replace(/\./g, '');
  }
  if (!/\d/.test(t)) return null;
  const n = parseFloat(t);
  return isNaN(n) ? null : n;
}

function isValueLike(text: string): boolean {
  return /\d/.test(text) && !/^\d{1,2}[\/.]\d{1,2}[\/.]\d{2,4}$/.test(text);
}

function isRangeLike(text: string): boolean {
  const t = text.replace(/\s/g, '');
  return /^\d+(?:[.,]\d+)?-\d+(?:[.,]\d+)?$/.test(t) || /^[<>]\d+(?:[.,]\d+)?$/.test(t);
}

interface Line { yc: number; words: OcrWord[]; }

function groupLines(words: OcrWord[]): Line[] {
  if (!words.length) return [];
  const sorted = [...words].sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2);
  const heights = sorted.map(w => w.y1 - w.y0).filter(h => h > 0).sort((a, b) => a - b);
  const medH = heights[Math.floor(heights.length / 2)] || 12;
  const tol = medH * 0.7;
  const lines: Line[] = [];
  for (const w of sorted) {
    const yc = (w.y0 + w.y1) / 2;
    const line = lines.find(l => Math.abs(l.yc - yc) <= tol);
    if (line) {
      line.words.push(w);
      line.yc = (line.yc * (line.words.length - 1) + yc) / line.words.length;
    } else {
      lines.push({ yc, words: [w] });
    }
  }
  for (const l of lines) l.words.sort((a, b) => a.x0 - b.x0);
  return lines;
}

/** Extrait une date ISO d'un texte, avec corrections OCR courantes. */
function extractDate(text: string): { iso: string | null; raw: string } | null {
  const cleaned = text.replace(/[OQ]/g, '0').replace(/[lI](?=\d)/g, '1');
  const m = cleaned.match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
  if (!m) return null;
  const raw = `${m[1]}/${m[2]}/${m[3]}`;
  return { iso: parseDate(raw), raw };
}

interface DateCol { xc: number; iso: string | null; raw: string; }

function clusterColumns(cols: DateCol[]): DateCol[] {
  const sorted = [...cols].sort((a, b) => a.xc - b.xc);
  const merged: DateCol[] = [];
  for (const c of sorted) {
    const last = merged[merged.length - 1];
    if (last && Math.abs(last.xc - c.xc) < 40) continue; // doublon proche
    merged.push(c);
  }
  return merged;
}

export function parseTable(words: OcrWord[]): ParsedTable {
  const lines = groupLines(words);

  // 1. Repérer la LIGNE d'en-tête = celle qui contient le PLUS de dates.
  //    (Rejette le titre « Résultats du 04/04/2023 au 15/07/2026 » qui n'a que
  //    2 dates, alors que la vraie ligne d'en-tête en a une par colonne.)
  let dateCols: DateCol[] = [];
  for (let i = 0; i < Math.min(lines.length, 8); i++) {
    const ds: DateCol[] = [];
    for (const w of lines[i].words) {
      const d = extractDate(w.text);
      if (d) ds.push({ xc: (w.x0 + w.x1) / 2, iso: d.iso, raw: d.raw });
    }
    if (ds.length > dateCols.length) dateCols = ds;
  }
  const cols = clusterColumns(dateCols);

  if (cols.length >= 2) {
    return parseMultiColumn(lines, cols);
  }
  // Mono-colonne : compte-rendu d'une date, ou date unique
  const globalDate = cols[0] || findAnyDate(lines);
  return parseSingleColumn(lines, globalDate);
}

function findAnyDate(lines: Line[]): DateCol | null {
  for (const l of lines) {
    for (const w of l.words) {
      const d = extractDate(w.text);
      if (d) return { xc: 0, iso: d.iso, raw: d.raw };
    }
  }
  return null;
}

function parseMultiColumn(lines: Line[], cols: DateCol[]): ParsedTable {
  const firstColX = cols[0].xc;
  const spacing = cols.length > 1
    ? Math.min(...cols.slice(1).map((c, i) => c.xc - cols[i].xc))
    : 120;
  const colTol = spacing * 0.55;

  const rows: ParsedRow[] = [];
  const headerYs = new Set<number>();
  // Marquer les lignes d'en-tête (celles contenant des dates)
  for (const l of lines) {
    if (l.words.some(w => extractDate(w.text))) headerYs.add(l.yc);
  }

  for (const line of lines) {
    if (headerYs.has(line.yc)) continue;
    const leftWords: OcrWord[] = [];
    const values: (number | null)[] = Array(cols.length).fill(null);
    const raws: string[] = Array(cols.length).fill('');
    const confs: number[] = Array(cols.length).fill(0);
    const cellX: (number | null)[] = Array(cols.length).fill(null);

    for (const w of line.words) {
      const xc = (w.x0 + w.x1) / 2;
      if (xc < firstColX - colTol) {
        leftWords.push(w);
        continue;
      }
      // Assigner à la colonne la plus proche
      let best = -1, bestD = Infinity;
      cols.forEach((c, i) => {
        const dd = Math.abs(c.xc - xc);
        if (dd < bestD) { bestD = dd; best = i; }
      });
      if (best >= 0 && bestD <= colTol && isValueLike(w.text)) {
        const n = cleanNumber(w.text);
        // Ne pas écraser une valeur déjà posée dans la colonne
        if (raws[best] === '') {
          values[best] = n;
          raws[best] = w.text;
          confs[best] = w.conf;
          cellX[best] = xc;
        }
      } else if (best >= 0 && !isValueLike(w.text)) {
        // texte non numérique dans une colonne (ex: "non", "En cours") → laisser vide
      }
    }

    // Nom + unité depuis la partie gauche
    const { name, unit } = splitNameUnit(leftWords);
    if (!name) continue;
    if (values.every(v => v === null) && !unit) continue;
    rows.push({ name, unit, values, raw: raws, conf: confs, bbox: lineBBox(line), cellX });
  }

  return {
    dates: cols.map(c => c.iso ?? ''),
    rawDates: cols.map(c => c.raw),
    rows,
    singleColumn: false,
    colXs: cols.map(c => c.xc),
  };
}

function parseSingleColumn(lines: Line[], date: DateCol | null): ParsedTable {
  const rows: ParsedRow[] = [];
  for (const line of lines) {
    if (line.words.some(w => extractDate(w.text))) continue;
    // Dernier token numérique = valeur, le reste (gauche) = nom/unité
    const valWords = line.words.filter(w => isValueLike(w.text) && !isRangeLike(w.text));
    if (!valWords.length) continue;
    const valueWord = valWords[valWords.length - 1];
    const leftWords = line.words.filter(w => w.x1 <= valueWord.x0 + 2);
    const { name, unit } = splitNameUnit(leftWords.length ? leftWords : line.words.slice(0, -1));
    if (!name) continue;
    const n = cleanNumber(valueWord.text);
    rows.push({ name, unit, values: [n], raw: [valueWord.text], conf: [valueWord.conf], bbox: lineBBox(line) });
  }
  return {
    dates: [date?.iso ?? ''],
    rawDates: [date?.raw ?? ''],
    rows,
    singleColumn: true,
  };
}

function lineBBox(line: Line): BBox {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const w of line.words) {
    x0 = Math.min(x0, w.x0); y0 = Math.min(y0, w.y0);
    x1 = Math.max(x1, w.x1); y1 = Math.max(y1, w.y1);
  }
  return { x0, y0, x1, y1 };
}

function splitNameUnit(words: OcrWord[]): { name: string; unit: string } {
  const nameParts: string[] = [];
  let unit = '';
  for (const w of words) {
    const t = w.text.trim();
    if (!t) continue;
    if (isRangeLike(t)) continue;             // colonne "Normales"
    if (!unit && UNIT_RE.test(t)) { unit = t; continue; }
    if (isValueLike(t) && nameParts.length) break; // début des valeurs
    if (/^[A-Za-zÀ-ÿ%()\/.\-]+$/.test(t) || /[A-Za-zÀ-ÿ]/.test(t)) {
      nameParts.push(t);
    }
  }
  // Nettoyage : retirer un éventuel "%" seul en fin de nom conservé (POLY NEUTRO %)
  const name = nameParts.join(' ').replace(/\s+/g, ' ').trim();
  return { name, unit };
}
