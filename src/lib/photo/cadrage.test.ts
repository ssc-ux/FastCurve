import { describe, expect, it } from 'vitest';
import { estimerInclinaison, trouverTableau, verdictCadrage, type MesureCadrage } from './cadrage';
import type { CarteEncre } from '../ocr/structure';

/** Carte synthétique : `lignes` rangées de 3 blocs de « texte » séparés par de larges blancs, inclinées de `pente` px/px. */
function tableau(lignes: number, pente = 0): CarteEncre {
  const W = 400, H = 200;
  const encre = new Uint8Array(W * H);
  for (let r = 0; r < lignes; r++) {
    const y0 = 20 + r * 16;
    for (const [a, b] of [[20, 110], [180, 230], [300, 350]]) {
      for (let x = a; x < b; x++) {
        if ((x >> 2) % 2) continue; // lettres séparées
        for (let y = y0; y < y0 + 8; y++) {
          const yy = Math.round(y - (x - 200) * pente);
          if (yy >= 0 && yy < H) encre[yy * W + x] = 1;
        }
      }
    }
  }
  return { largeur: W, hauteur: H, encre };
}

describe('prise de vue guidée — repérage du tableau', () => {
  it('repère un tableau de plusieurs lignes à colonnes séparées', () => {
    const t = trouverTableau(tableau(6));
    expect(t).not.toBeNull();
    expect(t!.lignes).toBe(6);
    expect(t!.boite.x0).toBeLessThanOrEqual(30);
    expect(t!.boite.x1).toBeGreaterThanOrEqual(345);
  });

  it('ne voit pas de tableau dans deux lignes isolées', () => {
    expect(trouverTableau(tableau(2))).toBeNull();
  });

  it('mesure l’inclinaison des lignes (texte qui monte vers la droite → angle positif)', () => {
    expect(Math.abs(estimerInclinaison(tableau(6, 0)))).toBeLessThanOrEqual(0.5);
    const a = estimerInclinaison(tableau(6, Math.tan(3 * Math.PI / 180)));
    expect(a).toBeGreaterThanOrEqual(2);
    expect(a).toBeLessThanOrEqual(4);
  });
});

describe('prise de vue guidée — consignes', () => {
  const base: MesureCadrage = {
    tableau: { boite: { x0: 50, y0: 50, x1: 650, y1: 300 }, hL: 10, lignes: 8 },
    angle: 0, biais: 0, largeur: 720, netteteRelative: 1, echellePleine: 3,
  };
  it('vert quand tout va bien', () => expect(verdictCadrage(base).etat).toBe('ok'));
  it('aucun tableau', () => expect(verdictCadrage({ ...base, tableau: null }).etat).toBe('aucun'));
  it('penché', () => expect(verdictCadrage({ ...base, angle: 6 }).etat).toBe('penche'));
  it('de biais', () => expect(verdictCadrage({ ...base, biais: 4 }).etat).toBe('biais'));
  it('trop loin', () => expect(verdictCadrage({ ...base, tableau: { ...base.tableau!, boite: { x0: 300, y0: 50, x1: 500, y1: 300 } } }).etat).toBe('loin'));
  it('texte trop petit', () => expect(verdictCadrage({ ...base, echellePleine: 1 }).etat).toBe('petit'));
  it('flou', () => expect(verdictCadrage({ ...base, netteteRelative: 0.2 }).etat).toBe('flou'));
});

describe('verdictCadrage — colonne des noms', () => {
  const mesure = (x0: number) => ({
    tableau: { boite: { x0, y0: 50, x1: 700, y1: 400 }, hL: 10, lignes: 12 },
    angle: 0, biais: 0, largeur: 720, netteteRelative: 1, echellePleine: 3.5,
  });
  it('demande de décaler quand le tableau touche le bord gauche', () => {
    expect(verdictCadrage(mesure(0)).etat).toBe('coupe');
    expect(verdictCadrage(mesure(40)).etat).toBe('ok');
  });
});
