// Le catalogue porte les normes de référence qui décident quels points sont
// entourés en rouge sur la courbe. Aucun test technique ne peut vérifier
// qu'une créatininémie normale va bien de 45 à 115 µmol/L — c'est le rôle de
// ces tests de figer les corrections apportées après audit médical, et de
// garantir que la structure du catalogue reste saine (pas de borne inversée,
// pas d'alias ambigu entre deux analytes).
import { describe, it, expect } from 'vitest';
import { CATALOG, matchCatalog, normalize } from './catalog';

describe('cohérence structurelle du catalogue', () => {
  it('refLow est toujours strictement inférieur à refHigh quand les deux sont définis', () => {
    for (const e of CATALOG) {
      if (e.refLow != null && e.refHigh != null) {
        expect(e.refLow, `${e.name} : refLow doit être < refHigh`).toBeLessThan(e.refHigh);
      }
    }
  });

  it('aucune borne négative (aucun analyte du catalogue n’a de normale sous zéro)', () => {
    for (const e of CATALOG) {
      if (e.refLow != null) expect(e.refLow, `${e.name} : refLow négatif`).toBeGreaterThanOrEqual(0);
      if (e.refHigh != null) expect(e.refHigh, `${e.name} : refHigh négatif`).toBeGreaterThanOrEqual(0);
    }
  });

  it('chaque entrée a un nom, une unité (éventuellement vide) et au moins un alias', () => {
    for (const e of CATALOG) {
      expect(e.name.trim().length, `entrée sans nom`).toBeGreaterThan(0);
      expect(typeof e.unit).toBe('string');
      expect(e.aliases.length, `${e.name} : aucun alias`).toBeGreaterThan(0);
    }
  });

  it('aucun nom d’analyte en double', () => {
    const noms = CATALOG.map(e => normalize(e.name));
    expect(new Set(noms).size).toBe(noms.length);
  });

  it('aucun alias partagé entre deux analytes différents (résolution ambiguë sinon)', () => {
    const parAlias = new Map<string, string[]>();
    for (const e of CATALOG) {
      for (const a of [e.name, ...e.aliases]) {
        const n = normalize(a);
        const porteurs = parAlias.get(n) ?? [];
        porteurs.push(e.name);
        parAlias.set(n, porteurs);
      }
    }
    const conflits: string[] = [];
    for (const [alias, porteurs] of parAlias) {
      const distincts = new Set(porteurs);
      if (distincts.size > 1) conflits.push(`« ${alias} » → ${[...distincts].join(' / ')}`);
    }
    expect(conflits, `alias ambigus détectés :\n${conflits.join('\n')}`).toEqual([]);
  });

  it('un même analyte n’a pas deux fois le même alias', () => {
    for (const e of CATALOG) {
      const normalises = e.aliases.map(normalize);
      expect(new Set(normalises).size, `${e.name} : alias en double`).toBe(normalises.length);
    }
  });
});

describe('matchCatalog — résolution des alias vers le bon analyte', () => {
  it('retrouve un analyte par son nom exact, insensible à la casse et aux accents', () => {
    expect(matchCatalog('créatinine')?.name).toBe('Créatinine');
    expect(matchCatalog('CREATININE')?.name).toBe('Créatinine');
    expect(matchCatalog('Hémoglobine')?.name).toBe('Hémoglobine');
  });

  it('résout les abréviations de labo courantes vers le bon analyte', () => {
    expect(matchCatalog('ASAT')?.name).toBe('ASAT');
    expect(matchCatalog('SGOT')?.name).toBe('ASAT');
    expect(matchCatalog('TGO')?.name).toBe('ASAT');
    expect(matchCatalog('ALAT')?.name).toBe('ALAT');
    expect(matchCatalog('TGP')?.name).toBe('ALAT');
    expect(matchCatalog('creat')?.name).toBe('Créatinine');
    expect(matchCatalog('Hb')?.name).toBe('Hémoglobine');
    expect(matchCatalog('CRP')?.name).toBe('CRP');
  });

  it('résout les alias corrigés (PNE, TNI) et non plus les anciens fautifs (PEO, TNC)', () => {
    expect(matchCatalog('PNE')?.name).toBe('Éosinophiles');
    expect(matchCatalog('peo')).toBeNull();
    expect(matchCatalog('TNI')?.name).toBe('Troponine');
    expect(matchCatalog('tnc')).toBeNull();
  });

  it('distingue VEMS, CVF et VEMS/CVF malgré leur proximité', () => {
    expect(matchCatalog('VEMS')?.name).toBe('VEMS');
    expect(matchCatalog('CVF')?.name).toBe('CVF');
    expect(matchCatalog('Tiffeneau')?.name).toBe('VEMS/CVF');
  });

  it('retourne null pour un nom inconnu (le médecin peut créer un paramètre libre)', () => {
    expect(matchCatalog('IgG4 sérique')).toBeNull();
    expect(matchCatalog('')).toBeNull();
  });
});

