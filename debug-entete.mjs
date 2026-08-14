// Diagnostic : que lit-on exactement dans la bande d'en-tête ?
//   node debug-entete.mjs [capture]
import { chromium } from 'playwright';

const filtre = process.argv[2] || '';
const PORT = process.env.PORT || 5212;
const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await nav.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', e => console.error('[pageerror]', e.message));
await page.goto(`http://localhost:${PORT}/bench/banc.html`, { waitUntil: 'load' });
await page.waitForFunction('window.bancPret === true', null, { timeout: 30000 });

const res = await page.evaluate(async (f) => {
  const prep = await import('/src/lib/ocr/preparation.ts');
  const st = await import('/src/lib/ocr/structure.ts');
  const pl = await import('/src/lib/ocr/pipeline.ts');
  const ocr = await import('/src/lib/ocr/ocr.ts');
  const roles = await import('/src/lib/ocr/roles.ts');
  const verite = await (await fetch('./shots/verite.json')).json();
  const cas = f ? verite.filter(c => c.id.includes(f)) : verite;
  const out = [];
  for (const c of cas) {
    const img = await new Promise((r, j) => { const i = new Image(); i.onload = () => r(i); i.onerror = j; i.src = './shots/' + c.fichier; });
    const source = prep.canvasSource(img);
    const gris = prep.grisCanalMin(source);
    const { carte, polarite } = prep.carteEncreLocale(gris);
    const toutes = st.detecterBandes(carte);
    const hL = st.hauteurLigne(toutes) || 12;
    const bandes = pl.isolerTableau(carte, toutes, hL);
    const colonnes = pl.decouperTableau(carte, bandes.slice(1), hL);
    const marge = Math.max(2, Math.round(hL * 0.3));
    const rendre = (bande, col) => {
      const b = st.boiteEncre(carte, bande, col);
      const x0 = col.x0, x1 = col.x1;
      let sombres = 0;
      for (let y = bande.y0; y <= bande.y1; y++) sombres += polarite[y] || 0;
      return prep.rendreCellule(source, { x0, y0: bande.y0 - marge, x1, y1: bande.y1 + marge },
        { inverse: sombres > (bande.y1 - bande.y0 + 1) / 2 });
    };
    const seuilTab = Math.max(4, Math.round(hL * 0.42));
    const diag = toutes.map(b => ({
      y: `${b.y0}-${b.y1}`, h: b.y1 - b.y0 + 1,
      gap: pl.ecartMaxInterne(carte, b), tab: pl.ecartMaxInterne(carte, b) >= seuilTab,
      garde: bandes.some(x => x.y0 === b.y0),
    }));
    const bornes = { gauche: colonnes[0].x0, droite: colonnes[colonnes.length - 1].x1 };
    const blocs = pl.blocsDeBande(gris, bandes[0], hL, bornes);
    const plages = colonnes.map((col, ci) => {
      const p = pl.plageEntete(colonnes, ci, carte.largeur);
      const b = pl.blocPourColonne(blocs, col, hL);
      const m = Math.max(2, Math.round(hL * 0.2));
      return b && b.x0 >= p.x0 - hL && b.x1 <= p.x1 + hL ? { x0: b.x0 - m, x1: b.x1 + m } : p;
    });
    const cvs = plages.map(col => rendre(bandes[0], col));
    const txt = (await ocr.lireCellules(cvs, 'texte')).map(x => x.texte + '@' + Math.round(x.confiance));
    const dat = (await ocr.lireCellules(cvs, 'date')).map(x => x.texte + '@' + Math.round(x.confiance));
    out.push({
      id: c.id, hL, nbBandesTotal: toutes.length, nbBandes: bandes.length,
      colonnes: colonnes.map((x, i) => `${x.x0}-${x.x1}→${plages[i].x0}-${plages[i].x1}`),
      entetesTexte: txt, entetesDate: dat,
      dateParsee: dat.map(t => { const d = roles.lireDate(t.split('@')[0]); return d ? d.iso : null; }),
      diag, seuilTab, blocs: blocs.map(b=>`${b.x0}-${b.x1}`),
      bandeEntete: `${bandes[0].y0}-${bandes[0].y1}`,
    });
  }
  return out;
}, filtre);

for (const r of res) {
  console.log('==', r.id, `hL=${r.hL} bandes=${r.nbBandes}/${r.nbBandesTotal} cols=${r.colonnes.length}`);
  console.log('   cols   :', r.colonnes.join(' '));
  console.log('   texte  :', JSON.stringify(r.entetesTexte));
  console.log('   date   :', JSON.stringify(r.entetesDate));
  console.log('   parsée :', JSON.stringify(r.dateParsee));
  console.log('   blocs en-tête (y=' + r.bandeEntete + ') :', r.blocs.join(' ') || '(aucun — fond plein)');
  console.log('   bandes (seuil gap =', r.seuilTab, ') :');
  for (const d of r.diag) console.log(`     ${d.garde ? '✓' : ' '} y=${d.y} h=${d.h} gapMax=${d.gap} ${d.tab ? 'TAB' : '---'}`);
}
await nav.close();
