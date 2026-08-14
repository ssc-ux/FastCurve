// Parcours UX — on rejoue le geste du médecin pressé, à plusieurs tailles
// d'écran, et on mesure : gestes comptés, débordements, éléments coupés.
//   node parcours-ux.mjs avant|apres
import { chromium } from 'playwright';

const tag = process.argv[2] || 'avant';
const URL = 'http://localhost:5213/';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

const ecrans = [
  { nom: '1280x800', w: 1280, h: 800 },
  { nom: '1600x950', w: 1600, h: 950 },
  { nom: '1920x1080', w: 1920, h: 1080 },
  { nom: 'etroit-1024x700', w: 1024, h: 700 },
  { nom: 'tresetroit-760x800', w: 760, h: 800 },
];

const nettoyer = (page) => page.addInitScript(() => { localStorage.clear(); });

// ── 1. Modale d'accueil : est-elle entière à l'écran ? ──
console.log('\n===== Modale d’accueil — tient-elle dans la fenêtre ? =====');
for (const e of ecrans) {
  const page = await b.newPage({ viewport: { width: e.w, height: e.h } });
  await nettoyer(page);
  await page.goto(URL);
  await page.waitForTimeout(700);
  const m = await page.evaluate(() => {
    const mod = document.querySelector('.modal');
    if (!mod) return null;
    const r = mod.getBoundingClientRect();
    const steps = [...document.querySelectorAll('.modal .step, .modal .etape')].map(s => {
      const b = s.getBoundingClientRect();
      return { bas: Math.round(b.bottom), visible: b.bottom <= window.innerHeight };
    });
    const btn = document.querySelector('.modal .start')?.getBoundingClientRect();
    return {
      haut: Math.round(r.top), bas: Math.round(r.bottom), hauteur: Math.round(r.height),
      fenetre: window.innerHeight,
      deborde: r.bottom > window.innerHeight + 1 || r.top < -1,
      etapes: steps,
      boutonVisible: btn ? btn.bottom <= window.innerHeight : null,
      boutonBas: btn ? Math.round(btn.bottom) : null,
      scrollInterne: mod.scrollHeight > mod.clientHeight + 1,
    };
  });
  console.log(`${e.nom.padEnd(18)} ${m ? JSON.stringify(m) : 'pas de modale'}`);
  await page.screenshot({ path: `captures/ux-${tag}-accueil-${e.nom}.png` });
  await page.close();
}

// ── 2. Application ouverte, grille vide : débordements ? ──
console.log('\n===== Application (grille vide) — débordements horizontaux =====');
for (const e of ecrans) {
  const page = await b.newPage({ viewport: { width: e.w, height: e.h } });
  await nettoyer(page);
  await page.goto(URL);
  await page.waitForTimeout(600);
  const c = page.locator('button', { hasText: 'Commencer' }).first();
  if (await c.count() && await c.isVisible().catch(() => false)) await c.click();
  await page.waitForTimeout(400);
  const d = await page.evaluate(() => ({
    scrollX: document.documentElement.scrollWidth > window.innerWidth + 1,
    largeurDoc: document.documentElement.scrollWidth,
    fenetre: window.innerWidth,
    // éléments qui dépassent à droite
    fautifs: [...document.querySelectorAll('body *')].filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.right > window.innerWidth + 2;
    }).slice(0, 6).map(el => `${el.tagName}.${(el.className || '').toString().split(' ')[0]}`),
    grilleH: Math.round(document.querySelector('.sidebar')?.getBoundingClientRect().height || 0),
    courbeH: Math.round(document.querySelector('.chart-area')?.getBoundingClientRect().height || 0),
  }));
  console.log(`${e.nom.padEnd(18)} ${JSON.stringify(d)}`);
  await page.screenshot({ path: `captures/ux-${tag}-app-${e.nom}.png` });
  await page.close();
}

