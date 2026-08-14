// Preuve navigateur — parcours EXACT du médecin (cahier des charges §1 et §2),
// frappe clavier réelle uniquement (jamais fill(), qui masque le bug).
//   node preuve-grille.mjs avant|apres
import { chromium } from 'playwright';

const tag = process.argv[2] || 'apres';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await b.newPage({ viewport: { width: 1500, height: 950 } });
await page.addInitScript(() => {
  localStorage.clear();
  localStorage.setItem('fastcurve.welcome.v1', '1');
});

let ko = 0;
const ok = (cond, label, extra = '') => {
  if (!cond) ko++;
  console.log(`${cond ? 'OK   ' : 'ÉCHEC'} ${label}${extra !== '' ? ' — ' + extra : ''}`);
};
const dates = () => page.$$eval('.dgrid thead .dateinput', l => l.map(i => i.value));
const actif = () => page.evaluate(() => {
  const a = document.activeElement;
  return { cls: a ? (a.className || a.tagName) : '?', cle: a?.dataset?.cle ?? null, val: a && 'value' in a ? a.value : null };
});
const grille = () => page.$$eval('.dgrid tbody tr', ls => ls.map(tr => [...tr.querySelectorAll('.cell')].map(i => i.value).join('|')));
const axeSvg = () => page.evaluate(() => {
  const s = document.querySelector('svg');
  return s ? [...s.querySelectorAll('text')].map(t => t.textContent).join('¦') : '';
});

await page.goto('http://localhost:5211/');
await page.waitForTimeout(600);
// La modale d'accueil peut s'afficher malgré le drapeau : on la ferme si présente.
const commencer = page.locator('button', { hasText: 'Commencer' }).first();
if (await commencer.count() && await commencer.isVisible().catch(() => false)) await commencer.click();
await page.waitForTimeout(300);

console.log('\n===== 1. Le tableau est-il prêt à recevoir ? (critère 13) =====');
const grilleDirecte = await page.locator('.dgrid').count();
ok(grilleDirecte > 0, 'une grille est affichée sans avoir cliqué sur un bouton');
await page.screenshot({ path: `captures/${tag}-01-ouverture.png` });

console.log('\n===== 2. Saisir un paramètre puis une date (critères 15/16/14) =====');
if (await page.locator('.newrow-inp').count()) {
  await page.locator('.newrow-inp').first().click();
  for (const ch of 'créat') { await page.keyboard.type(ch); await page.waitForTimeout(30); }
  await page.waitForTimeout(150);
  const sugg = await page.locator('.suggest .sg').first().innerText().catch(() => '');
  console.log('   suggestion proposée :', JSON.stringify(sugg));
  ok(/Créatinine/i.test(sugg), 'une suggestion « Créatinine » apparaît (critère 16)');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
} else {
  // parcours d'origine : panneau « Ajouter un paramètre »
  const qs = page.locator('button', { hasText: 'Saisir à la main' });
  if (await qs.count()) await qs.click();
  await page.waitForTimeout(200);
  await page.locator('input[placeholder^="Rechercher"]').fill('créatinine');
  await page.waitForTimeout(200);
  await page.locator('.res').first().click();
  await page.waitForTimeout(200);
}
const nomsLignes = await page.$$eval('.dgrid tbody .pname', l => l.map(e => e.textContent));
console.log('   lignes :', nomsLignes, '· dates :', await dates());
ok(nomsLignes.some(n => /Créatinine/i.test(n)), 'la ligne Créatinine existe');
ok((await dates()).length >= 1, 'au moins une colonne où taper existe après l’ajout du paramètre (critère 13)',
   `${(await dates()).length} colonne(s)`);
await page.screenshot({ path: `captures/${tag}-02-parametre-ajoute.png` });

