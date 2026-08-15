// Génère le jeu d'épreuve : des captures d'écran réalistes de tableaux de
// résultats de laboratoire, avec leur vérité terrain (JSON).
//
//   node bench/gen.mjs
//
// Les images sont écrites dans bench/shots/, la vérité terrain dans
// bench/shots/verite.json. Aucun réseau : tout est rendu localement par
// Chromium (Playwright).

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = dirname(fileURLToPath(import.meta.url));
const SORTIE = join(ICI, 'shots');
mkdirSync(SORTIE, { recursive: true });

import { BILAN_A, BILAN_B, BILAN_C, BILAN_D, BILAN_MEDECIN } from './bilans.mjs';

// ── Gabarits HTML (styles de « serveur de résultats » variés) ────────
function styleCommun(police, taille) {
  return `
    * { box-sizing: border-box; }
    body { margin: 0; padding: 22px; font-family: ${police}; font-size: ${taille}px; background: #fff; color: #111; }
    h1 { font-size: ${taille + 3}px; margin: 0 0 4px; }
    .meta { font-size: ${taille - 2}px; color: #666; margin-bottom: 14px; }
    table { border-collapse: collapse; }
    td, th { white-space: nowrap; }
  `;
}

// Gabarit 1 : tableau encadré classique, en-tête gris, valeurs alignées à droite.
function gabaritEncadre(bilan, o = {}) {
  const taille = o.taille ?? 13;
  const police = o.police ?? "'Liberation Sans', Arial, sans-serif";
  const encre = o.encre ?? '#111';
  const fond = o.fond ?? '#fff';
  return `<style>${styleCommun(police, taille)}
    body { background: ${fond}; color: ${encre}; }
    table { border: 1px solid #b8c0c8; }
    th, td { border: 1px solid #d5dbe1; padding: ${o.dense ? '3px 8px' : '6px 14px'}; }
    thead th { background: #eef2f6; font-weight: 700; }
    td.v { text-align: right; }
    td.n { font-weight: 600; }
    td.u, td.r { color: #666; font-size: ${taille - 1}px; }
  </style>
  <h1>SERVEUR DE RESULTATS — BIOCHIMIE / HEMATOLOGIE</h1>
  <div class="meta">Dossier 000-BETA · Edition du 20/05/2025</div>
  <table>
    <thead><tr><th>Analyte</th>${bilan.entetes.map(d => `<th>${d}</th>`).join('')}<th>Unite</th><th>Valeurs usuelles</th></tr></thead>
    <tbody>
      ${bilan.lignes.map(l => `<tr><td class="n">${l.nom}</td>${l.valeurs.map(v => `<td class="v">${v}</td>`).join('')}<td class="u">${l.unite}</td><td class="r">${l.normes}</td></tr>`).join('')}
    </tbody>
  </table>`;
}

// Gabarit 2 : sans bordures, zébrures, colonnes séparées par du blanc.
function gabaritZebre(bilan, o = {}) {
  const taille = o.taille ?? 12;
  const police = o.police ?? "'DejaVu Sans', sans-serif";
  return `<style>${styleCommun(police, taille)}
    table { border: none; }
    th, td { padding: ${o.dense ? '2px 10px' : '5px 18px'}; border: none; }
    thead th { border-bottom: 2px solid #333; text-align: center; }
    tbody tr:nth-child(odd) { background: #f4f6f8; }
    td.v { text-align: right; }
    td.u { color: #555; }
  </style>
  <h1>Suivi biologique — resultats cumules</h1>
  <div class="meta">Laboratoire Central · imprime le 21/05/2025</div>
  <table>
    <thead><tr><th style="text-align:left">Parametre</th><th>Unite</th>${bilan.entetes.map(d => `<th>${d}</th>`).join('')}</tr></thead>
    <tbody>
      ${bilan.lignes.map(l => `<tr><td>${l.nom}</td><td class="u">${l.unite}</td>${l.valeurs.map(v => `<td class="v">${v}</td>`).join('')}</tr>`).join('')}
    </tbody>
  </table>`;
}

