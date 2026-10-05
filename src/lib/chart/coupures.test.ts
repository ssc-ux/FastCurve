import { describe, expect, it } from 'vitest';
import { coupuresDeTemps, renderChart } from './render';
import { dayNumber } from '../models/types';
import type { StudyState } from '../models/types';

const j = (iso: string) => dayNumber(iso);

describe('coupure de l’axe du temps', () => {
  it('coupe un trou de six ans entre deux salves de prélèvements', () => {
    const jours = ['2020-01-27', '2020-01-28', '2020-01-29', '2020-01-30', '2020-02-14', '2020-03-24', '2026-09-28', '2026-09-29'].map(j);
    const c = coupuresDeTemps(jours);
    expect(c).toHaveLength(1);
    expect(c[0]).toEqual({ debut: j('2020-03-24'), fin: j('2026-09-28') });
  });

  it('ne coupe jamais un suivi régulier, même espacé (bilan annuel)', () => {
    expect(coupuresDeTemps(['2019-01-10', '2020-01-12', '2021-01-09', '2022-01-15'].map(j))).toEqual([]);
  });

  it('ne coupe pas un simple ralentissement du rythme', () => {
    expect(coupuresDeTemps(['2024-01-01', '2024-01-08', '2024-01-15', '2024-03-01', '2024-06-01'].map(j))).toEqual([]);
  });

  it('dessine « // » sur l’axe et ne relie pas la courbe en trait plein à travers le trou', () => {
    const dates = ['2020-01-27', '2020-01-28', '2020-01-30', '2020-03-24', '2026-09-28', '2026-09-29'];
    const study: StudyState = {
      version: 1, patientLabel: '',
      parameters: [{ id: 'p', name: 'Plaquettes', unit: 'G/L', category: 'biologie', color: '#2a78d6', order: 0 }],
      measurements: dates.map((date, i) => ({ id: 'm' + i, parameterId: 'p', date, value: 10 + i })),
      treatments: [], annotations: [], extraDates: [],
      settings: {
        chartMode: 'stacked', title: '', subtitle: '', showReference: false,
        showLegend: false, showValues: false, timeAxis: true, markOutOfRange: false,
      },
    } as StudyState;
    const { svg } = renderChart(study);
    // Un seul tracé, interrompu (deux « M ») : rien ne relie les deux salves.
    const trace = svg.match(/<path d="(M[^"]+)" fill="none" stroke="#2a78d6"/)![1];
    expect(trace.match(/M/g)).toHaveLength(2);
    // La salve de 2026 a sa propre date lisible.
    expect(svg).toMatch(/\d\d\/09\/2026/);
    // Sans axe proportionnel au temps, rien à couper.
    const regulier = renderChart({ ...study, settings: { ...study.settings, timeAxis: false } });
    expect(regulier.svg.match(/<path d="(M[^"]+)" fill="none" stroke="#2a78d6"/)![1].match(/M/g)).toHaveLength(1);
  });
});
