// Invariants de fiabilité : des propriétés qui doivent tenir quel que soit le
// suivi. Elles sont rejouées sur les vingt états figés de `etats/`, plus des
// entrées volontairement hostiles (valeurs aberrantes, balises HTML dans les
// noms, collages malformés).
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderChart } from '../src/lib/chart/render';
import { parseGridPaste } from '../src/lib/text/gridPaste';
import { parseReport } from '../src/lib/text/reportParser';
import type { StudyState } from '../src/lib/models/types';

const ETATS = new URL('./etats/', import.meta.url).pathname;
const fichiers = readdirSync(ETATS).filter(f => /^s\d+[a-z]?\.json$/.test(f)).sort();
const etats = fichiers.map(f => ({ nom: f, etat: JSON.parse(readFileSync(join(ETATS, f), 'utf8')) as StudyState }));

describe('aller-retour JSON sans perte', () => {
  for (const { nom, etat } of etats) {
    it(nom, () => {
      const retour = JSON.parse(JSON.stringify(etat)) as StudyState;
      expect(retour).toEqual(etat);
      // Le rendu doit être identique, pas seulement la structure.
      expect(renderChart(retour, 920).svg).toBe(renderChart(etat, 920).svg);
    });
  }
});

describe('rendu déterministe', () => {
  it('50 rendus successifs du même état donnent le même SVG', () => {
    for (const { etat } of etats) {
      const ref = renderChart(etat, 920).svg;
      for (let i = 0; i < 50; i++) expect(renderChart(etat, 920).svg).toBe(ref);
    }
  });
});

describe('rendu indépendant de l’ordre de saisie', () => {
  for (const { nom, etat } of etats) {
    if (etat.measurements.length < 2) continue;
    it(nom, () => {
      const ref = renderChart(etat, 920).svg;
      // Mesures dans l'ordre inverse, traitements et annotations inversés aussi :
      // l'ordre d'insertion ne doit jamais transparaître dans le graphique.
      const melange: StudyState = {
        ...etat,
        measurements: [...etat.measurements].reverse(),
        treatments: [...etat.treatments].reverse(),
        annotations: [...(etat.annotations || [])].reverse(),
      };
      expect(renderChart(melange, 920).svg).toBe(ref);
    });
  }
});

// ── Robustesse fonctionnelle ─────────────────────────────────

function etudeAvec(nom: string, valeurs: number[]): StudyState {
  return {
    version: 1, patientLabel: '', extraDates: [],
    parameters: [{ id: 'p', name: nom, unit: 'x', category: 'libre', color: '#2a78d6', order: 0 }],
    measurements: valeurs.map((v, i) => ({ id: `m${i}`, parameterId: 'p', date: `2025-0${i + 1}-01`, value: v })),
    treatments: [], annotations: [],
    settings: {
      chartMode: 'stacked', title: 'T', subtitle: '', showReference: true,
      showLegend: true, showValues: true, timeAxis: true, markOutOfRange: true,
    },
  };
}

describe('valeurs aberrantes', () => {
  const cas: [string, number[]][] = [
    ['zéros', [0, 0, 0]],
    ['négatives', [-15, -3, -0.5]],
    ['très grandes', [1e9, 5e8, 1e7]],
    ['très petites', [0.0000001, 0.0000002, 0.0000003]],
    ['amplitude extrême', [0.001, 1e6, 12]],
    ['valeur unique répétée', [42, 42, 42]],
  ];
  for (const [nom, vals] of cas) {
    it(nom, () => {
      const svg = renderChart(etudeAvec('X', vals), 920).svg;
      expect(svg).not.toMatch(/NaN|Infinity|undefined/);
      expect(svg).toContain('</svg>');
    });
  }
});

