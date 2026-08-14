// Diagnostic : la modale d'accueil tient-elle dans une VRAIE fenêtre de portable ?
// Un écran 1280×800 donne ~1280×640 de zone utile une fois la barre d'onglets,
// la barre d'adresse, les favoris et la barre des tâches déduits.
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const hauteurs = [800, 720, 680, 640, 600, 560];
for (const h of hauteurs) {
  const page = await b.newPage({ viewport: { width: 1280, height: h } });
  await page.addInitScript(() => localStorage.clear());
  await page.goto('http://localhost:5213/');
  await page.waitForTimeout(500);
  const m = await page.evaluate(() => {
    const mod = document.querySelector('.modal');
    const ov = document.querySelector('.overlay');
    if (!mod) return null;
    const r = mod.getBoundingClientRect();
    const btn = document.querySelector('.modal .start')?.getBoundingClientRect();
    const et = [...document.querySelectorAll('.modal .step')].map((s, i) => ({
      n: i + 1, bas: Math.round(s.getBoundingClientRect().bottom),
      vu: s.getBoundingClientRect().bottom <= window.innerHeight,
    }));
    return {
      hautModale: Math.round(r.top), basModale: Math.round(r.bottom), h: Math.round(r.height),
      fenetre: window.innerHeight,
      etapesCoupees: et.filter(e => !e.vu).map(e => e.n),
      boutonCoupe: btn ? btn.bottom > window.innerHeight : null,
      overlayScrollable: ov ? getComputedStyle(ov).overflowY : '?',
      overlayPeutDefiler: ov ? ov.scrollHeight > ov.clientHeight + 1 : null,
    };
  });
  console.log(`1280×${h}`.padEnd(10), JSON.stringify(m));
  await page.screenshot({ path: `captures/ux-diag-accueil-1280x${h}.png` });
  await page.close();
}
await b.close();
