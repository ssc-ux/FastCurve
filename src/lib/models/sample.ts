import { store } from './store.svelte';

/** Charge un jeu de données de démonstration (vascularite, réponse au traitement). */
export function loadSample() {
  store.clearAll();
  store.updateSettings({
    title: 'Vascularite à ANCA — réponse au traitement',
    subtitle: 'Cas illustratif (données fictives)',
    chartMode: 'stacked',
    showReference: true,
  });
  store.setPatientLabel('Cas exemple');

  const crp = store.resolveParameter('CRP');
  const creat = store.resolveParameter('Créatinine');
  const mpo = store.resolveParameter('Anticorps anti-MPO');

  const data: Record<string, [string, number][]> = {
    [crp.id]: [['2026-01-10', 148], ['2026-01-24', 92], ['2026-02-14', 31], ['2026-03-14', 8], ['2026-04-18', 4]],
    [creat.id]: [['2026-01-10', 245], ['2026-01-24', 190], ['2026-02-14', 140], ['2026-03-14', 118], ['2026-04-18', 105]],
    [mpo.id]: [['2026-01-10', 180], ['2026-01-24', 120], ['2026-02-14', 60], ['2026-03-14', 25], ['2026-04-18', 12]],
  };
  for (const [pid, pts] of Object.entries(data)) {
    for (const [d, v] of pts) store.setMeasurement(pid, d, v);
  }

  store.addTreatment({
    name: 'Prednisone', kind: 'continuous', start: '2026-01-10', end: '2026-04-18',
    doseUnit: 'mg/j',
    dosePoints: [
      { date: '2026-01-10', dose: 60 },
      { date: '2026-01-24', dose: 40 },
      { date: '2026-02-14', dose: 20 },
      { date: '2026-03-14', dose: 10 },
      { date: '2026-04-18', dose: 5 },
    ],
  });
  store.addTreatment({ name: 'Rituximab', dose: '375 mg/m²', kind: 'event', start: '2026-01-11' });
  store.addTreatment({ name: 'Rituximab', dose: '', kind: 'event', start: '2026-01-18' });
  store.addTreatment({ name: 'Rituximab', dose: '', kind: 'event', start: '2026-01-25' });
  store.addTreatment({ name: 'Rituximab', dose: '', kind: 'event', start: '2026-02-01' });

  store.addAnnotation({ date: '2026-02-14', text: 'Biopsie rénale' });
}
