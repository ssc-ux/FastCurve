// @vitest-environment jsdom
// Le store porte l'historique, la persistance, la fusion des dates et
// l'étanchéité des dossiers — et n'avait aucun test. C'était le principal
// angle mort de la couverture.
import { describe, it, expect, beforeEach, vi } from 'vitest';

async function neufStore() {
  localStorage.clear();
  // Le store est un singleton : on vide le registre de modules pour repartir
  // d'une instance neuve à chaque test.
  vi.resetModules();
  const mod = await import('./store.svelte');
  return mod.store;
}

describe('store — mesures et seuils', () => {
  let store: Awaited<ReturnType<typeof neufStore>>;
  beforeEach(async () => { store = await neufStore(); });

  it('enregistre une valeur et son seuil de détection', () => {
    const p = store.addParameter({ name: 'CRP', unit: 'mg/L', category: 'biologie' });
    store.setMeasurement(p.id, '2025-01-10', 5, '<');
    const m = store.valueAt(p.id, '2025-01-10')!;
    expect(m.value).toBe(5);
    expect(m.qualifier).toBe('<');
  });

  it('supprime la mesure quand la valeur est nulle', () => {
    const p = store.addParameter({ name: 'CRP', unit: 'mg/L', category: 'biologie' });
    store.setMeasurement(p.id, '2025-01-10', 12);
    store.setMeasurement(p.id, '2025-01-10', null);
    expect(store.valueAt(p.id, '2025-01-10')).toBeUndefined();
  });

  it('affiche l’unité déclarée, y compris pour un EFR', () => {
    const p = store.addParameter({ name: 'CVF', unit: 'L', category: 'efr' });
    expect(p.display).toBe('absolute');
  });
});

describe('store — moveDate et collisions', () => {
  let store: Awaited<ReturnType<typeof neufStore>>;
  beforeEach(async () => { store = await neufStore(); });

  it('déplace les mesures sans perte quand la cible est libre', () => {
    const p = store.addParameter({ name: 'CRP', unit: 'mg/L', category: 'biologie' });
    store.setMeasurement(p.id, '2025-01-10', 12);
    const perdues = store.moveDate('2025-01-10', '2025-02-10');
    expect(perdues).toBe(0);
    expect(store.valueAt(p.id, '2025-02-10')!.value).toBe(12);
    expect(store.valueAt(p.id, '2025-01-10')).toBeUndefined();
  });

  it('signale les mesures écrasées par une collision', () => {
    const a = store.addParameter({ name: 'CRP', unit: 'mg/L', category: 'biologie' });
    const b = store.addParameter({ name: 'Créatinine', unit: 'µmol/L', category: 'biologie' });
    store.setMeasurement(a.id, '2025-02-04', 34);
    store.setMeasurement(b.id, '2025-02-04', 132);
    store.setMeasurement(a.id, '2025-02-11', 12);
    store.setMeasurement(b.id, '2025-02-11', 118);
    const perdues = store.moveDate('2025-02-04', '2025-02-11');
    expect(perdues).toBe(2);                       // 34 et 132 écrasées
    expect(store.valueAt(a.id, '2025-02-11')!.value).toBe(12);
    expect(store.valueAt(b.id, '2025-02-11')!.value).toBe(118);
    expect(store.study.measurements).toHaveLength(2);
  });

  it('l’annulation restaure les mesures écrasées', () => {
    const a = store.addParameter({ name: 'CRP', unit: 'mg/L', category: 'biologie' });
    store.setMeasurement(a.id, '2025-02-04', 34);
    store.setMeasurement(a.id, '2025-02-11', 12);
    store.moveDate('2025-02-04', '2025-02-11');
    expect(store.study.measurements).toHaveLength(1);
    store.undo();
    expect(store.study.measurements).toHaveLength(2);
    expect(store.valueAt(a.id, '2025-02-04')!.value).toBe(34);
  });
});

