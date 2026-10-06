import { describe, it, expect } from 'vitest';
import { validerEtude } from './validation';
import type { StudyState } from './types';

const vide = (): StudyState => ({
  version: 1, patientLabel: '', parameters: [], measurements: [], treatments: [], annotations: [], extraDates: [],
  settings: { chartMode: 'stacked', title: '', subtitle: '', showReference: true, showLegend: true, showValues: false, timeAxis: true, markOutOfRange: true, fromDate: null, toDate: null },
});

describe('validerEtude', () => {
  it('refuse ce qui n’est pas un suivi', () => {
    expect(validerEtude(null, vide())).toBeNull();
    expect(validerEtude([], vide())).toBeNull();
    expect(validerEtude({ parameters: 'x' }, vide())).toBeNull();
  });

  it('garde un suivi bien formé à l’identique', () => {
    const e: StudyState = {
      ...vide(), patientLabel: 'Cas 12',
      parameters: [{ id: 'p1', name: 'CRP', unit: 'mg/L', category: 'biologie', refLow: null, refHigh: 5, color: '#c00', order: 0, panelGroup: null }],
      measurements: [{ id: 'm1', parameterId: 'p1', date: '2025-01-10', value: 3, qualifier: '<' }],
      treatments: [{ id: 't1', name: 'Prednisone', kind: 'continuous', start: '2025-01-01', end: null, color: null, order: 0, dosePoints: [{ date: '2025-01-01', dose: 60 }] }],
      annotations: [{ id: 'a1', date: '2025-01-05', text: 'Bolus', order: 0 }],
      extraDates: ['2025-02-01'],
    };
    expect(validerEtude(JSON.parse(JSON.stringify(e)), vide())).toEqual(e);
  });

  it('écarte les éléments mal formés et les clés inconnues', () => {
    const r = validerEtude({
      parameters: [{ id: 'p1', name: 'CRP', category: 'piège', color: 'red" onload="x', inconnu: 1 }, { name: 'sans id' }],
      measurements: [
        { id: 'm1', parameterId: 'p1', date: '2025-01-10', value: '12' },
        { id: 'm2', parameterId: 'absent', date: '2025-01-10', value: 1 },
        { id: 'm3', parameterId: 'p1', date: '10/01/2025', value: 1 },
        { id: 'm4', parameterId: 'p1', date: '2025-01-11', value: 4, qualifier: 'x' },
      ],
      settings: { chartMode: 'autre', showLegend: 'oui', title: 'T' },
      __proto__piege: {},
    }, vide())!;
    expect(r.parameters).toHaveLength(1);
    expect(r.parameters[0]).not.toHaveProperty('inconnu');
    expect(r.parameters[0].category).toBe('libre');
    expect(r.parameters[0].color).toBeNull();
    expect(r.measurements.map(m => m.id)).toEqual(['m4']);
    expect(r.measurements[0].qualifier).toBeNull();
    expect(r.settings.chartMode).toBe('stacked');
    expect(r.settings.showLegend).toBe(true);
    expect(r.settings.title).toBe('T');
  });
});