describe('texte utilisateur échappé dans le SVG', () => {
  const hostiles = [
    '<script>alert(1)</script>',
    '"; DROP TABLE mesures; --',
    'a & b < c > d',
    "l'apostrophe \"guillemets\"",
    '😀 emoji ✚ symboles',
  ];
  for (const h of hostiles) {
    it(`nom de paramètre : ${h.slice(0, 24)}`, () => {
      const e = etudeAvec(h, [1, 2, 3]);
      const svg = renderChart(e, 920).svg;
      // Aucun élément ne doit être introduit par le texte utilisateur.
      expect(svg).not.toMatch(/<(script|img|iframe|foreignObject|a|b|i)\b/i);
      expect(svg).not.toMatch(/<[a-z]+[^>]*\son\w+\s*=/i);
      expect(svg).toContain('</svg>');
    });
  }

  it('titre, sous-titre, traitement, annotation et zone sont échappés', () => {
    const e = etudeAvec('P', [1, 2, 3]);
    e.settings.title = '<img src=x onerror=alert(1)>';
    e.settings.subtitle = '</text><script>x</script>';
    e.treatments = [{ id: 't', name: '<b>gras</b>', kind: 'continuous', start: '2025-01-01', end: '2025-03-01', color: '#555', order: 0 }];
    e.annotations = [{ id: 'a', date: '2025-02-01', text: '<svg onload=alert(1)>', order: 0 }];
    const svg = renderChart(e, 920).svg;
    // Les chaînes « onerror= » / « onload= » subsistent dans le TEXTE affiché,
    // mais échappées : ce qui compte est qu'aucune balise ni aucun attribut
    // d'événement ne soit réellement introduit dans le document SVG.
    expect(svg).not.toMatch(/<(script|img|iframe|foreignObject|b|i)\b/i);
    expect(svg).not.toMatch(/<[a-z]+[^>]*\son\w+\s*=/i);
    expect(svg).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(svg).toContain('&lt;b&gt;gras&lt;/b&gt;');
    expect(svg).toContain('&lt;svg onload=alert(1)&gt;');
  });

  it('un nom très long ne casse pas le rendu', () => {
    const svg = renderChart(etudeAvec('A'.repeat(300), [1, 2, 3]), 920).svg;
    expect(svg).toContain('</svg>');
    expect(svg).not.toMatch(/NaN/);
  });
});

describe('collages malformés', () => {
  const cas: [string, string][] = [
    ['colonnes décalées', 'A\t01/01/2025\t02/01/2025\nCRP\t12\nVS\t20\t30\t40'],
    ['lignes vides', 'A\t01/01/2025\n\nCRP\t12\n\n'],
    ['en-tête absent', 'CRP\t12\nVS\t20'],
    ['séparateurs mixtes', 'A  01/01/2025\nCRP\t12'],
    ['texte pur', 'ceci est une phrase sans aucun tableau'],
    ['une seule cellule', '42'],
    ['dates invalides', 'A\t31/02/2025\t99/99/9999\nCRP\t12\t13'],
  ];
  for (const [nom, texte] of cas) {
    it(nom, () => {
      const g = parseGridPaste(texte);
      // Soit refus explicite, soit grille cohérente — jamais d'incohérence interne.
      if (g) {
        for (const r of g.rows) {
          expect(r.values.length).toBe(g.dates.length);
          expect(r.qualifiers.length).toBe(g.dates.length);
        }
      }
      expect(() => parseGridPaste(texte)).not.toThrow();
    });
  }
});

describe('comptes-rendus dégénérés', () => {
  const cas = [
    '', '   ', 'a', 'MAJUSCULES SANS DOSE NI DATE',
    'X'.repeat(5000),
    'CELLCEPT CELLCEPT CELLCEPT 2 g/j mars 2023',
    '12/34/5678 : CORTANCYL 60 mg/j',
  ];
  for (const t of cas) {
    it(`ne jette pas : « ${t.slice(0, 30)} »`, () => {
      expect(() => parseReport(t)).not.toThrow();
      const list = parseReport(t);
      expect(Array.isArray(list)).toBe(true);
      for (const x of list) expect(typeof x.name).toBe('string');
    });
  }
});