describe('store — historique', () => {
  let store: Awaited<ReturnType<typeof neufStore>>;
  beforeEach(async () => { store = await neufStore(); });

  it('annule et rétablit une suite de modifications sur des cellules distinctes', () => {
    const p = store.addParameter({ name: 'CRP', unit: 'mg/L', category: 'biologie' });
    const dates = ['2025-01-10', '2025-02-10', '2025-03-10', '2025-04-10', '2025-05-10'];
    dates.forEach((d, i) => store.setMeasurement(p.id, d, (i + 1) * 10));
    expect(store.study.measurements).toHaveLength(5);
    for (let i = 0; i < 3; i++) store.undo();
    expect(store.study.measurements).toHaveLength(2);
    store.redo();
    expect(store.study.measurements).toHaveLength(3);
  });

  it('taper plusieurs caractères dans UNE cellule ne fait qu’un point d’annulation', () => {
    // Sans regroupement, enregistrer au fil de la frappe ferait revenir Ctrl+Z
    // caractère par caractère : « 4242 » demanderait quatre annulations.
    const p = store.addParameter({ name: 'CRP', unit: 'mg/L', category: 'biologie' });
    const avant = store.history.length;
    for (const v of [4, 42, 424, 4242]) store.setMeasurement(p.id, '2025-01-10', v);
    expect(store.history.length - avant).toBe(1);
    expect(store.valueAt(p.id, '2025-01-10')!.value).toBe(4242);
    store.undo();
    expect(store.valueAt(p.id, '2025-01-10')).toBeUndefined();
  });

  it('deux cellules différentes font deux points d’annulation', () => {
    const p = store.addParameter({ name: 'CRP', unit: 'mg/L', category: 'biologie' });
    const avant = store.history.length;
    store.setMeasurement(p.id, '2025-01-10', 1);
    store.setMeasurement(p.id, '2025-02-10', 2);
    expect(store.history.length - avant).toBe(2);
  });

  it('toute nouvelle action invalide le rétablissement', () => {
    const p = store.addParameter({ name: 'CRP', unit: 'mg/L', category: 'biologie' });
    store.setMeasurement(p.id, '2025-01-10', 10);
    store.undo();
    expect(store.canRedo).toBe(true);
    store.setMeasurement(p.id, '2025-01-10', 99);
    expect(store.canRedo).toBe(false);
  });

  it('l’historique est plafonné sans casser l’annulation', () => {
    const p = store.addParameter({ name: 'CRP', unit: 'mg/L', category: 'biologie' });
    for (let i = 0; i < 150; i++) {
      const d = new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10);
      store.setMeasurement(p.id, d, i);
    }
    expect(store.history.length).toBeLessThanOrEqual(100);
    for (let i = 0; i < 200; i++) store.undo();
    expect(store.canUndo).toBe(false);
  });
});

describe('store — document unique', () => {
  let store: Awaited<ReturnType<typeof neufStore>>;
  beforeEach(async () => { store = await neufStore(); });

  it('« Nouveau » repart d’un document vierge', () => {
    const a = store.addParameter({ name: 'CRP', unit: 'mg/L', category: 'biologie' });
    store.setMeasurement(a.id, '2025-01-10', 12);
    store.nouvelleEtude();
    expect(store.study.parameters).toHaveLength(0);
    expect(store.study.measurements).toHaveLength(0);
  });

  it('le document est retrouvé au redémarrage du navigateur', async () => {
    const a = store.addParameter({ name: 'CRP', unit: 'mg/L', category: 'biologie' });
    store.setMeasurement(a.id, '2025-01-10', 12);
    // Nouveau chargement de l'application, sans vider le stockage.
    vi.resetModules();
    const relance = (await import('./store.svelte')).store;
    expect(relance.study.parameters.map(p => p.name)).toEqual(['CRP']);
    expect(relance.valueAt(relance.study.parameters[0].id, '2025-01-10')!.value).toBe(12);
  });

  it('reprend l’ancien stockage multi-dossiers sans rien perdre', async () => {
    localStorage.clear();
    const ancien = {
      version: 1, patientLabel: 'Cas ancien', parameters: [
        { id: 'x', name: 'CRP', unit: 'mg/L', category: 'biologie', refLow: 0, refHigh: 5, display: 'absolute', color: '#2a78d6', order: 0 },
      ],
      measurements: [{ id: 'm', parameterId: 'x', date: '2024-06-01', value: 42 }],
      treatments: [], annotations: [], extraDates: [],
      settings: { chartMode: 'stacked', title: 'T', subtitle: '', showReference: true, showLegend: true, showValues: false, timeAxis: true, markOutOfRange: true },
    };
    localStorage.setItem('fastcurve.dossier.vieux', JSON.stringify(ancien));
    localStorage.setItem('fastcurve.dossiers.v1', JSON.stringify([{ id: 'vieux', name: 'Cas ancien', updatedAt: 1 }]));
    localStorage.setItem('fastcurve.current.v1', 'vieux');
    vi.resetModules();
    const repris = (await import('./store.svelte')).store;
    expect(repris.study.patientLabel).toBe('Cas ancien');
    expect(repris.study.measurements).toHaveLength(1);
    // L'ancien stockage est nettoyé après reprise.
    expect(localStorage.getItem('fastcurve.dossiers.v1')).toBeNull();
  });

  it('l’export puis l’ouverture du fichier restituent le suivi à l’identique', () => {
    const p = store.addParameter({ name: 'CRP', unit: 'mg/L', category: 'biologie' });
    store.setMeasurement(p.id, '2025-01-10', 5, '<');
    store.addTreatment({ name: 'Prednisone', start: '2025-01-10', dose: '20 mg/j' });
    const json = store.exportJSON();
    const avant = JSON.parse(JSON.stringify(store.study));
    expect(store.importJSON(json)).toBe(true);
    expect(store.study.measurements).toEqual(avant.measurements);
    expect(store.study.treatments.map((t: { name: string }) => t.name))
      .toEqual(avant.treatments.map((t: { name: string }) => t.name));
  });

  it('refuse un fichier illisible sans casser le suivi en cours', () => {
    const p = store.addParameter({ name: 'CRP', unit: 'mg/L', category: 'biologie' });
    store.setMeasurement(p.id, '2025-01-10', 12);
    expect(store.importJSON('ceci n’est pas du JSON')).toBe(false);
    expect(store.valueAt(p.id, '2025-01-10')!.value).toBe(12);
  });
});

