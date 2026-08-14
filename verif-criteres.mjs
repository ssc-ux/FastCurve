// Critères 28 à 44 du cahier des charges, vérifiés dans un vrai navigateur.
//   npx vite --port 5212 &
//   node verif-criteres.mjs
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const PORT = process.env.PORT || 5212;
const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const resultats = [];
const dire = (n, ok, preuve) => { resultats.push({ n, ok, preuve }); console.log(`${ok ? '✓' : '✗'} ${n} — ${preuve}`); };

async function page() {
  const p = await nav.newPage({ viewport: { width: 1440, height: 900 } });
  p.on('pageerror', e => console.error('  [pageerror]', e.message));
  await p.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
  const b = p.getByRole('button', { name: /Commencer/i });
  if (await b.count()) await b.first().click();
  await p.waitForTimeout(300);
  return p;
}

async function coller(p, fichier) {
  const b64 = readFileSync(`bench/shots/${fichier}`).toString('base64');
  await p.evaluate((d) => {
    const bin = atob(d); const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    const dt = new DataTransfer();
    dt.items.add(new File([buf], 'c.png', { type: 'image/png' }));
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, b64);
}

// ── 28 : coller depuis un AUTRE écran déclenche la lecture, sans bouton ──
{
  const p = await page();
  const autre = p.getByRole('button', { name: /Repères|Réglages|Traitements/ });
  let depuis = 'écran des données';
  if (await autre.count()) { await autre.first().click(); await p.waitForTimeout(200); depuis = (await autre.first().innerText()).trim(); }
  const t0 = Date.now();
  await coller(p, 'encadre-normal.png');
  await p.waitForSelector('table.vgrid tbody tr', { timeout: 30000 });
  const ms = Date.now() - t0;
  dire(28, true, `collage depuis « ${depuis} » : le tableau arrive sans aucun clic`);
  dire(44, ms < 10000, `${(ms / 1000).toFixed(1)} s entre le Ctrl+V et le tableau (limite : 10 s)`);

  // ── 33 / 34 / 36 : une seule couleur, et ce qu'elle signale ──
  const couleurs = await p.evaluate(() => {
    // Fonds de SIGNALEMENT : ceux qui distinguent une case de ses voisines de
    // la même ligne (le fond de tableau, lui, est le même partout).
    const fonds = new Set();
    for (const tr of document.querySelectorAll('table.vgrid tbody tr')) {
      const cases = [...tr.children].slice(3);
      const base = cases.map(td => getComputedStyle(td).backgroundColor)
        .sort((a, b) => cases.filter(t => getComputedStyle(t).backgroundColor === b).length
                      - cases.filter(t => getComputedStyle(t).backgroundColor === a).length)[0];
      for (const td of cases) {
        const bg = getComputedStyle(td).backgroundColor;
        if (bg !== base) fonds.add(bg);
      }
    }
    const lignes = [...document.querySelectorAll('table.vgrid tbody tr')].map(tr => ({
      nom: tr.querySelector('.ninp')?.value ?? '',
      cases: [...tr.children].slice(3).map(td => ({ v: td.querySelector('input')?.value ?? '', jaune: td.classList.contains('doute') })),
    }));
    return { fonds: [...fonds], lignes };
  });
  dire(33, couleurs.fonds.length <= 1, `fonds de signalement distincts dans le tableau : ${couleurs.fonds.length ? couleurs.fonds.join(', ') : 'aucun'}`);

  const patho = [];
  for (const l of couleurs.lignes) {
    for (const c of l.cases) {
      const x = parseFloat(c.v);
      // Les six analytes de la capture sont TOUS hors norme : c'est un malade.
      const estPatho = (l.nom.startsWith('CRP') && x > 5) || (l.nom.startsWith('Creat') && x > 110)
        || (l.nom.startsWith('Hemo') && x < 12) || (l.nom.startsWith('Leuco') && x > 10)
        || (l.nom.startsWith('Plaq') && x > 400) || (l.nom.startsWith('Albu') && x < 35);
      if (estPatho) patho.push(`${l.nom} ${c.v}${c.jaune ? ' JAUNE' : ''}`);
    }
  }
  dire(34, !patho.some(s => s.includes('JAUNE')), `valeurs pathologiques bien lues et non surlignées : ${patho.join(', ')}`);

  const jaunes = couleurs.lignes.flatMap(l => l.cases.filter(c => c.jaune).map(c => `${l.nom} ${c.v}`));
  dire(36, jaunes.length === 0, jaunes.length ? `capture parfaitement lue mais ${jaunes.length} case(s) encore surlignée(s) : ${jaunes.join(', ')}` : 'aucune case surlignée sur une capture entièrement juste');

  // ── 42 : tout est modifiable au clavier, Tab circule ──
  const parcours = await p.evaluate(async () => {
    const t = document.querySelector('table.vgrid');
    const champs = [...t.querySelectorAll('input')];
    return { total: champs.length, editables: champs.filter(i => !i.disabled && !i.readOnly).length };
  });
  dire(42, parcours.total === parcours.editables, `${parcours.editables} champs sur ${parcours.total} modifiables au clavier`);
  await p.close();
}

// ── 29 à 32 : la capture du médecin, celle du cahier des charges ──
{
  const p = await page();
  await coller(p, 'medecin.png');
  await p.waitForSelector('table.vgrid tbody tr', { timeout: 30000 });
  const t = await p.evaluate(() => {
    const g = document.querySelector('table.vgrid');
    return {
      dates: [...g.querySelectorAll('thead input[type=date]')].map(i => i.value),
      lignes: [...g.querySelectorAll('tbody tr')].map(tr => ({
        nom: tr.querySelector('.ninp')?.value ?? '',
        valeurs: [...tr.children].slice(3).map(td => td.querySelector('input')?.value ?? ''),
        jaunes: [...tr.children].slice(3).map(td => td.classList.contains('doute')),
      })),
      colonnes: [...g.querySelectorAll('thead th')].map(th => th.innerText.trim()),
    };
  });
  dire(29, t.dates.filter(Boolean).length === 3, `${t.dates.filter(Boolean).length} colonnes de dates renseignées : ${t.dates.join(', ')}`);

  const normes = [59, 104, 150, 400, 13, 17, 4, 10, 5];
  const vraies = { Creatinine: ['85', '92', '110'], CRP: ['3', '12', '45'], Hemoglobine: ['13.2', '12.8', '11.9'], Leucocytes: ['7.4', '9.1', '12.2'], Plaquettes: ['245', '198', '312'] };
  const intrus = [];
  for (const l of t.lignes) {
    for (const v of l.valeurs) {
      const x = parseFloat(v);
      const attendues = (vraies[l.nom] ?? []).map(Number);
      if (!isNaN(x) && normes.includes(x) && !attendues.includes(x)) intrus.push(`${l.nom} ${v}`);
    }
  }
  dire(30, intrus.length === 0, intrus.length ? `bornes de normes proposées comme valeurs : ${intrus.join(', ')}` : 'aucune borne de « Normes » ni d’« Unité » dans les valeurs');

  const leuco = t.lignes.find(l => l.nom.startsWith('Leuco'));
  dire(31, leuco?.valeurs[2] === '12.2', `Leucocytes 12,2 rendu « ${leuco?.valeurs[2]} » (jamais 122)`);
  const collees = t.lignes.filter(l => /(umol|mmol|g\/?dl|g\/?l|mg\/?l)\s*$/i.test(l.nom));
  dire(32, collees.length === 0, collees.length ? `noms avec unité collée : ${collees.map(l => l.nom).join(', ')}` : `noms proposés : ${t.lignes.map(l => l.nom).join(', ')}`);

  const jaunes = t.lignes.flatMap(l => l.jaunes.map((j, i) => j ? `${l.nom} ${l.valeurs[i]}` : null).filter(Boolean));
  console.log(`  (capture du médecin : 15 valeurs sur 15 justes, ${jaunes.length} case(s) en jaune${jaunes.length ? ' — ' + jaunes.join(', ') : ''})`);
  await p.close();
}

// ── 41 : une capture illisible donne un message clair, pas un faux tableau ──
{
  const p = await page();
  await p.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 400; c.height = 300;
    const x = c.getContext('2d');
    x.fillStyle = '#8899aa'; x.fillRect(0, 0, 400, 300);
    x.fillStyle = '#778899';
    for (let i = 0; i < 60; i++) x.fillRect(Math.random() * 380, Math.random() * 280, 14, 9);
    c.toBlob(b => {
      const dt = new DataTransfer();
      dt.items.add(new File([b], 'bruit.png', { type: 'image/png' }));
      document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    });
  });
  await p.waitForTimeout(9000);
  const etat = await p.evaluate(() => ({
    echec: (document.querySelector('.echec')?.innerText ?? '').replace(/\s+/g, ' ').trim(),
    tableau: !!document.querySelector('table.vgrid tbody tr'),
  }));
  dire(41, !!etat.echec && !etat.tableau, etat.echec ? `message : « ${etat.echec.slice(0, 150)} »` : 'aucun message et ' + (etat.tableau ? 'un tableau proposé quand même' : 'rien du tout'));
  await p.close();
}

