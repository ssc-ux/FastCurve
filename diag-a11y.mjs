// Diagnostic accessibilité : focus visible, cibles de clic, contrastes.
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await b.newPage({ viewport: { width: 1280, height: 800 } });
await page.addInitScript(() => localStorage.setItem('fastcurve.welcome.v1', '1'));
await page.goto('http://localhost:5213/');
await page.waitForTimeout(700);
const c = page.locator('button', { hasText: 'Commencer' }).first();
if (await c.count() && await c.isVisible().catch(() => false)) await c.click();
await page.waitForTimeout(300);

console.log('\n===== Ordre de tabulation depuis le haut de page =====');
for (let i = 0; i < 18; i++) {
  await page.keyboard.press('Tab');
  const a = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return { tag: 'BODY', txt: '(rien)', outline: '-', shadow: '-' };
    const cs = getComputedStyle(el);
    return {
      tag: el.tagName,
      txt: (el.getAttribute('aria-label') || el.textContent || el.placeholder || el.className || '').toString().replace(/\s+/g, ' ').trim().slice(0, 30),
      outline: `${cs.outlineStyle}/${cs.outlineWidth}`,
      shadow: cs.boxShadow === 'none' ? 'none' : 'oui',
    };
  });
  console.log(String(i + 1).padStart(2), a.tag.padEnd(7), a.txt.padEnd(32), 'outline=' + a.outline.padEnd(12), 'shadow=' + a.shadow);
}

console.log('\n===== Cibles de clic < 32 px (barre du haut + onglets) =====');
const petits = await page.evaluate(() => {
  return [...document.querySelectorAll('.topbar button, .topbar label, .tabs button, .modeseg button, .depart button')]
    .map(el => {
      const r = el.getBoundingClientRect();
      return { t: (el.textContent || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 28), w: Math.round(r.width), h: Math.round(r.height) };
    })
    .filter(x => x.h < 32 || x.w < 32);
});
petits.forEach(p => console.log(` ${p.t.padEnd(30)} ${p.w}×${p.h}`));

console.log('\n===== Contrastes de texte (ratio WCAG) =====');
const contrastes = await page.evaluate(() => {
  const lum = (rgb) => {
    const [r, g, b] = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const parse = (s) => (s.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number);
  const fond = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const bg = getComputedStyle(n).backgroundColor;
      const p = parse(bg);
      if (bg && !bg.includes('rgba(0, 0, 0, 0)') && p.length === 3) return p;
      n = n.parentElement;
    }
    return [255, 255, 255];
  };
  const out = [];
  const vus = new Set();
  for (const el of document.querySelectorAll('body *')) {
    const txt = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(' ').trim();
    if (!txt || txt.length < 2) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const fg = parse(cs.color), bg = fond(el);
    if (fg.length !== 3) continue;
    const l1 = lum(fg), l2 = lum(bg);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const px = parseFloat(cs.fontSize);
    const gras = parseInt(cs.fontWeight) >= 700;
    const seuil = (px >= 18.66 || (px >= 24) || (gras && px >= 18.66)) ? 3 : 4.5;
    const cle = txt.slice(0, 24) + px;
    if (ratio < seuil && !vus.has(cle)) { vus.add(cle); out.push({ txt: txt.slice(0, 34), ratio: ratio.toFixed(2), px, seuil, couleur: cs.color }); }
  }
  return out;
});
contrastes.forEach(x => console.log(` ${x.txt.padEnd(36)} ${x.ratio} (seuil ${x.seuil}) ${x.px}px ${x.couleur}`));
if (!contrastes.length) console.log(' aucun défaut détecté sur cet écran');

console.log('\n===== Répartition verticale saisie / courbe (critère 27) =====');
const rep = await page.evaluate(() => {
  const s = document.querySelector('.sidebar').getBoundingClientRect();
  const ch = document.querySelector('.chart-area').getBoundingClientRect();
  return { saisie: Math.round(s.height), courbe: Math.round(ch.height), fenetre: window.innerHeight,
           partSaisie: Math.round(100 * s.height / (s.height + ch.height)) + '%' };
});
console.log(' ', JSON.stringify(rep));

await page.close();
await b.close();
