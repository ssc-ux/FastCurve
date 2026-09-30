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
    dt.setData('text/plain', 'CELLCEPT 1,5 g matin et soir\nPREDNISONE 10 mg le matin');
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
