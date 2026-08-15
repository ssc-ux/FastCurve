import { describe, it, expect } from 'vitest';
import { parseGridPaste } from './gridPaste';

describe('parseGridPaste — matrice dates × analytes', () => {
  it('lit un tableau tabulé avec en-tête de dates', () => {
    const text = [
      'Analyte\t01/01/2023\t01/02/2023',
      'CRP\t12\t5',
      'Hémoglobine\t13,5\t14',
    ].join('\n');
    const grid = parseGridPaste(text);
    expect(grid).not.toBeNull();
    expect(grid!.dates).toEqual(['2023-01-01', '2023-02-01']);
    expect(grid!.rows).toHaveLength(2);
    expect(grid!.rows[0]).toEqual({ name: 'CRP', values: [12, 5], qualifiers: [null, null] });
    expect(grid!.rows[1].values).toEqual([13.5, 14]);
  });

  it('sépare la valeur et le seuil de détection', () => {
    const text = 'Analyte\t01/01/2023\nFerritine\t<15';
    const grid = parseGridPaste(text);
    expect(grid!.rows[0].values).toEqual([15]);
    expect(grid!.rows[0].qualifiers).toEqual(['<']);
  });

  it('conserve « < » et « > » comme la saisie au clavier', () => {
    const text = 'Analyte\t01/01/2023\t01/02/2023\nCRP\t<5\t24\nFerritine\t>1000\t820';
    const grid = parseGridPaste(text);
    expect(grid!.rows[0].values).toEqual([5, 24]);
    expect(grid!.rows[0].qualifiers).toEqual(['<', null]);
    expect(grid!.rows[1].values).toEqual([1000, 820]);
    expect(grid!.rows[1].qualifiers).toEqual(['>', null]);
  });

  it('ignore les lignes sans aucune valeur', () => {
    const text = 'Analyte\t01/01/2023\nCRP\t\nVS\t20';
    const grid = parseGridPaste(text);
    expect(grid!.rows.map(r => r.name)).toEqual(['VS']);
  });
});

describe('parseGridPaste — paires nom/valeur', () => {
  it('lit des paires nom<TAB>valeur sans deviner la date (date vide)', () => {
    const text = 'CRP\t12\nVS\t20';
    const grid = parseGridPaste(text);
    expect(grid).not.toBeNull();
    expect(grid!.dates).toEqual(['']); // aucune date devinée
    expect(grid!.rows).toEqual([
      { name: 'CRP', values: [12], qualifiers: [null] },
      { name: 'VS', values: [20], qualifiers: [null] },
    ]);
  });
});

describe('parseGridPaste — entrées invalides', () => {
  it('renvoie null pour un texte vide', () => {
    expect(parseGridPaste('')).toBeNull();
    expect(parseGridPaste('   ')).toBeNull();
  });
});