describe('store — colonnes de dates', () => {
  let store: Awaited<ReturnType<typeof neufStore>>;
  beforeEach(async () => { store = await neufStore(); });

  it('une colonne vide persiste puis disparaît une fois remplie ailleurs', () => {
    const p = store.addParameter({ name: 'CRP', unit: 'mg/L', category: 'biologie' });
    store.addDateColumn('2025-03-01');
    expect(store.columnDates).toContain('2025-03-01');
    store.setMeasurement(p.id, '2025-03-01', 7);
    expect(store.columnDates.filter(d => d === '2025-03-01')).toHaveLength(1);
  });

  it('supprimer une colonne efface ses mesures', () => {
    const p = store.addParameter({ name: 'CRP', unit: 'mg/L', category: 'biologie' });
    store.setMeasurement(p.id, '2025-01-10', 12);
    store.setMeasurement(p.id, '2025-02-10', 8);
    store.removeDateColumn('2025-01-10');
    expect(store.columnDates).toEqual(['2025-02-10']);
    expect(store.study.measurements).toHaveLength(1);
  });

  it('les colonnes sont toujours triées chronologiquement', () => {
    const p = store.addParameter({ name: 'CRP', unit: 'mg/L', category: 'biologie' });
    store.setMeasurement(p.id, '2025-05-10', 3);
    store.setMeasurement(p.id, '2025-01-10', 1);
    store.setMeasurement(p.id, '2025-03-10', 2);
    expect(store.columnDates).toEqual(['2025-01-10', '2025-03-10', '2025-05-10']);
  });
});

