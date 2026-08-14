// Vérification dans un vrai navigateur : Ctrl+V d'une capture doit aboutir à
// un tableau proposé, doutes en jaune, corrigeable au clavier.
//
//   npx vite --port 5212 &
//   node verif-collage.mjs [capture]
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const capture = process.argv[2] || 'encadre-normal';
const PORT = process.env.PORT || 5212;
const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await nav.newPage({ viewport: { width: 1440, height: 900 } });

const externe = [];
page.on('request', r => {
  const u = r.url();
  if (!u.startsWith(`http://localhost:${PORT}`) && !u.startsWith('data:') && !u.startsWith('blob:')) externe.push(u);
});
page.on('pageerror', e => console.error('[pageerror]', e.message));
page.on('console', m => { if (m.type() === 'error') console.error('[console]', m.text()); });

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });

// Modale d'accueil
const commencer = page.getByRole('button', { name: /Commencer/i });
if (await commencer.count()) { await commencer.first().click(); }
await page.waitForTimeout(400);

// Ctrl+V d'une image : on injecte un vrai événement paste avec un DataTransfer.
const b64 = readFileSync(`bench/shots/${capture}.png`).toString('base64');
const t0 = Date.now();
await page.evaluate(async (data) => {
  const bin = atob(data);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  const file = new File([buf], 'capture.png', { type: 'image/png' });
  const dt = new DataTransfer();
  dt.items.add(file);
  document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, b64);

// Le tableau de vérification apparaît
await page.waitForSelector('table.vgrid', { timeout: 30000 });
await page.waitForFunction(() => {
  const t = document.querySelector('table.vgrid');
  return !!t && t.querySelectorAll('tbody tr').length > 0;
}, null, { timeout: 30000 });
const delai = Date.now() - t0;

const etat = await page.evaluate(() => {
  const t = document.querySelector('table.vgrid');
  const dates = [...t.querySelectorAll('thead input[type=date]')].map(i => i.value);
  const lignes = [...t.querySelectorAll('tbody tr')].map(tr => {
    const tds = [...tr.children];
    return {
      nom: tr.querySelector('.ninp')?.value ?? '',
      vignette: !!tr.querySelector('td.thumb img'),
      valeurs: tds.slice(3).map(td => td.querySelector('input')?.value ?? ''),
      jaunes: tds.slice(3).map(td => td.classList.contains('doute')),
    };
  });
  const txt = document.body.innerText;
  const interdits = ['▾ Options', '▴ Options', 'Noir & blanc', 'Aperçu du traitement', 'Contraste',
    '⟲', '⟳', 'Redresser auto', 'Lire les valeurs', 'Relire', 'Comparer à l’image', '✓ Image',
    'faible confiance', 'hors-norme', 'incohérent'];
  return {
    dates, lignes,
    colonnesEntete: [...t.querySelectorAll('thead th')].map(th => th.innerText.trim()),
    presents: interdits.filter(s => txt.includes(s)),
    local: txt.includes('100% local'),
    consigne: (document.querySelector('.consigne')?.innerText ?? '').trim(),
  };
});

console.log(`\nCapture « ${capture} » — tableau affiché en ${(delai / 1000).toFixed(1)} s\n`);
console.log('en-têtes  :', JSON.stringify(etat.colonnesEntete));
console.log('dates     :', JSON.stringify(etat.dates));
for (const l of etat.lignes) {
  console.log('  ', (l.vignette ? '🖼' : '  '), l.nom.padEnd(22),
    l.valeurs.map((v, i) => (l.jaunes[i] ? `[${v}]` : v).padStart(8)).join(''));
}
console.log('\n« 100% local » visible :', etat.local);
console.log('consigne  :', etat.consigne);
console.log('réglages supprimés     :', etat.presents.length ? '❌ encore présents → ' + etat.presents.join(', ') : '✓ aucun réglage banni à l’écran');

// Correction au clavier d'une case
const premiere = page.locator('table.vgrid tbody tr').first().locator('input').last();
await premiere.click();
await premiere.fill('42');
const relu = await premiere.inputValue();
console.log('correction clavier     :', relu === '42' ? '✓ la case accepte la frappe' : '❌ ' + relu);

// Tab circule
await page.keyboard.press('Tab');
const focus = await page.evaluate(() => document.activeElement?.tagName + '.' + (document.activeElement?.className || ''));
console.log('Tab                    :', focus);

console.log('requêtes hors localhost:', externe.length ? '❌ ' + [...new Set(externe)].slice(0, 5).join(', ') : '✓ aucune');

await page.screenshot({ path: `/tmp/claude-0/-home-user-FastCurve/21e66cea-0a9f-583b-b58e-71bbf91ea3c5/scratchpad/import-${capture}.png`, fullPage: true });
await nav.close();