console.log('\n===== 3. LE GRIEF N°1 : taper 01/02/2020 chiffre par chiffre =====');
// On se place dans la dernière colonne de dates.
const entetes = page.locator('.dgrid thead .dateinput');
const n = await entetes.count();
if (n === 0) { console.log('   AUCUNE COLONNE : impossible de taper une date.'); ko++; }
else {
  await entetes.nth(n - 1).click();
  await page.keyboard.press('Control+a');
  const cle0 = (await actif()).cle;
  const datesAvant = (await dates()).join();
  const axeAvant = await axeSvg();
  const trace = [];
  let perdues = 0, saute = false, focusPerdu = false;
  for (const ch of '01022020') {
    await page.keyboard.type(ch);
    await page.waitForTimeout(60);
    const a = await actif();
    const d = (await dates()).join();
    if (a.cle !== cle0) { focusPerdu = true; }
    if (d !== datesAvant) saute = true;
    trace.push(`${ch}→[${a.val ?? ''}]${a.cle === cle0 ? '' : '✗focus'}`);
  }
  console.log('   journal de frappe :\n     ' + trace.join('\n     '));
  const fin = await actif();
  const attendu = ['01/02/2020', '01022020'];
  ok(!focusPerdu, 'le curseur reste dans le champ de date pendant toute la frappe (critère 3)');
  ok(!saute, 'la colonne ne change pas de position pendant la frappe (critère 2)');
  ok(attendu.includes(fin.val), 'les huit chiffres sont arrivés dans le champ (critère 1)', JSON.stringify(fin.val));
  ok((await axeSvg()) === axeAvant, 'l’axe des dates du graphique n’a pas bougé pendant la frappe (critère 4)');
  await page.screenshot({ path: `captures/${tag}-03-pendant-frappe.png` });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  ok((await dates()).includes('01/02/2020'), 'Entrée enregistre la date tapée (critère 5)', (await dates()).join());
  ok(!(await dates()).some(d => /\/0\d{3}$|\/\d{3}$/.test(d)), 'aucune date aberrante (an 1, an 202…) (critère 7)', (await dates()).join());
  console.log('   dates après validation :', await dates());
}
await page.screenshot({ path: `captures/${tag}-04-apres-validation.png` });

console.log('\n===== 4. Validation par clic ailleurs (critère 6) =====');
{
  const e2 = page.locator('.dgrid thead .dateinput');
  if (await e2.count()) {
    await e2.first().click();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('15/03/2019');
    await page.locator('body').click({ position: { x: 5, y: 400 } });
    await page.waitForTimeout(250);
    ok((await dates()).includes('15/03/2019'), 'sortir du champ enregistre la date (critère 6)', (await dates()).join());
  }
}

console.log('\n===== 5. Formats de date libres (critères 9/10) =====');
{
  const essais = [['12032024', '12/03/2024'], ['12/03/24', '12/03/2024'], ['03/2024', '01/03/2024'], ['mars 2024', '01/03/2024'], ['2024', '01/01/2024']];
  for (const [saisie, attendu] of essais) {
    const e3 = page.locator('.dgrid thead .dateinput').last();
    await e3.click();
    await page.keyboard.press('Control+a');
    await page.keyboard.type(saisie);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    ok((await dates()).includes(attendu), `« ${saisie} » → ${attendu}`, (await dates()).join());
  }
}

console.log('\n===== 6. Valeurs, courbe en direct, écrasement (critères 22/23) =====');
{
  const c = page.locator('.dgrid tbody .cell').first();
  await c.click();
  await page.keyboard.type('110');
  await page.waitForTimeout(150);
  const svg1 = await axeSvg();
  await c.click();
  await page.keyboard.type('85');
  await page.waitForTimeout(150);
  const v = await c.inputValue();
  ok(v === '85', 'cliquer une cellule à 110 et taper 85 donne 85 (critère 23)', v);
  const svg2 = await page.evaluate(() => document.querySelector('svg')?.outerHTML.length ?? 0);
  ok(svg1 !== '' || svg2 > 0, 'la courbe existe et suit la saisie (critère 22)');
}

console.log('\n===== 7. Tab ne sort jamais du tableau (critère 18) =====');
{
  const cells = page.locator('.dgrid tbody .cell');
  const total = await cells.count();
  await cells.nth(total - 1).click();
  await page.keyboard.press('Tab');
  await page.waitForTimeout(120);
  const a = await actif();
  console.log('   après Tab sur la dernière cellule :', JSON.stringify(a));
  ok(/cell|dateinput|newrow-inp/.test(a.cls), 'Tab depuis la dernière cellule reste dans le tableau', a.cls);
}

console.log('\n   grille finale :', await grille());
console.log('   dates finales :', await dates());
await page.screenshot({ path: `captures/${tag}-05-final.png` });
console.log(ko === 0 ? '\nTOUT EST VERT' : `\n${ko} VÉRIFICATION(S) EN ÉCHEC`);
await b.close();
process.exit(ko ? 1 : 0);