// Gabarit 3 : serif, faible contraste (encre grise sur fond crème).
function gabaritSerif(bilan, o = {}) {
  const taille = o.taille ?? 13;
  return `<style>${styleCommun("'Liberation Serif', Georgia, serif", taille)}
    body { background: #faf9f6; color: #3a3a3a; }
    table { border-top: 1px solid #999; border-bottom: 1px solid #999; }
    th, td { padding: 5px 16px; }
    thead th { border-bottom: 1px solid #999; }
    td.v { text-align: right; }
  </style>
  <h1>Compte rendu d'analyses</h1>
  <div class="meta">Resultats du 01/01/2023 au 31/12/2026 — page 1/1</div>
  <table>
    <thead><tr><th style="text-align:left">Analyse</th>${bilan.entetes.map(d => `<th>${d}</th>`).join('')}<th>Unite</th></tr></thead>
    <tbody>
      ${bilan.lignes.map(l => `<tr><td>${l.nom}</td>${l.valeurs.map(v => `<td class="v">${v}</td>`).join('')}<td>${l.unite}</td></tr>`).join('')}
    </tbody>
  </table>`;
}

// Gabarit 4 : en-tête sombre, valeurs anormales en orange avec flèches.
function gabaritFleches(bilan, o = {}) {
  const taille = o.taille ?? 12.5;
  return `<style>${styleCommun("'DejaVu Sans', sans-serif", taille)}
    table { border: 1px solid #ccc; }
    th, td { border: 1px solid #e2e2e2; padding: 5px 12px; }
    thead th { background: #2f4858; color: #fff; }
    td.v { text-align: right; }
    td.v.anormal { color: #c8641e; font-weight: 600; }
  </style>
  <h1>Sillage — Resultats biologiques</h1>
  <div class="meta">Service de medecine interne</div>
  <table>
    <thead><tr><th>Libelle</th><th>Unite</th>${bilan.entetes.map(d => `<th>${d}</th>`).join('')}</tr></thead>
    <tbody>
      ${bilan.lignes.map(l => `<tr><td>${l.nom}</td><td>${l.unite}</td>${l.valeurs.map((v, i) => `<td class="v${i % 2 === 0 ? ' anormal' : ''}">${v}</td>`).join('')}</tr>`).join('')}
    </tbody>
  </table>`;
}


// Gabarit 5 : la capture du médecin — zébrures, colonne Unité, colonne Normes,
// valeurs pathologiques en orange avec une flèche. Le pire cas réel.
function gabaritMedecin(bilan, o = {}) {
  const taille = o.taille ?? 12;
  const anormal = (nom, v) => {
    const x = parseFloat(String(v).replace(',', '.'));
    if (nom === 'Creatinine') return x > 104;
    if (nom === 'CRP') return x > 5;
    if (nom === 'Hemoglobine') return x < 13;
    if (nom === 'Leucocytes') return x > 10 || x < 4;
    if (nom === 'Plaquettes') return x > 400 || x < 150;
    return false;
  };
  return `<style>${styleCommun("'Liberation Sans', Arial, sans-serif", taille)}
    table { border: 1px solid #cfd6dc; }
    th, td { border: none; padding: ${o.dense ? '3px 10px' : '6px 14px'}; }
    thead th { background: #e9eef3; border-bottom: 1px solid #cfd6dc; }
    tbody tr:nth-child(even) { background: #f4f6f8; }
    td.v { text-align: right; }
    td.v.ano { color: #c8641e; font-weight: 600; }
    td.u, td.r { color: #666; }
  </style>
  <h1>LABORATOIRE — RESULTATS CUMULES</h1>
  <div class="meta">Patient 00-XYZ · edite le 21/09/2024</div>
  <table>
    <thead><tr><th style="text-align:left">Analyse</th>${bilan.entetes.map(d => `<th>${d}</th>`).join('')}<th>Unite</th><th>Normes</th></tr></thead>
    <tbody>
      ${bilan.lignes.map(l => `<tr><td>${l.nom}</td>${l.valeurs.map(v => `<td class="v${anormal(l.nom, v) ? ' ano' : ''}">${v}${anormal(l.nom, v) ? ' \u2191' : ''}</td>`).join('')}<td class="u">${l.unite}</td><td class="r">${l.normes}</td></tr>`).join('')}
    </tbody>
  </table>`;
}

