import { describe, expect, it } from 'vitest';
import { voter } from './pipeline';
import { corrigerNomParCatalogue } from './roles';
import { effacerFilets } from './structure';
import { matchCatalogExact } from '../models/catalog';

const L = (texte: string, confiance = 80) => ({ texte, confiance });

describe('lecture multiple — vote', () => {
  it('la majorité efface une confusion isolée (84 lu 54 une fois)', () => {
    const v = voter([L('54'), L('84'), L('84')]);
    expect(v.texte).toBe('84');
    expect(v.desaccord).toBe(false);
    expect(v.unanime).toBe(false);
  });

  it('une lecture qui ne forme pas un nombre ne vote pas (« << »)', () => {
    expect(voter([L('<<'), L('<5'), L('<<')]).texte).toBe('<5');
  });

  it('sans majorité absolue, la case est signalée', () => {
    expect(voter([L('54'), L('84'), L('34')]).desaccord).toBe(true);
  });

  it('virgule et point sont la même lecture', () => {
    const v = voter([L('12,2'), L('12.2'), L('12,2')]);
    expect(v.unanime).toBe(true);
  });

  it('toutes vides : case vide, sans doute de lecture', () => {
    const v = voter([L('', 0), L('', 0), L('', 0)]);
    expect(v.texte).toBe('');
    expect(v.desaccord).toBe(false);
  });
});

describe('nom mal lu, rapproché du catalogue', () => {
  const exact = (n: string) => !!matchCatalogExact(n);
  it('« 19G » redevient « IgG »', () => {
    expect(corrigerNomParCatalogue('19G', exact).toLowerCase()).toBe('igg');
  });
  it('un nom déjà connu contenant un chiffre n’est jamais modifié', () => {
    expect(corrigerNomParCatalogue('C3', exact)).toBe('C3');
  });
  it('un nom inconnu sans variante connue reste tel quel', () => {
    expect(corrigerNomParCatalogue('X42Z', exact)).toBe('X42Z');
  });
});

describe('filets du tableau', () => {
  it('efface un trait vertical haut, garde un caractère', () => {
    const W = 6, H = 30;
    const encre = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) encre[y * W] = 1;          // filet en x = 0
    for (let y = 10; y < 20; y++) encre[y * W + 3] = 1;    // « 1 » de 10 px
    const c = effacerFilets({ largeur: W, hauteur: H, encre }, 10);
    expect([...Array(H).keys()].some(y => c.encre[y * W])).toBe(false);
    expect(c.encre[15 * W + 3]).toBe(1);
  });
});
