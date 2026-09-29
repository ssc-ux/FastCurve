import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

/** Toute requête qui quitte le site, et toute erreur de page (CSP comprise). */
function surveiller(page: Page) {
  const externes: string[] = [];
  const erreurs: string[] = [];
  page.on('request', r => {
    const u = r.url();
    if (!u.startsWith('http://localhost:4173') && !u.startsWith('data:') && !u.startsWith('blob:')) externes.push(u);
  });
  page.on('pageerror', e => erreurs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') erreurs.push(m.text()); });
  return { externes, erreurs };
}

async function ouvrir(page: Page) {
  await page.goto('/');
  const commencer = page.getByRole('button', { name: 'Commencer' });
  if (await commencer.isVisible().catch(() => false)) await commencer.click();
}

/** Simule un Ctrl+V (texte ou image) sur la page. */
async function coller(page: Page, contenu: { texte?: string; image?: { base64: string; type: string } }) {
  await page.evaluate(async ({ texte, image }) => {
    const dt = new DataTransfer();
    if (texte) dt.setData('text/plain', texte);
    if (image) {
      const octets = Uint8Array.from(atob(image.base64), c => c.charCodeAt(0));
      dt.items.add(new File([octets], 'capture', { type: image.type }));
    }
    document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
  }, contenu);
}

test('démarre sans erreur ni requête externe', async ({ page }) => {
  const s = surveiller(page);
  await ouvrir(page);
  await expect(page.locator('#app')).not.toBeEmpty();
  await page.waitForTimeout(1500);
  expect(s.externes).toEqual([]);
  expect(s.erreurs).toEqual([]);
});

test('collage d’un tableau Excel → grille → courbe', async ({ page }) => {
  const s = surveiller(page);
  await ouvrir(page);
  await coller(page, { texte: 'Analyse\t01/02/2025\t15/02/2025\t01/03/2025\nCRP\t12\t48\t6\nHémoglobine\t12,1\t11,8\t13,4\n' });
  await expect(page.getByRole('textbox', { name: 'Date de la colonne 15/02/2025' })).toBeVisible();
  await expect(page.locator('svg').filter({ hasText: 'CRP' }).first()).toBeVisible();
  expect(s.erreurs).toEqual([]);
});

test('capture d’écran réelle → valeurs justes, rien ne sort du navigateur', async ({ page }) => {
  const s = surveiller(page);
  await ouvrir(page);
  const base64 = readFileSync('bench/shots/reel-hopital.jpg').toString('base64');
  await coller(page, { image: { base64, type: 'image/jpeg' } });
  const ajouter = page.getByRole('button', { name: 'Ajouter au graphique' });
  await expect(ajouter).toBeVisible({ timeout: 60_000 });
  const valeurs = await page.locator('table input').evaluateAll(els => els.map(e => (e as HTMLInputElement).value));
  for (const v of ['NUM PLAQUETTES', 'CRP', '11', '127', '24', '23']) expect(valeurs).toContain(v);
  expect(valeurs).not.toContain('150400');
  expect(s.externes).toEqual([]);
  expect(s.erreurs).toEqual([]);
});

test('enregistrer produit un fichier .fastcurve.json relisible', async ({ page }) => {
  await ouvrir(page);
  await coller(page, { texte: 'Analyse\t01/02/2025\t15/02/2025\nCRP\t12\t48\n' });
  await expect(page.getByRole('textbox', { name: 'Date de la colonne 15/02/2025' })).toBeVisible();
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Enregistrer le fichier/ }).click(),
  ]);
  expect(dl.suggestedFilename()).toMatch(/\.fastcurve\.json$/);
  const json = JSON.parse(readFileSync(await dl.path(), 'utf8'));
  expect(json.parameters.length).toBeGreaterThan(0);
});

test('fonctionne hors-ligne après une première visite', async ({ page, context }) => {
  await ouvrir(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // la page est désormais contrôlée par le service worker
  await page.waitForTimeout(1000);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#app')).not.toBeEmpty();
  await context.setOffline(false);
});

test('téléphone : navigation du bas, aucun débordement horizontal @mobile', async ({ page }) => {
  await ouvrir(page);
  await expect(page.locator('nav.bottomnav')).toBeVisible();
  const deborde = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(deborde).toBe(false);
});
