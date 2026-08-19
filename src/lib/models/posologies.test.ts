import { describe, it, expect } from 'vitest';
import { posologiesPour, ajouterJoursISO, datesDuSchema } from './posologies';

describe('posologiesPour', () => {
  it('retrouve les schémas via la DCI', () => {
    const s = posologiesPour('Rituximab');
    expect(s.length).toBe(2);
  });

  it('retrouve les mêmes schémas via le nom de marque', () => {
    const s = posologiesPour('MABTHERA');
    expect(s.map(x => x.libelle)).toEqual(posologiesPour('rituximab').map(x => x.libelle));
  });

  it('ignore la casse et les accents', () => {
    expect(posologiesPour('  ritUXImab ').length).toBeGreaterThan(0);
  });

  it("renvoie une liste vide pour un médicament sans schéma connu", () => {
    expect(posologiesPour('Doliprane')).toEqual([]);
    expect(posologiesPour('')).toEqual([]);
  });

  it('propose bien les deux schémas cités par le médecin pour le rituximab', () => {
    const s = posologiesPour('rituximab');
    expect(s.find(x => x.libelle.includes('J1, J15'))).toBeTruthy();
    expect(s.find(x => x.libelle.includes('375 mg/m²'))).toBeTruthy();
  });

  it('anifrolumab : un schéma mensuel continu (cité par le médecin)', () => {
    const s = posologiesPour('anifrolumab');
    expect(s).toHaveLength(1);
    expect(s[0].kind).toBe('continuous');
    expect(s[0].dose).toContain('300 mg');
  });

  it('distingue les deux protocoles de cyclophosphamide (Euro-Lupus vs NIH)', () => {
    const s = posologiesPour('cyclophosphamide');
    const euroLupus = s.find(x => x.libelle.includes('Euro-Lupus'));
    const nih = s.find(x => x.libelle.includes('NIH'));
    expect(euroLupus).toBeTruthy();
    expect(nih).toBeTruthy();
    expect(euroLupus!.dose).toBe('500 mg IV');
    expect(euroLupus!.joursSuivants).toEqual([14, 28, 42, 56, 70]);
    // Le protocole NIH ne génère pas de série de dates (nombre de cures variable).
    expect(nih!.joursSuivants).toBeUndefined();
  });
});

describe('ajouterJoursISO', () => {
  it('ajoute des jours simples', () => {
    expect(ajouterJoursISO('2024-01-01', 14)).toBe('2024-01-15');
  });

  it('franchit correctement un changement de mois', () => {
    expect(ajouterJoursISO('2024-01-25', 14)).toBe('2024-02-08');
  });

  it('gère une année bissextile', () => {
    expect(ajouterJoursISO('2024-02-20', 10)).toBe('2024-03-01');
  });
});

describe('datesDuSchema', () => {
  it("calcule J1 et J15 pour le schéma rituximab à deux prises", () => {
    const s = posologiesPour('rituximab').find(x => x.libelle.includes('J1, J15'))!;
    expect(datesDuSchema('2024-03-01', s)).toEqual(['2024-03-01', '2024-03-15']);
  });

  it('calcule les 4 dates hebdomadaires du schéma 375 mg/m²', () => {
    const s = posologiesPour('rituximab').find(x => x.libelle.includes('375 mg/m²'))!;
    expect(datesDuSchema('2024-03-01', s)).toEqual([
      '2024-03-01', '2024-03-08', '2024-03-15', '2024-03-22',
    ]);
  });

  it('calcule les 6 dates du protocole Euro-Lupus', () => {
    const s = posologiesPour('cyclophosphamide').find(x => x.libelle.includes('Euro-Lupus'))!;
    expect(datesDuSchema('2024-01-01', s)).toEqual([
      '2024-01-01', '2024-01-15', '2024-01-29', '2024-02-12', '2024-02-26', '2024-03-11',
    ]);
  });

  it('renvoie une seule date pour un schéma sans prise suivante', () => {
    const s = posologiesPour('anifrolumab')[0];
    expect(datesDuSchema('2024-05-05', s)).toEqual(['2024-05-05']);
  });
});
