// Diagnostic hors périmètre : que fait Entrée après avoir tapé un nom d'analyte
// dans la ligne fantôme ? (observé : une ligne sur deux se perd)
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await b.newPage({ viewport: { width: 1280, height: 800 } });
await page.addInitScript(() => localStorage.setItem('fastcurve.welcome.v1', '1'));
page.on('console', m => { if (m.type() === 'error') console.log('  [console]', m.text().slice(0, 120)); });
await page.goto('http://localhost:5213/');
await page.waitForTimeout(700);
const c = page.locator('button', { hasText: 'Commencer' }).first();
if (await c.count() && await c.isVisible().catch(() => false)) await c.click();
await page.waitForTimeout(300);

const actif = () => page.evaluate(() => {
  const a = document.activeElement;
  return a ? `${a.tagName}.${(a.className || '').toString().split(' ').slice(0, 2).join('.')} [${a.getAttribute('aria-label') || a.placeholder || ''}]` : 'rien';
});
const noms = () => page.$$eval('.dgrid tbody .rowname', l => l.map(t => t.textContent.replace(/\s+/g, ' ').trim()));

await page.locator('.newrow-inp').first().click();
console.log('focus initial :', await actif());

for (const n of ['Créatinine', 'CRP', 'Hémoglobine']) {
  await page.keyboard.type(n, { delay: 20 });
  console.log(`après frappe « ${n} » → focus ${await actif()}`);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
  console.log(`   après Entrée      → focus ${await actif()}`);
  console.log('   lignes :', JSON.stringify(await noms()));
}
await page.screenshot({ path: 'captures/ux-diag-lignes.png' });
await page.close();
await b.close();
