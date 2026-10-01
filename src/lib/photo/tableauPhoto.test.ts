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

import { confronter } from './tableauPhoto';
import type { TableauLu } from '../ocr/pipeline';

const tab = (nom: string, valeurs: string[], dates = ['2026-09-30', '2026-09-29']): TableauLu => ({
  echec: false, message: '',
  dates: dates.map(iso => ({ iso, brut: iso, douteux: false, motifs: [] })),
  lignes: [{ nom, unite: '', nomDouteux: false, nomMotifs: [], cellules: valeurs.map(texte => ({ texte, douteux: false, motifs: [] })) }],
});

describe('confronter (double lecture)', () => {
  it('met en jaune une case lue différemment, garde les cases identiques', () => {
    const r = confronter(tab('LEUCOCYTES', ['6.90', '5.63']), tab('LEUCOCYTES', ['6.90', '5.68']));
    expect(r.lignes[0].cellules.map(c => c.douteux)).toEqual([false, true]);
    expect(r.lignes[0].cellules[1].texte).toBe('5.63');
  });
  it('reprend en jaune une case lue sur une seule image, apparie par nom approché et par date', () => {
    const r = confronter(tab('POLYNEUTRCS', ['', '51.0']), tab('POLY NEUTRO %', ['51.0', '38.7'], ['2026-09-29', '2026-09-30']));
    expect(r.lignes[0].cellules[0]).toMatchObject({ texte: '38.7', douteux: true });
    expect(r.lignes[0].cellules[1].douteux).toBe(false);
  });
});
