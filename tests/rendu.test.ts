// Non-régression du rendu : chaque fichier de `etats/` est un suivi complet figé
// (paramètres, mesures, traitements, réglages). On le rend et on compare une
// signature de structure du SVG — formes dessinées et textes — à sa référence.
// Toute modification de `render.ts` qui déplace un élément se voit ici.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { renderChart } from '../src/lib/chart/render';
import type { StudyState } from '../src/lib/models/types';

const DIR = new URL('./etats/', import.meta.url).pathname;
const REF = join(DIR, 'signatures.json');

/** Signature structurelle : formes dessinées + textes, indépendante des flottants. */
function signature(svg: string) {
  const balises: Record<string, number> = {};
  for (const m of svg.matchAll(/<([a-zA-Z]+)[\s>]/g)) {
    balises[m[1]] = (balises[m[1]] ?? 0) + 1;
  }
  const textes = [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map(m => m[1]);
  return { balises, textes };
}

const etats = readdirSync(DIR)
  .filter(f => /^s\d+[a-z]?\.json$/.test(f))
  .sort((a, b) => (parseInt(a.slice(1)) - parseInt(b.slice(1))) || a.localeCompare(b));

const refs: Record<string, ReturnType<typeof signature>> =
  existsSync(REF) ? JSON.parse(readFileSync(REF, 'utf8')) : {};
let ecrit = false;

describe('non-régression du rendu', () => {
  for (const f of etats) {
    it(f.replace('.json', ''), () => {
      const etat = JSON.parse(readFileSync(join(DIR, f), 'utf8')) as StudyState;
      const sig = signature(renderChart(etat, 920).svg);
      if (!refs[f]) { refs[f] = sig; ecrit = true; expect(sig.textes.length).toBeGreaterThan(0); return; }
      expect(sig.balises).toEqual(refs[f].balises);
      expect(sig.textes).toEqual(refs[f].textes);
    });
  }
  it('référence enregistrée', () => {
    if (ecrit) writeFileSync(REF, JSON.stringify(refs, null, 2));
    expect(etats.length).toBeGreaterThan(0);
  });
});
