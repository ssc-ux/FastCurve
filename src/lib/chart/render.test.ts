import { describe, it, expect } from 'vitest';
import { renderChart, largeurTexte } from './render';
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

// ── Outils d'inspection géométrique du SVG rendu ──────────────

/** Rectangles du SVG, sous forme numérique. */
function rects(svg: string) {
  return [...svg.matchAll(/<rect x="([-\d.]+)" y="([-\d.]+)" width="([-\d.]+)" height="([-\d.]+)"([^>]*)\/>/g)]
    .map(m => ({ x: +m[1], y: +m[2], w: +m[3], h: +m[4], reste: m[5] }));
}
/** Ordonnées extrêmes atteintes par les tracés d'une couleur donnée. */
function etendueY(svg: string, couleur: string) {
  let min = Infinity, max = -Infinity;
  const noter = (v: number) => { min = Math.min(min, v); max = Math.max(max, v); };
  for (const m of svg.matchAll(/<line x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)" stroke="([^"]+)"/g)) {
    if (m[5] === couleur) { noter(+m[2]); noter(+m[4]); }
  }
  for (const m of svg.matchAll(/<polygon points="([^"]+)" fill="([^"]+)"/g)) {
    if (m[2] !== couleur) continue;
    for (const p of m[1].trim().split(/\s+/)) noter(+p.split(',')[1]);
  }
  return { min, max };
}

function etudeSimple(params: StudyState['parameters'], mesures: StudyState['measurements']): StudyState {
  return {
    version: 1, patientLabel: '', parameters: params, measurements: mesures,
    treatments: [], annotations: [], extraDates: [],
    settings: {
      chartMode: 'stacked', title: '', subtitle: '', showReference: true,
      showLegend: false, showValues: false, timeAxis: true, markOutOfRange: false,
    },
  };
}

describe('renderChart — bande de normale bornée au panneau', () => {
  // Régression : une CRP dont la normale (< 5) tombait hors de l'échelle
  // (panneau gradué de 60 à 160) faisait peindre la bande SOUS l'axe, donc
  // par-dessus le panneau voisin : on y lisait une plage « normale » qui
  // n'avait rien à voir avec le paramètre affiché.
  const etude = etudeSimple(
    [
      { id: 'p1', name: 'CRP', unit: 'mg/L', category: 'biologie', refHigh: 5, color: '#2a78d6', order: 0 },
      { id: 'p2', name: 'Créatinine', unit: 'µmol/L', category: 'biologie', refLow: 45, refHigh: 90, color: '#e34948', order: 1 },
    ],
    [
      { id: 'm1', parameterId: 'p1', date: '2025-01-06', value: 148 },
      { id: 'm2', parameterId: 'p1', date: '2025-02-06', value: 71 },
      { id: 'm3', parameterId: 'p2', date: '2025-01-06', value: 245 },
      { id: 'm4', parameterId: 'p2', date: '2025-02-06', value: 165 },
    ],
  );

  it('ne peint aucune bande de normale hors du panneau qui la porte', () => {
    const svg = renderChart(etude, 920).svg;
    const bandes = rects(svg).filter(r => r.reste.includes('#f0f4f8'));
    // Une seule bande légitime : celle de la créatinine (45–90 est dans son
    // échelle). Celle de la CRP est hors échelle, donc rien.
    expect(bandes).toHaveLength(1);
    // Elle ne mord pas sur le panneau du dessus : les repères Y de la
    // créatinine encadrent la bande.
    const axes = [...svg.matchAll(/<line x1="66" y1="([-\d.]+)" x2="66" y2="([-\d.]+)"/g)].map(m => [+m[1], +m[2]]);
    const panneau2 = axes[1];
    expect(bandes[0].y).toBeGreaterThanOrEqual(panneau2[0] - 0.01);
    expect(bandes[0].y + bandes[0].h).toBeLessThanOrEqual(panneau2[1] + 0.01);
  });
});

describe('renderChart — flèches de seuil de détection', () => {
  function etudeSeuil(valeur: number, q: '<' | '>', hautes: number[]): StudyState {
    return etudeSimple(
      [{ id: 'p1', name: 'Anticorps', unit: 'UI/mL', category: 'biologie', color: '#2a78d6', order: 0 }],
      [
        ...hautes.map((v, i) => ({ id: 'h' + i, parameterId: 'p1', date: `2025-0${i + 1}-06`, value: v })),
        { id: 'q', parameterId: 'p1', date: '2025-06-06', value: valeur, qualifier: q },
      ],
    );
  }

  it('ne laisse pas la flèche « < » déborder sous le panneau', () => {
    // Régression : une longueur plancher de 6 px était imposée avant de
    // regarder la place restante ; la flèche mordait sur le panneau voisin.
    const svg = renderChart(etudeSeuil(3, '<', [180, 90, 60]), 920).svg;
    const axeBas = Math.max(...[...svg.matchAll(/<line x1="66" y1="([-\d.]+)" x2="66" y2="([-\d.]+)"/g)].map(m => +m[2]));
    expect(etendueY(svg, '#2a78d6').max).toBeLessThanOrEqual(axeBas + 0.01);
  });

  it('ne laisse pas la flèche « > » déborder au-dessus du panneau', () => {
    const svg = renderChart(etudeSeuil(1000, '>', [400, 820, 1000]), 920).svg;
    const axeHaut = Math.min(...[...svg.matchAll(/<line x1="66" y1="([-\d.]+)" x2="66" y2="([-\d.]+)"/g)].map(m => +m[1]));
    expect(etendueY(svg, '#2a78d6').min).toBeGreaterThanOrEqual(axeHaut - 0.01);
  });

  it('écrit toujours le qualificatif quand la flèche ne tient pas', () => {
    // Sans cela « <3 » se lirait « 3 » : l'information de seuil disparaîtrait
    // complètement dès que les valeurs ne sont pas affichées.
    const svg = renderChart(etudeSeuil(1000, '>', [400, 820, 1000]), 920).svg;
    expect(svg).toContain('>1000</text>');
  });
});

describe('renderChart — graphe unique : axes honnêtes', () => {
  const noms = ['CRP', 'Créatinine', 'Hémoglobine', 'Plaquettes', 'Albumine'];
  const unites = ['mg/L', 'µmol/L', 'g/dL', 'G/L', 'g/L'];
  const sommets = [148, 245, 11.8, 400, 34];
  const etude: StudyState = {
    ...etudeSimple(
      noms.map((n, i) => ({ id: 'p' + i, name: n, unit: unites[i], category: 'biologie' as const, color: '#2a78d6', order: i })),
      noms.flatMap((_, i) => [
        { id: `a${i}`, parameterId: 'p' + i, date: '2025-01-06', value: sommets[i] },
        { id: `b${i}`, parameterId: 'p' + i, date: '2025-02-06', value: sommets[i] * 0.6 },
      ]),
    ),
    settings: {
      chartMode: 'single', title: '', subtitle: '', showReference: false,
      showLegend: true, showValues: false, timeAxis: true, markOutOfRange: false,
    },
  };

  it('n’étiquette jamais un axe avec une liste d’unités', () => {
    // Régression : l'axe gauche s'intitulait « mg/L · g/dL · G/L · g/L », une
    // phrase tournée à 90°, plus haute que le graphique, et fausse.
    const svg = renderChart(etude, 920).svg;
    expect(svg).not.toContain('·');
  });

  it('porte l’unité sur chaque entrée de légende', () => {
    // Sans elle, rien ne dit dans quelle unité se lit une courbe donnée.
    const svg = renderChart(etude, 920).svg;
    expect(svg).toContain('Créatinine (µmol/L)');
    expect(svg).toContain('Hémoglobine (g/dL)');
  });

  it('sépare les axes par ordre de grandeur, pas par ordre d’apparition', () => {
    // Régression : la créatinine partait seule à droite parce qu'elle portait
    // la deuxième unité rencontrée, et l'hémoglobine restait écrasée à gauche
    // sur une échelle de 0 à 500.
    const svg = renderChart(etude, 920).svg;
    const cote = (nom: string) => {
      const m = new RegExp(`>${nom} \\([^)]*\\) (←|→)<`).exec(svg);
      return m![1];
    };
    expect(cote('Plaquettes')).toBe('←');
    expect(cote('Créatinine')).toBe('←');
    expect(cote('Hémoglobine')).toBe('→');
    expect(cote('Albumine')).toBe('→');
  });

  it('garde un seul axe quand tout tient dans le même ordre de grandeur', () => {
    const proches: StudyState = {
      ...etude,
      parameters: etude.parameters.slice(0, 2),
      measurements: etude.measurements.filter(m => m.parameterId === 'p0' || m.parameterId === 'p1'),
    };
    // Un deuxième axe est une charge de lecture : on ne l'impose pas pour un
    // facteur 1,7 entre CRP et créatinine.
    expect(renderChart(proches, 920).svg).not.toContain('→');
  });

  it('distingue par le trait au-delà de six séries', () => {
    // Huit teintes, six formes : à la septième série deux courbes deviennent
    // jumelles — et en noir et blanc, dès la première.
    const douze: StudyState = {
      ...etude,
      parameters: Array.from({ length: 12 }, (_, i) => ({
        id: 'q' + i, name: 'P' + i, unit: 'mg/L', category: 'biologie' as const, color: '#2a78d6', order: i,
      })),
      measurements: Array.from({ length: 12 }, (_, i) => ({
        id: 'z' + i, parameterId: 'q' + i, date: '2025-01-06', value: 10 + i,
      })),
    };
    expect(renderChart(douze, 920).svg).toContain('stroke-dasharray');
    expect(renderChart(etude, 920).svg).not.toContain('stroke-dasharray');
  });
});

describe('renderChart — marge gauche et graduations', () => {
  const avecValeurs = (valeurs: number[], unite: string) => etudeSimple(
    [{ id: 'p1', name: 'Analyte', unit: unite, category: 'biologie', color: '#2a78d6', order: 0 }],
    valeurs.map((v, i) => ({ id: 'm' + i, parameterId: 'p1', date: `2025-0${i + 1}-06`, value: v })),
  );
  const axeY = (svg: string) => +/<line x1="(\d+)" y1="[-\d.]+" x2="\1"/.exec(svg)![1];

  it('élargit la marge quand les graduations sont longues', () => {
    // Régression : la marge valait 66 px quoi qu'il arrive, et « 1 500 000 »
    // (charge virale, plaquettes par mm³) sortait du cadre par la gauche.
    const etroit = renderChart(avecValeurs([148, 92, 31], 'mg/L'), 920).svg;
    const large = renderChart(avecValeurs([1250000, 840000, 320000], 'copies/mL'), 920).svg;
    expect(axeY(etroit)).toBe(66);
    expect(axeY(large)).toBeGreaterThan(66);
    // La graduation la plus longue tient entièrement dans la marge.
    const gradMax = [...large.matchAll(/<text x="(\d+)" y="[-\d.]+" text-anchor="end"[^>]*>([^<]+)</g)]
      .map(m => largeurTexte(m[2], 10.5));
    expect(Math.max(...gradMax)).toBeLessThan(axeY(large) - 8);
  });

  it('garde des décimales homogènes sur un même axe', () => {
    // Un axe qui gradue « 2 » puis « 2,20 » se lit mal : le pas fixe le nombre
    // de décimales pour toutes les graduations.
    const svg = renderChart(avecValeurs([2.42, 2.38, 2.55], 'mmol/L'), 920).svg;
    const grads = [...svg.matchAll(/text-anchor="end"[^>]*>([^<]+)</g)].map(m => m[1]);
    const dec = new Set(grads.map(g => (g.split(',')[1] ?? '').length));
    expect(dec.size).toBe(1);
  });
});

describe('renderChart — densité des marqueurs', () => {
  it('rétrécit les marqueurs quand les points se serrent', () => {
    const mesure = (n: number) => etudeSimple(
      [{ id: 'p1', name: 'CRP', unit: 'mg/L', category: 'biologie', color: '#2a78d6', order: 0 }],
      Array.from({ length: n }, (_, i) => ({
        id: 'm' + i, parameterId: 'p1',
        date: new Date(Date.UTC(2025, 0, 6) + i * 7 * 86400000).toISOString().slice(0, 10),
        value: 100 + (i % 5),
      })),
    );
    const rayon = (svg: string) => +/<circle cx="[-\d.]+" cy="[-\d.]+" r="([\d.]+)"/.exec(svg)![1];
    // À 40 prélèvements, des marqueurs de 4 px se touchaient et la série
    // devenait un ruban continu.
    expect(rayon(renderChart(mesure(5), 920).svg)).toBe(4);
    expect(rayon(renderChart(mesure(40), 920).svg)).toBeLessThan(3.5);
  });
});
