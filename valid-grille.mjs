// Validation navigateur de la grille : frappe réelle au clavier, pas de fill().
import { chromium } from 'playwright';

const ETUDE = {
  version: 1, patientLabel: 'Diag', parameters: [
    { id: 'p1', name: 'CRP', unit: 'mg/L', category: 'biologie', refLow: 0, refHigh: 5, display: 'absolute', color: '#2a78d6', order: 0 },
    { id: 'p2', name: 'Créatinine', unit: 'µmol/L', category: 'biologie', display: 'absolute', color: '#e34948', order: 1 },
  ],
  measurements: [
    { id: 'm1', parameterId: 'p1', date: '2026-01-10', value: 148, qualifier: null },
    { id: 'm2', parameterId: 'p2', date: '2026-01-10', value: 245, qualifier: null },
    { id: 'm3', parameterId: 'p1', date: '2026-02-10', value: 92, qualifier: null },
    { id: 'm4', parameterId: 'p2', date: '2026-02-10', value: 190, qualifier: null },
    { id: 'm5', parameterId: 'p1', date: '2026-03-10', value: 31, qualifier: null },
  ],
  treatments: [], annotations: [],
  settings: { chartMode: 'stacked', title: 'Diag', subtitle: '', showReference: true, showLegend: true, showValues: false, timeAxis: true, markOutOfRange: true },
  extraDates: ['2026-04-10'],
};

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await b.newPage({ viewport: { width: 1500, height: 950 } });
await page.addInitScript(([e]) => {
  localStorage.setItem('fastcurve.etude.v1', e);
  localStorage.setItem('fastcurve.welcome.v1', '1');
}, [JSON.stringify(ETUDE)]);

let ko = 0;
const ok = (cond, label, extra = '') => {
  if (!cond) ko++;
  console.log(`${cond ? 'OK  ' : 'ÉCHEC'} ${label}${extra ? ' — ' + extra : ''}`);
};

const dates = () => page.$$eval('.dgrid thead .dateinput', l => l.map(i => i.value));
const actif = () => page.evaluate(() => {
  const a = document.activeElement;
  return { cls: a ? (a.className || a.tagName) : '?', cle: a?.dataset?.cle ?? null, val: a && 'value' in a ? a.value : null };
});
const mesures = () => page.evaluate(() => JSON.parse(localStorage.getItem('fastcurve.etude.v1'))
  .measurements.map(m => `${m.parameterId}@${m.date}=${m.value}`).sort());
const grille = () => page.$$eval('.dgrid tbody tr', ls => ls.map(tr => [...tr.querySelectorAll('.cell')].map(i => i.value).join('|')));

await page.goto('http://localhost:5211/');
await page.waitForSelector('.dgrid');
await page.screenshot({ path: 'captures/apres-01-depart.png' });

// ── 1. Frappe complète d'une date, caractère par caractère ──────────────
console.log('\n— 1. Frappe d’une date au clavier —');
const entetes = page.locator('.dgrid thead .dateinput');
console.log('   dates au départ :', await dates());
await entetes.nth(2).click();          // colonne 10/03/2026
const cle0 = (await actif()).cle;
await page.keyboard.press('Control+a');
let trace = [];
for (const ch of '05/12/2026') {
  await page.keyboard.type(ch);
  const a = await actif();
  trace.push(`${ch}→[${a.val}]${a.cle === cle0 ? '' : ' FOCUS PERDU'}`);
}
console.log('   ' + trace.join(' '));
const pendant = await actif();
ok(pendant.cle === cle0, 'le focus reste dans la même colonne pendant toute la frappe');
ok(pendant.val === '05/12/2026', 'les 10 caractères sont arrivés dans le champ', pendant.val);
ok((await dates()).join() === '10/01/2026,10/02/2026,10/03/2026,10/04/2026',
   'aucune colonne n’a bougé pendant la frappe', (await dates()).join());
ok((await mesures()).join() === 'p1@2026-01-10=148,p1@2026-02-10=92,p1@2026-03-10=31,p2@2026-01-10=245,p2@2026-02-10=190',
   'rien n’est enregistré pendant la frappe');
await page.screenshot({ path: 'captures/apres-02-pendant-frappe.png' });

// ── 2. Validation par Entrée ────────────────────────────────────────────
console.log('\n— 2. Validation (Entrée) —');
await page.keyboard.press('Enter');
await page.waitForTimeout(120);
ok((await dates()).join() === '10/01/2026,10/02/2026,10/04/2026,05/12/2026',
   'la colonne se replace en fin de grille APRÈS validation', (await dates()).join());
ok((await mesures()).includes('p1@2026-12-05=31'), 'la valeur 31 a suivi la colonne');
const apres = await actif();
ok(apres.cls.includes('cell') && apres.cle === cle0, 'le focus descend dans la 1re cellule de la colonne', JSON.stringify(apres));
await page.screenshot({ path: 'captures/apres-03-validee.png' });

