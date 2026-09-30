import { test, expect, type Page } from '@playwright/test';

async function ouvrirTraitements(page: Page) {
  await page.goto('/');
  const commencer = page.getByRole('button', { name: 'Commencer' });
  if (await commencer.isVisible().catch(() => false)) await commencer.click();
  await page.getByRole('button', { name: 'Traitements' }).first().click();
}

test('traitements — coller le carré bleu : analyse au clic puis ajout', async ({ page }) => {
  await ouvrirTraitements(page);
  await page.getByRole('button', { name: 'Coller' }).click();
  const zone = page.getByRole('textbox', { name: 'Texte du carré bleu' });
  await expect(zone).toBeFocused();
  await zone.evaluate((el: HTMLTextAreaElement) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', 'Mai 2020 : CELLCEPT 1,5 g matin et soir\nJuin 2020 : PREDNISONE 10 mg le matin');
    el.value = dt.getData('text/plain');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
  });
  // Pas d'analyse automatique : le médecin peut retoucher le texte avant.
  await expect(page.getByRole('textbox', { name: 'Nom du traitement' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Analyser' }).click();
  await expect(page.getByRole('textbox', { name: 'Nom du traitement' })).toHaveCount(2);
  await page.getByRole('button', { name: 'Ajouter au graphique' }).click();
  await expect(page.getByText(/CELLCEPT/i).first()).toBeVisible();
});

test('traitements — dictée Dragon : analyse après une pause', async ({ page }) => {
  await ouvrirTraitements(page);
  await page.getByRole('button', { name: 'Dicter' }).click();
  const zone = page.getByRole('textbox', { name: 'Texte dicté' });
  await expect(zone).toBeFocused();
  await zone.pressSequentially('patiente sous prednisone dix milligrammes le matin', { delay: 5 });
  await expect(page.getByRole('textbox', { name: 'Nom du traitement' })).toHaveCount(1, { timeout: 5000 });
  await expect(page.getByRole('textbox', { name: /Dose de/ })).toHaveValue('10 mg le matin');
});

test('traitements — saisie manuelle', async ({ page }) => {
  await ouvrirTraitements(page);
  await page.getByPlaceholder(/Nom \(Prednisone/).fill('Rituximab');
  await page.getByRole('button', { name: 'Événement' }).click();
  await page.getByRole('button', { name: 'Ajouter le traitement' }).click();
  await expect(page.getByText('Rituximab').first()).toBeVisible();
});

test('traitements — carré bleu réel : frise cohérente (relai, arrêt, reprise, paliers)', async ({ page }) => {
  const { CARRE_SCLERODERMIE } = await import('../../src/lib/text/__fixtures__/carres-bleus');
  await ouvrirTraitements(page);
  await page.getByRole('button', { name: 'Coller' }).click();
  await page.getByRole('textbox', { name: 'Texte du carré bleu' }).fill(CARRE_SCLERODERMIE);
  await page.getByRole('button', { name: 'Analyser' }).click();
  await page.getByRole('button', { name: 'Ajouter au graphique' }).click();
  await expect(page.getByText(/traitement\(s\) ajouté\(s\)/)).toBeVisible();
  // Une seule barre de CELLCEPT (fermée au relai), deux de MYFORTIC (arrêt puis reprise).
  const liste = page.locator('.trow');
  await expect(liste.filter({ hasText: 'CELLCEPT' })).toHaveCount(1);
  await expect(liste.filter({ hasText: 'MYFORTIC' })).toHaveCount(2);
  await expect(liste.filter({ hasText: 'TOCILIZUMAB' })).toHaveCount(1);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: 'test-results/frise-sclerodermie.png' });
});
