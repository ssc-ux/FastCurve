import { describe, expect, it } from 'vitest';
import { grouperLignes, penteLignes } from './tableauPhoto';
import type { BoiteTexte } from './paddle';

const boite = (texte: string, x: number, y: number, w = 60, h = 20): BoiteTexte =>
  ({ texte, confiance: 1, x0: x, y0: y, x1: x + w, y1: y + h });

describe('grouperLignes', () => {
  it('regroupe les zones par ligne, de haut en bas', () => {
    const l = grouperLignes([boite('b1', 200, 50), boite('a1', 0, 0), boite('b0', 0, 50), boite('a2', 200, 2)]);
    expect(l.map(x => x.map(b => b.texte))).toEqual([['a1', 'a2'], ['b0', 'b1']]);
  });

  it('suit une ligne penchée sans la mêler à la suivante', () => {
    // Pente 0,025 : sur 800 px, la ligne descend de 20 px, 2/3 de l’interligne.
    const bs: BoiteTexte[] = [];
    for (let i = 0; i < 5; i++) for (let r = 0; r < 3; r++) bs.push(boite(`r${r}c${i}`, i * 200, r * 30 + i * 5));
    expect(penteLignes(bs)).toBeCloseTo(0.025, 3);
    const l = grouperLignes(bs);
    expect(l).toHaveLength(3);
    l.forEach((ligne, r) => expect(ligne.every(b => b.texte.startsWith(`r${r}`))).toBe(true));
  });
});