// ── Liste des captures à produire ───────────────────────────────────
const CAS = [
  { id: 'encadre-normal', bilan: BILAN_A, html: gabaritEncadre, opts: {}, dsf: 1, largeur: 900 },
  { id: 'encadre-petit', bilan: BILAN_A, html: gabaritEncadre, opts: { taille: 10, dense: true }, dsf: 1, largeur: 700 },
  { id: 'zebre-normal', bilan: BILAN_B, html: gabaritZebre, opts: {}, dsf: 1, largeur: 950 },
  { id: 'zebre-petit', bilan: BILAN_B, html: gabaritZebre, opts: { taille: 10, dense: true }, dsf: 1, largeur: 760 },
  { id: 'serif-palecontraste', bilan: BILAN_C, html: gabaritSerif, opts: {}, dsf: 1, largeur: 900 },
  { id: 'serif-petit', bilan: BILAN_C, html: gabaritSerif, opts: { taille: 11 }, dsf: 1, largeur: 800 },
  { id: 'fleches-anormales', bilan: BILAN_D, html: gabaritFleches, opts: {}, dsf: 1, largeur: 880 },
  { id: 'encadre-gris', bilan: BILAN_C, html: gabaritEncadre, opts: { encre: '#5a5a5a', fond: '#f7f7f7', taille: 12 }, dsf: 1, largeur: 880 },
  { id: 'zebre-hd', bilan: BILAN_D, html: gabaritZebre, opts: { taille: 13 }, dsf: 2, largeur: 900 },
  { id: 'encadre-minuscule', bilan: BILAN_B, html: gabaritEncadre, opts: { taille: 9, dense: true }, dsf: 1, largeur: 640 },
  { id: 'medecin', bilan: BILAN_MEDECIN, html: gabaritMedecin, opts: {}, dsf: 1, largeur: 820 },
  { id: 'medecin-petit', bilan: BILAN_MEDECIN, html: gabaritMedecin, opts: { taille: 10, dense: true }, dsf: 1, largeur: 660 },
];

const navigateur = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const verite = [];

for (const cas of CAS) {
  const page = await navigateur.newPage({
    viewport: { width: cas.largeur, height: 900 },
    deviceScaleFactor: cas.dsf,
  });
  await page.setContent(cas.html(cas.bilan, cas.opts), { waitUntil: 'load' });
  const boite = await page.locator('table').boundingBox();
  const fichier = join(SORTIE, cas.id + '.png');
  await page.screenshot({
    path: fichier,
    clip: { x: 0, y: 0, width: cas.largeur, height: Math.ceil(boite.y + boite.height) + 16 },
  });
  await page.close();
  verite.push({
    id: cas.id,
    fichier: cas.id + '.png',
    dates: cas.bilan.dates,
    lignes: cas.bilan.lignes.map(l => ({
      nom: l.nom,
      unite: l.unite,
      // Vérité terrain normalisée : point décimal, pas d'espace.
      valeurs: l.valeurs.map(v => v.replace(',', '.')),
    })),
  });
  console.log('capture', cas.id);
}

await navigateur.close();
writeFileSync(join(SORTIE, 'verite.json'), JSON.stringify(verite, null, 2));
console.log(`${verite.length} captures générées dans ${SORTIE}`);