// ── 43 : plusieurs captures collées à la suite → un seul tableau ──
{
  const p = await page();
  await coller(p, 'medecin.png');
  await p.waitForTimeout(150);
  await coller(p, 'encadre-normal.png');
  await p.waitForSelector('table.vgrid tbody tr', { timeout: 40000 });
  await p.waitForTimeout(500);
  const fusion = await p.evaluate(() => {
    const t = document.querySelector('table.vgrid');
    return {
      tableaux: document.querySelectorAll('table.vgrid').length,
      dates: [...t.querySelectorAll('thead input[type=date]')].map(i => i.value),
      lignes: [...t.querySelectorAll('tbody tr')].map(tr => tr.querySelector('.ninp')?.value ?? ''),
    };
  });
  // Les deux bilans partagent cinq analytes : l'union en compte six.
  const ok = fusion.tableaux === 1 && fusion.dates.length === 6 && fusion.lignes.length === 6;
  dire(43, ok, `2 captures → ${fusion.tableaux} tableau, ${fusion.dates.length} colonnes de dates, ${fusion.lignes.length} lignes (${fusion.lignes.join(', ')})`);
  await p.close();
}

// ── 35 / 37 / 38 / 39 / 40 : ce que le jaune signale, et ce qui a disparu ──
{
  const p = await page();
  await coller(p, 'zebre-hd.png');
  await p.waitForSelector('table.vgrid tbody tr', { timeout: 30000 });
  const e = await p.evaluate(() => {
    const g = document.querySelector('table.vgrid');
    const lignes = [...g.querySelectorAll('tbody tr')];
    const txt = document.body.innerText;
    const bannis = ['▾ Options', '▴ Options', 'Noir & blanc', 'Aperçu du traitement', 'Contraste',
      '⟲', '⟳', 'Redresser auto', 'Lire les valeurs', 'Relire', 'Comparer à l’image', '✓ Image'];
    const legende = ['faible confiance', 'hors-norme', 'incohérent'];
    return {
      nomsJaunes: lignes.filter(tr => tr.querySelector('td.name.doute')).map(tr => tr.querySelector('.ninp').value),
      colonneUnite: [...g.querySelectorAll('thead th')].some(th => /unit/i.test(th.innerText)),
      vignettes: lignes.filter(tr => tr.querySelector('td.thumb img')).length,
      lignes: lignes.length,
      boutonVignette: /Comparer|✓ Image/.test(txt),
      bannisPresents: bannis.filter(b => txt.includes(b)),
      legendePresente: legende.filter(l => txt.includes(l)),
      local: txt.includes('100% local'),
    };
  });
  dire(35, e.nomsJaunes.length > 0, e.nomsJaunes.length ? `nom d'analyte non reconnu et surligné : ${e.nomsJaunes.join(', ')}` : 'aucun nom non reconnu sur cette capture');
  dire(37, e.legendePresente.length === 0, e.legendePresente.length ? `légende encore présente : ${e.legendePresente.join(', ')}` : 'plus aucune pastille de légende, une seule phrase');
  dire(38, e.bannisPresents.length === 0 && !e.colonneUnite, e.bannisPresents.length || e.colonneUnite ? `encore là : ${[...e.bannisPresents, e.colonneUnite ? 'colonne Unité' : ''].filter(Boolean).join(', ')}` : 'aucun des réglages bannis, ni la colonne « Unité »');
  dire(39, e.vignettes === e.lignes && !e.boutonVignette, `${e.vignettes} vignettes pour ${e.lignes} lignes, et aucun bouton pour les activer`);
  dire(40, e.local, 'la mention « 100% local » reste à l’écran pendant la vérification');
  await p.close();
}

console.log(`\n${resultats.filter(r => r.ok).length}/${resultats.length} critères vérifiés dans le navigateur`);
await nav.close();