// ── 3. Parcours complet : 3 analytes × 4 dates, au clavier, gestes comptés ──
console.log('\n===== Parcours saisie clavier (critère 46) =====');
{
  const page = await b.newPage({ viewport: { width: 1280, height: 800 } });
  await nettoyer(page);
  await page.goto(URL);
  await page.waitForTimeout(600);
  let gestes = 0;
  const clic = async (loc) => { gestes++; await loc.click(); };
  const frappe = async (t) => { gestes += t.length; await page.keyboard.type(t, { delay: 12 }); };
  const touche = async (k) => { gestes++; await page.keyboard.press(k); };

  const c = page.locator('button', { hasText: 'Commencer' }).first();
  if (await c.count() && await c.isVisible().catch(() => false)) await clic(c);
  await page.waitForTimeout(300);
  const t0 = Date.now();

  // première cellule de nom
  await clic(page.locator('.dgrid .rowname input, .dgrid .rowname button').first());
  await page.waitForTimeout(150);
  const lignes = ['Créatinine', 'CRP', 'Hémoglobine'];
  for (const l of lignes) {
    await frappe(l);
    await touche('Enter');
    await page.waitForTimeout(120);
  }
  await page.screenshot({ path: `captures/ux-${tag}-parcours-1-lignes.png` });

  // dates dans l'entête
  const dateInputs = page.locator('.dgrid thead .dateinput');
  const nDates = await dateInputs.count();
  console.log(`colonnes de dates disponibles : ${nDates}`);
  const dates = ['01/02/2019', '15/06/2021', '03/09/2023', '12/03/2024'];
  for (let i = 0; i < dates.length; i++) {
    const inp = page.locator('.dgrid thead .dateinput').nth(i);
    if (!(await inp.count())) break;
    await clic(inp);
    await page.keyboard.press('Control+a');
    await frappe(dates[i]);
    await touche('Enter');
    await page.waitForTimeout(200);
  }
  await page.screenshot({ path: `captures/ux-${tag}-parcours-2-dates.png` });
  const vues = await page.$$eval('.dgrid thead .dateinput', l => l.map(i => i.value));
  console.log('dates obtenues :', vues.join(' | '));

  // valeurs
  const val = [[85, 92, 110, 130], [3, 12, 45, 8], [13.2, 12.8, 11.9, 10.4]];
  const c1 = page.locator('.dgrid tbody .cell').first();
  if (await c1.count()) {
    await clic(c1);
    for (let r = 0; r < 3; r++) {
      for (let k = 0; k < 4; k++) {
        await frappe(String(val[r][k]).replace('.', ','));
        await touche('Tab');
      }
    }
  }
  await page.waitForTimeout(400);
  const secondes = Math.round((Date.now() - t0) / 1000);
  console.log(`gestes (clics + touches) : ${gestes} — durée automate : ${secondes}s`);
  await page.screenshot({ path: `captures/ux-${tag}-parcours-3-valeurs.png`, fullPage: false });

  // ── 4. Repères (traitements) ──
  await page.locator('.tab', { hasText: 'Repères' }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `captures/ux-${tag}-reperes.png` });
  const fmtDatesReperes = await page.$$eval('input[type=date]', l => l.length);
  console.log(`champs <input type=date> dans Repères : ${fmtDatesReperes}`);

  await page.locator('input[placeholder*="Prednisone"]').fill('Prednisone');
  await page.locator('button.primary', { hasText: 'Ajouter' }).first().click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `captures/ux-${tag}-reperes-editeur.png` });

  // ── 5. Réglages ──
  await page.locator('.tab', { hasText: 'Réglages' }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `captures/ux-${tag}-reglages.png`, fullPage: false });
  const nbReglages = await page.evaluate(() =>
    document.querySelectorAll('.tab-content button, .tab-content input, .tab-content select').length);
  console.log(`contrôles dans l’onglet Réglages : ${nbReglages}`);

  await page.close();
}

// ── 6. Accessibilité : focus visible et parcours Tab depuis la barre du haut ──
console.log('\n===== Accessibilité — focus visible =====');
{
  const page = await b.newPage({ viewport: { width: 1280, height: 800 } });
  await nettoyer(page);
  await page.goto(URL);
  await page.waitForTimeout(600);
  const c = page.locator('button', { hasText: 'Commencer' }).first();
  if (await c.count() && await c.isVisible().catch(() => false)) await c.click();
  await page.waitForTimeout(300);
  const suite = [];
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press('Tab');
    const a = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return { tag: 'BODY' };
      const cs = getComputedStyle(el);
      return {
        tag: el.tagName,
        cls: (el.className || '').toString().slice(0, 32),
        txt: (el.textContent || el.getAttribute('aria-label') || el.placeholder || '').trim().slice(0, 26),
        outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor,
        boxShadow: cs.boxShadow.slice(0, 40),
      };
    });
    suite.push(a);
  }
  suite.forEach((a, i) => console.log(`${String(i + 1).padStart(2)} ${a.tag.padEnd(7)} ${String(a.txt || a.cls || '').padEnd(28)} outline=${a.outline} shadow=${a.boxShadow || ''}`));
  await page.screenshot({ path: `captures/ux-${tag}-focus.png` });
  await page.close();
}

await b.close();
console.log('\nfini.');
