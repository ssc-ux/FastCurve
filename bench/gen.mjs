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

// ── Données sources (vérité terrain) ────────────────────────────────
const BILAN_A = {
  dates: ['2025-03-12', '2025-04-09', '2025-05-14'],
  entetes: ['12/03/2025', '09/04/2025', '14/05/2025'],
  lignes: [
    { nom: 'Hemoglobine', unite: 'g/dL', valeurs: ['9.8', '10.9', '11.7'], normes: '12.0 - 16.0' },
    { nom: 'Leucocytes', unite: 'G/L', valeurs: ['14.2', '9.1', '7.4'], normes: '4.0 - 10.0' },
    { nom: 'Plaquettes', unite: 'G/L', valeurs: ['480', '365', '288'], normes: '150 - 400' },
    { nom: 'Creatinine', unite: 'umol/L', valeurs: ['168', '132', '115'], normes: '60 - 110' },
    { nom: 'CRP', unite: 'mg/L', valeurs: ['96', '28', '7'], normes: '< 5' },
    { nom: 'Albumine', unite: 'g/L', valeurs: ['28', '33', '37'], normes: '35 - 50' },
  ],
};

const BILAN_B = {
  dates: ['2024-01-15', '2024-03-04', '2024-06-18', '2024-09-02'],
  entetes: ['15/01/2024', '04/03/2024', '18/06/2024', '02/09/2024'],
  lignes: [
    { nom: 'Sodium', unite: 'mmol/L', valeurs: ['138', '141', '136', '140'], normes: '135 - 145' },
    { nom: 'Potassium', unite: 'mmol/L', valeurs: ['4,1', '3,8', '4,6', '4,0'], normes: '3,5 - 5,0' },
    { nom: 'Uree', unite: 'mmol/L', valeurs: ['8,2', '6,4', '12,1', '7,3'], normes: '2,5 - 7,5' },
    { nom: 'Creatinine', unite: 'umol/L', valeurs: ['142', '118', '205', '131'], normes: '60 - 110' },
    { nom: 'Calcium', unite: 'mmol/L', valeurs: ['2,31', '2,44', '2,18', '2,39'], normes: '2,20 - 2,60' },
    { nom: 'Phosphore', unite: 'mmol/L', valeurs: ['1,12', '0,94', '1,48', '1,05'], normes: '0,80 - 1,45' },
    { nom: 'Albumine', unite: 'g/L', valeurs: ['34', '38', '29', '36'], normes: '35 - 50' },
    { nom: 'CRP', unite: 'mg/L', valeurs: ['12', '<5', '48', '6'], normes: '< 5' },
  ],
};

const BILAN_C = {
  dates: ['2023-11-08', '2023-12-06'],
  entetes: ['08/11/2023', '06/12/2023'],
  lignes: [
    { nom: 'ASAT', unite: 'UI/L', valeurs: ['62', '38'], normes: '< 40' },
    { nom: 'ALAT', unite: 'UI/L', valeurs: ['81', '45'], normes: '< 40' },
    { nom: 'GGT', unite: 'UI/L', valeurs: ['155', '98'], normes: '< 55' },
    { nom: 'PAL', unite: 'UI/L', valeurs: ['210', '176'], normes: '40 - 130' },
    { nom: 'Bilirubine totale', unite: 'umol/L', valeurs: ['24', '15'], normes: '< 17' },
    { nom: 'TP', unite: '%', valeurs: ['68', '84'], normes: '70 - 100' },
    { nom: 'Fibrinogene', unite: 'g/L', valeurs: ['5,2', '3,7'], normes: '2,0 - 4,0' },
    { nom: 'Ferritine', unite: 'ug/L', valeurs: ['1240', '860'], normes: '30 - 300' },
    { nom: 'TSH', unite: 'mUI/L', valeurs: ['0,42', '1,85'], normes: '0,40 - 4,00' },
    { nom: 'Vitamine D', unite: 'nmol/L', valeurs: ['38', '62'], normes: '> 75' },
  ],
};

const BILAN_D = {
  dates: ['2026-02-03', '2026-02-17', '2026-03-10'],
  entetes: ['03/02/2026', '17/02/2026', '10/03/2026'],
  lignes: [
    { nom: 'Leucocytes', unite: 'G/L', valeurs: ['3,8', '5,1', '6,9'], normes: '4,0 - 10,0' },
    { nom: 'PNN', unite: 'G/L', valeurs: ['1,4', '2,7', '4,1'], normes: '1,5 - 7,0' },
    { nom: 'Lymphocytes', unite: 'G/L', valeurs: ['1,9', '1,7', '2,2'], normes: '1,0 - 4,0' },
    { nom: 'Plaquettes', unite: 'G/L', valeurs: ['96', '145', '232'], normes: '150 - 400' },
    { nom: 'Hemoglobine', unite: 'g/dL', valeurs: ['8,4', '9,6', '11,2'], normes: '12,0 - 16,0' },
    { nom: 'VGM', unite: 'fL', valeurs: ['104', '98', '92'], normes: '80 - 100' },
    { nom: 'IgG', unite: 'g/L', valeurs: ['4,8', '6,2', '8,1'], normes: '7,0 - 16,0' },
    { nom: 'C3', unite: 'g/L', valeurs: ['0,72', '0,95', '1,24'], normes: '0,90 - 1,80' },
    { nom: 'Anticorps anti-DNA', unite: 'UI/mL', valeurs: ['>300', '184', '46'], normes: '< 20' },
  ],
};

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