// ── 3. Saisie de valeurs + courbe en direct ─────────────────────────────
console.log('\n— 3. Valeurs et courbe en direct —');
const svgAvant = await page.$eval('.chart svg, svg', s => s.outerHTML.length);
await page.keyboard.type('7');
await page.waitForTimeout(80);
const svg1 = await page.evaluate(() => document.querySelector('svg').outerHTML);
await page.keyboard.type('7');
await page.waitForTimeout(80);
const svg2 = await page.evaluate(() => document.querySelector('svg').outerHTML);
ok(svg1 !== svg2, 'la courbe change à chaque caractère tapé (mise à jour en direct)');
ok((await mesures()).includes('p1@2026-12-05=77'), 'la valeur 77 est enregistrée au fil de la frappe');

// ── 4. Échap annule la saisie de cellule ────────────────────────────────
console.log('\n— 4. Échap dans une cellule —');
await page.keyboard.press('Escape');
await page.waitForTimeout(80);
ok((await mesures()).includes('p1@2026-12-05=31'), 'Échap remet la valeur d’avant (31)', (await mesures()).join());

// ── 5. Navigation clavier ───────────────────────────────────────────────
console.log('\n— 5. Navigation —');
await page.keyboard.press('ArrowDown');
let a = await actif();
ok(a.cls.includes('cell') && a.val === '', 'Flèche bas → cellule Créatinine de la même colonne', JSON.stringify(a));
await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp');
a = await actif();
ok(a.cls.includes('dateinput'), 'Flèche haut depuis la 1re ligne → en-tête de date', JSON.stringify(a));
await page.keyboard.press('Shift+Tab');
a = await actif();
ok(a.cls.includes('dateinput') && a.val === '10/04/2026', 'Maj+Tab → en-tête précédent (pas les boutons ✕/📅)', JSON.stringify(a));
await page.keyboard.press('ArrowDown');
await page.keyboard.press('Tab');
a = await actif();
ok(a.cls.includes('cell'), 'Tab depuis une cellule → cellule suivante de la ligne', JSON.stringify(a));

// ── 6. Formats souples + Échap sur une date ─────────────────────────────
console.log('\n— 6. Formats de date —');
await page.locator('.dgrid thead .dateinput').first().click();
await page.keyboard.press('Control+a');
await page.keyboard.type('3112');
await page.keyboard.press('Escape');
ok((await dates())[0] === '10/01/2026', 'Échap dans l’en-tête annule la frappe', (await dates())[0]);
await page.keyboard.press('Control+a');
await page.keyboard.type('01022026');
await page.keyboard.press('Tab');
await page.waitForTimeout(120);
ok((await dates()).includes('01/02/2026'), '« 01022026 » compris comme 01/02/2026', (await dates()).join());
a = await actif();
ok(a.cls.includes('dateinput'), 'Tab valide et passe à l’en-tête suivant', JSON.stringify(a));

// ── 7. Écrasement signalé + annulable ───────────────────────────────────
console.log('\n— 7. Collision de dates —');
const avantCollision = await mesures();
await page.locator('.dgrid thead .dateinput').first().click();
await page.keyboard.press('Control+a');
await page.keyboard.type('10/02/2026');
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
const toast = await page.locator('.toast, [class*=toast]').first().innerText().catch(() => '');
console.log('   toast :', JSON.stringify(toast));
ok(/écras|fusion/i.test(toast), 'un message signale l’écrasement / la fusion');
await page.screenshot({ path: 'captures/apres-04-collision.png' });
const annuler = page.locator('button', { hasText: 'Annuler' }).last();
await annuler.click();
await page.waitForTimeout(200);
ok((await mesures()).join() === avantCollision.join(), 'Annuler restaure exactement les mesures', (await mesures()).join());

// ── 8. Ajout de colonne → focus prêt à taper ────────────────────────────
console.log('\n— 8. + Date —');
await page.locator('.add-date').click();
await page.waitForTimeout(150);
a = await actif();
ok(a.cls.includes('dateinput'), '« + Date » place le curseur dans la nouvelle date', JSON.stringify(a));
await page.keyboard.type('15/07/2026');
await page.keyboard.press('Enter');
await page.waitForTimeout(150);
ok((await dates()).includes('15/07/2026'), 'la nouvelle colonne prend la date tapée', (await dates()).join());

// ── 9. Suppression clavier ──────────────────────────────────────────────
console.log('\n— 9. Ctrl+Suppr —');
const avantSuppr = (await dates()).length;
await page.locator('.dgrid thead .dateinput').last().click();
await page.keyboard.press('Control+Delete');
await page.waitForTimeout(150);
ok((await dates()).length === avantSuppr - 1, 'Ctrl+Suppr supprime la colonne', `${avantSuppr} → ${(await dates()).length}`);
await page.locator('button', { hasText: 'Annuler' }).last().click();
await page.waitForTimeout(150);
ok((await dates()).length === avantSuppr, 'et l’annulation la rétablit');

console.log('\n   grille finale :', await grille());
console.log('   dates finales :', await dates());
await page.screenshot({ path: 'captures/apres-05-final.png' });
console.log(ko === 0 ? '\nTOUT EST VERT' : `\n${ko} VÉRIFICATION(S) EN ÉCHEC`);
await b.close();
process.exit(ko ? 1 : 0);