// ── Index des mesures : l'accélération ne doit jamais rendre de valeur périmée ──
describe('index de valueAt', () => {
  it('voit une valeur écrite après une première lecture', async () => {
    const store = await neufStore();
    const p = store.addParameter({ name: 'CRP', unit: 'mg/L' });
    expect(store.valueAt(p.id, '2025-01-10')).toBeUndefined(); // amorce l'index
    store.setMeasurement(p.id, '2025-01-10', 42);
    expect(store.valueAt(p.id, '2025-01-10')?.value).toBe(42);
  });

  it('voit une valeur modifiée en place', async () => {
    const store = await neufStore();
    const p = store.addParameter({ name: 'CRP', unit: 'mg/L' });
    store.setMeasurement(p.id, '2025-01-10', 42);
    expect(store.valueAt(p.id, '2025-01-10')?.value).toBe(42);
    store.setMeasurement(p.id, '2025-01-10', 7); // écrit en place, la référence ne bouge pas
    expect(store.valueAt(p.id, '2025-01-10')?.value).toBe(7);
  });

  it('voit une valeur effacée', async () => {
    const store = await neufStore();
    const p = store.addParameter({ name: 'CRP', unit: 'mg/L' });
    store.setMeasurement(p.id, '2025-01-10', 42);
    expect(store.valueAt(p.id, '2025-01-10')).toBeDefined();
    store.setMeasurement(p.id, '2025-01-10', null);
    expect(store.valueAt(p.id, '2025-01-10')).toBeUndefined();
  });

  it('revient en arrière avec Annuler', async () => {
    const store = await neufStore();
    const p = store.addParameter({ name: 'CRP', unit: 'mg/L' });
    store.setMeasurement(p.id, '2025-01-10', 42);
    expect(store.valueAt(p.id, '2025-01-10')?.value).toBe(42);
    store.undo(); // remplace l'étude entière : c'est la référence qui invalide
    expect(store.valueAt(p.id, '2025-01-10')).toBeUndefined();
  });

  it('suit un déplacement de date', async () => {
    const store = await neufStore();
    const p = store.addParameter({ name: 'CRP', unit: 'mg/L' });
    store.setMeasurement(p.id, '2025-01-10', 42);
    expect(store.valueAt(p.id, '2025-01-10')?.value).toBe(42);
    store.moveDate('2025-01-10', '2025-02-20');
    expect(store.valueAt(p.id, '2025-01-10')).toBeUndefined();
    expect(store.valueAt(p.id, '2025-02-20')?.value).toBe(42);
  });

  it('suit l’ouverture d’un fichier importé', async () => {
    const store = await neufStore();
    const p = store.addParameter({ name: 'CRP', unit: 'mg/L' });
    store.setMeasurement(p.id, '2025-01-10', 42);
    expect(store.valueAt(p.id, '2025-01-10')?.value).toBe(42);
    const autre = JSON.parse(store.exportJSON());
    autre.measurements = [];
    expect(store.importJSON(JSON.stringify(autre))).toBe(true);
    expect(store.valueAt(p.id, '2025-01-10')).toBeUndefined();
  });
});

describe('store — groupParameterWith (panneaux groupés)', () => {
  let store: Awaited<ReturnType<typeof neufStore>>;
  beforeEach(async () => { store = await neufStore(); });

  it("n'a pas de groupe par défaut", () => {
    const p = store.addParameter({ name: 'CRP', unit: 'mg/L', category: 'biologie' });
    expect(p.panelGroup ?? null).toBeNull();
  });

  it('rejoint le groupe du paramètre cible', () => {
    const a = store.addParameter({ name: 'CRP', unit: 'mg/L', category: 'biologie' });
    const b = store.addParameter({ name: 'Créatinine', unit: 'µmol/L', category: 'biologie' });
    store.groupParameterWith(a.id, b.id);
    const [ra, rb] = [
      store.study.parameters.find(p => p.id === a.id)!,
      store.study.parameters.find(p => p.id === b.id)!,
    ];
    expect(ra.panelGroup).toBeTruthy();
    expect(ra.panelGroup).toBe(rb.panelGroup);
  });

  it('un troisième paramètre peut rejoindre un groupe existant', () => {
    const a = store.addParameter({ name: 'CRP', unit: 'mg/L', category: 'biologie' });
    const b = store.addParameter({ name: 'Créatinine', unit: 'µmol/L', category: 'biologie' });
    const c = store.addParameter({ name: 'Hémoglobine', unit: 'g/dL', category: 'biologie' });
    store.groupParameterWith(a.id, b.id);
    store.groupParameterWith(c.id, a.id);
    const cles = [a, b, c].map(p => store.study.parameters.find(x => x.id === p.id)!.panelGroup);
    expect(new Set(cles).size).toBe(1);
  });

  it('quitte son groupe quand on choisit « panneau séparé » (targetId null)', () => {
    const a = store.addParameter({ name: 'CRP', unit: 'mg/L', category: 'biologie' });
    const b = store.addParameter({ name: 'Créatinine', unit: 'µmol/L', category: 'biologie' });
    store.groupParameterWith(a.id, b.id);
    store.groupParameterWith(a.id, null);
    expect(store.study.parameters.find(p => p.id === a.id)!.panelGroup ?? null).toBeNull();
    // b garde sa clé de groupe (désormais seul dedans) : sans effet visuel.
  });

  it('est réversible par undo, comme les autres modifications de paramètre', () => {
    const a = store.addParameter({ name: 'CRP', unit: 'mg/L', category: 'biologie' });
    const b = store.addParameter({ name: 'Créatinine', unit: 'µmol/L', category: 'biologie' });
    store.groupParameterWith(a.id, b.id);
    expect(store.study.parameters.find(p => p.id === a.id)!.panelGroup).toBeTruthy();
    store.undo();
    expect(store.study.parameters.find(p => p.id === a.id)!.panelGroup ?? null).toBeNull();
  });
});
