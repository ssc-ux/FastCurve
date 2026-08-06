import { describe, it, expect } from 'vitest';
import { renderChart } from './render';
import type { StudyState, Treatment } from '../models/types';

function studyWith(treatment: Treatment): StudyState {
  return {
    version: 1,
    patientLabel: '',
    parameters: [],
    measurements: [],
    treatments: [treatment],
    annotations: [],
    extraDates: [],
    settings: {
      chartMode: 'stacked',
      title: '',
      subtitle: '',
      showReference: true,
      showLegend: true,
      showValues: false,
      timeAxis: true,
      markOutOfRange: true,
    },
  };
}

const baseTraitement: Treatment = {
  id: 't1',
  name: 'Prednisone',
  kind: 'continuous',
  start: '2025-01-10',
  end: '2025-07-10',
  color: '#5b6472',
  order: 0,
};

describe('renderChart — bande des traitements', () => {
  it('dessine un coin quand les paliers portent des doses', () => {
    const svg = renderChart(studyWith({
      ...baseTraitement,
      dosePoints: [{ date: '2025-01-10', dose: 60 }, { date: '2025-07-10', dose: 0 }],
    })).svg;
    expect(svg).toContain('<polygon');
    expect(svg).toContain('>60<');
  });

  it('garde une barre pleine quand la décroissance est activée sans dose saisie', () => {
    // Toutes les doses à 0 : un coin serait de hauteur nulle et le traitement
    // disparaîtrait du graphique.
    const svg = renderChart(studyWith({
      ...baseTraitement,
      dosePoints: [{ date: '2025-01-10', dose: 0 }, { date: '2025-07-10', dose: 0 }],
    })).svg;
    expect(svg).not.toContain('<polygon');
    expect(svg).toContain('<rect');
    expect(svg).toContain('Prednisone');
  });

  it('dessine une barre pleine sans paliers', () => {
    const svg = renderChart(studyWith(baseTraitement)).svg;
    expect(svg).toContain('<rect');
    expect(svg).toContain('Prednisone');
  });
});

describe('renderChart — unité des paramètres EFR', () => {
  function etudeEfr(display: 'absolute' | 'percent'): StudyState {
    const base = studyWith({ ...baseTraitement, id: 'x', name: 'X', start: '2025-01-01', end: '2025-01-02' });
    return {
      ...base,
      treatments: [],
      parameters: [{ id: 'p1', name: 'CVF', unit: 'L', category: 'efr', display, color: '#2a78d6', order: 0 }],
      measurements: [
        { id: 'm1', parameterId: 'p1', date: '2025-01-01', value: 2.35 },
        { id: 'm2', parameterId: 'p1', date: '2025-06-01', value: 2.1 },
      ],
    };
  }

  it('affiche l’unité déclarée en mode valeur absolue', () => {
    // Régression : un CVF saisi en litres était étiqueté « % théo. ».
    expect(renderChart(etudeEfr('absolute'), 920).svg).toContain('CVF (L)');
  });

  it('affiche « % théo. » seulement si l’utilisateur le demande', () => {
    expect(renderChart(etudeEfr('percent'), 920).svg).toContain('CVF (% théo.)');
  });
});
