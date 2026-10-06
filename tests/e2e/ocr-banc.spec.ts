import { test, expect } from '@playwright/test';

// Verrou de qualité de la reconnaissance : toutes les captures du banc
// (bench/shots, captures fictives) doivent
// être lues sans AUCUNE erreur. Une régression de l'OCR fait échouer la CI.
test('banc OCR : 100 % des cases, dates et lignes, aucune erreur', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('http://localhost:5212/bench/banc.html');
  await page.waitForFunction('window.bancPret === true', null, { timeout: 60_000 });
  const res = await page.evaluate(() => (window as any).lancerBanc('nouveau', ''));
  const t = res.total;
  const imparfaites = res.scores.filter((s: any) => s.cellulesJustes !== s.cellules).map((s: any) => s.id);
  expect(imparfaites, 'captures imparfaites').toEqual([]);
  expect(t.cellulesJustes).toBe(t.cellules);
  expect(t.fauxSilencieux).toBe(0);
  expect(t.datesJustes).toBe(t.dates);
  expect(t.lignesTrouvees).toBe(t.lignes);
});