describe('bornes corrigées après audit médical', () => {
  it('Créatinine : 5-13 mg/L (unité du laboratoire du médecin, reconvertie depuis 45-115 µmol/L)', () => {
    const e = CATALOG.find(x => x.name === 'Créatinine')!;
    expect(e.unit).toBe('mg/L');
    expect(e.refLow).toBe(5);
    expect(e.refHigh).toBe(13);
  });

  it('Hémoglobine : 12-17 g/dL (union homme/femme, jamais g/L)', () => {
    const e = CATALOG.find(x => x.name === 'Hémoglobine')!;
    expect(e.unit).toBe('g/dL');
    expect(e.refLow).toBe(12);
    expect(e.refHigh).toBe(17);
  });

  it('Glycémie : borne haute à jeun relevée à 6.1 mmol/L (1,10 g/L)', () => {
    const e = CATALOG.find(x => x.name === 'Glycémie')!;
    expect(e.refHigh).toBe(6.1);
  });

  it('DFG renommé CKD-EPI et exprimé par 1,73 m² de surface corporelle', () => {
    const e = CATALOG.find(x => x.name === 'DFG (CKD-EPI)')!;
    expect(e.unit).toBe('mL/min/1.73m²');
    expect(e.aliases).toContain('mdrd');
  });

  it('paramètres sans « normale » de population : aucune borne inventée', () => {
    // Ces analytes n'ont pas de valeur de référence unique et fiable
    // (dépendance à l'âge, au sexe ou au kit du laboratoire) : l'absence de
    // borne est un choix, pas un oubli — cf. commentaires dans catalog.ts.
    for (const nom of ['VS', 'Procalcitonine', 'GGT', 'Troponine', 'NT-proBNP', 'BNP', 'CPK', 'LDL', 'HDL', 'PaO2', 'IgE totales', 'CH50']) {
      const e = CATALOG.find(x => x.name === nom)!;
      expect(e, `${nom} absent du catalogue`).toBeDefined();
      expect(e.refLow, `${nom} : borne basse inattendue`).toBeUndefined();
      expect(e.refHigh, `${nom} : borne haute inattendue`).toBeUndefined();
    }
  });
});

describe('analytes ajoutés lors de l’audit médical', () => {
  it('complète la NFS (Monocytes, Basophiles)', () => {
    expect(matchCatalog('monocytes')?.unit).toBe('G/L');
    expect(matchCatalog('basophiles')?.unit).toBe('G/L');
  });

  it('protéinurie des 24h', () => {
    const e = matchCatalog('proteinurie des 24h');
    expect(e?.unit).toBe('g/24h');
    expect(e?.refHigh).toBe(0.15);
  });

  it('facteur rhumatoïde et anticorps anti-CCP (bilan de polyarthrite)', () => {
    expect(matchCatalog('facteur rhumatoide')?.category).toBe('immunologie');
    expect(matchCatalog('anti-ccp')?.category).toBe('immunologie');
  });

  it('bilirubine conjuguée, distincte de la bilirubine totale', () => {
    expect(matchCatalog('bilirubine conjuguee')?.name).toBe('Bilirubine conjuguée');
    expect(matchCatalog('bilirubine totale')?.name).toBe('Bilirubine totale');
  });
});
