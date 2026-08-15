// Pilote le banc d'épreuve dans un vrai Chromium.
//
//   npx vite --port 5212 &   (serveur de développement)
//   node bench/run.mjs ancien|nouveau [filtre]
//
// Écrit bench/resultats-<moteur>.json et affiche un tableau récapitulatif.

import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = dirname(fileURLToPath(import.meta.url));
const moteur = process.argv[2] || 'nouveau';
const filtre = process.argv[3] || '';
const PORT = process.env.PORT || 5212;

const navigateur = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await navigateur.newPage({ viewport: { width: 1280, height: 900 } });

const reseauExterne = [];
page.on('request', r => {
  const u = r.url();
  if (!u.startsWith(`http://localhost:${PORT}`) && !u.startsWith('data:') && !u.startsWith('blob:')) reseauExterne.push(u);
});
page.on('console', m => { if (m.type() === 'error') console.error('  [console]', m.text()); });
page.on('pageerror', e => console.error('  [pageerror]', e.message));

await page.goto(`http://localhost:${PORT}/bench/banc.html`, { waitUntil: 'load' });
await page.waitForFunction('window.bancPret === true', null, { timeout: 30000 });

const t0 = Date.now();
const res = await page.evaluate(
  ([m, f]) => window.lancerBanc(m, f),
  [moteur, filtre],
);
const duree = Math.round((Date.now() - t0) / 1000);

writeFileSync(join(ICI, `resultats-${moteur}.json`), JSON.stringify(res, null, 2));

const pc = (a, b) => (b ? ((100 * a) / b).toFixed(1).padStart(5) + ' %' : '   n/a');
console.log(`\nMoteur « ${moteur} » — ${res.scores.length} captures, ${duree} s\n`);
console.log('capture                 cellules     justes  fausses  manquantes  faux silencieux   dates');
for (const s of res.scores) {
  console.log(
    s.id.padEnd(22),
    String(s.cellules).padStart(6),
    pc(s.cellulesJustes, s.cellules),
    String(s.cellulesFausses).padStart(7),
    String(s.cellulesManquantes).padStart(10),
    String(s.fauxSilencieux).padStart(14),
    `   ${s.datesJustes}/${s.dates}`,
  );
}
const t = res.total;
console.log('\nTOTAL              ', String(t.cellules).padStart(6), pc(t.cellulesJustes, t.cellules),
  ' fausses', t.cellulesFausses, '· manquantes', t.cellulesManquantes,
  '· faux silencieux', t.fauxSilencieux, '· jaunes', t.jaunes, '(dont inutiles', t.jaunesInutiles + ')',
  '· dates', `${t.datesJustes}/${t.dates}`, '· lignes', `${t.lignesTrouvees}/${t.lignes}`);

console.log('\nLes cinq erreurs relevées par le médecin :');
const LIBELLE = {
  1: 'Créatinine 104 — borne de « Normes » prise pour un résultat',
  2: 'Plaquettes 400 — même cause, autre ligne',
  3: 'Leucocytes 12,2 rendu 122 — virgule décimale perdue',
  4: '« Créatinine umolL » — unité agglutinée au nom',
  5: '3 colonnes de dates fondues en 1 seule, sans date',
};
for (const c of res.medecin ?? []) {
  console.log(`  ${c.fautes === 0 ? '✓' : '✗'} n°${c.numero} ${LIBELLE[c.numero]} — ${c.fautes} faute(s)`);
  for (const d of c.details.slice(0, 4)) console.log('        ·', d);
}

if (reseauExterne.length) {
  console.log('\n⚠ requêtes hors localhost :', [...new Set(reseauExterne)].slice(0, 10));
} else {
  console.log('\n✓ aucune requête réseau externe');
}

await navigateur.close();
