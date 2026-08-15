import { describe, it, expect } from 'vitest';
import { parseTable } from './tableParser';
import type { OcrWord } from './ocr';

// Fabrique un mot OCR positionné (grille simple, lignes ~ y, colonnes ~ x).
function w(text: string, x: number, y: number, conf = 95): OcrWord {
  return { text, x0: x, y0: y, x1: x + text.length * 10, y1: y + 18, conf };
}

describe('parseTable', () => {
  it('reconstruit un tableau à 2 colonnes de dates', () => {
    const words: OcrWord[] = [
      // en-tête
      w('01/01/2023', 200, 0), w('01/02/2023', 400, 0),
      // ligne CRP
      w('CRP', 0, 40), w('12', 220, 40), w('5', 420, 40),
      // ligne VS
      w('VS', 0, 80), w('20', 220, 80), w('18', 420, 80),
    ];
    const table = parseTable(words);
    expect(table.dates).toEqual(['2023-01-01', '2023-02-01']);
    const crp = table.rows.find(r => /crp/i.test(r.name));
    expect(crp).toBeTruthy();
    expect(crp!.values).toEqual([12, 5]);
  });

  it('ne renvoie aucune ligne sans mots', () => {
    const table = parseTable([]);
    expect(table.rows).toEqual([]);
  });

  it('ignore le titre « Résultats du X au Y » et prend la vraie ligne d\'en-tête', () => {
    const words: OcrWord[] = [
      // Titre : 2 dates (piège) — ne doit PAS servir de colonnes
      w('Résultats', 60, 0), w('du', 200, 0), w('04/04/2023', 250, 0), w('au', 420, 0), w('15/07/2026', 470, 0),
      // Vraie ligne d'en-tête : 3 dates (avec heure, souvent collée par l'OCR)
      w('01/01/2023', 300, 40), w('10:18', 405, 40),
      w('01/02/202609:56', 500, 40),
      w('01/03/2024', 700, 40),
      // Lignes de valeurs
      w('CRP', 0, 80), w('mg/l', 120, 80), w('12', 320, 80), w('5', 520, 80), w('8', 720, 80),
      w('CPK', 0, 120), w('U/l', 120, 120), w('128', 320, 120), w('95', 520, 120), w('115', 720, 120),
    ];
    const table = parseTable(words);
    expect(table.dates).toEqual(['2023-01-01', '2026-02-01', '2024-03-01']);
    const crp = table.rows.find(r => /crp/i.test(r.name));
    expect(crp?.values).toEqual([12, 5, 8]);
    const cpk = table.rows.find(r => /cpk/i.test(r.name));
    expect(cpk?.values).toEqual([128, 95, 115]);
  });
});
