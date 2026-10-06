// Banc « photos d'écran » : chaque photo passe par la chaîne de la photo
// guidée (repérage, redressement, recadrage, anti-moiré) puis par la lecture.
// Les photos (données patient) restent en local dans bench/photos/ (ignoré par git).
//
//   npx vite --port 5212 &   puis   node bench/photos.mjs [filtre]
import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'node:fs';

const cas = JSON.parse(readFileSync('bench/photos/verite.json', 'utf8'));
const filtre = process.argv[2] || '';
const b = await chromium.launch({ executablePath: existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined });
const p = await b.newPage();
p.on('pageerror', e => console.log('  [pageerror]', e.message));
await p.goto('http://localhost:5212/bench/banc.html');
await p.waitForFunction('window.bancPret === true');
let tot = { c: 0, j: 0, f: 0, fs: 0, m: 0 };
for (const c0 of cas.filter(x => x.id.includes(filtre))) {
  const c = { ...c0, coteMax: process.env.COTE ? +process.env.COTE : undefined, flou: process.env.FLOU !== undefined ? +process.env.FLOU : 0.6 };
  const r = await p.evaluate(async (c) => {
    const cam = await import('/src/lib/photo/camera.ts');
    const { reconnaitreTableau } = await import('/src/lib/ocr/pipeline.ts');
    const { noter } = await import('/bench/notation.ts');
    const im = new Image(); im.src = '/bench/photos/' + c.fichier; await im.decode();
    const v = document.createElement('canvas'); v.width = im.naturalWidth; v.height = im.naturalHeight;
    v.getContext('2d').drawImage(im, 0, 0);
    Object.defineProperty(v, 'videoWidth', { value: v.width });
    Object.defineProperty(v, 'videoHeight', { value: v.height });
    const a = cam.analyserImage(v, 0);
    const prete = cam.redresserPhoto(v, a.mesure.angle);
    window.__prete = prete.toDataURL('image/jpeg', 0.7);
    const { lireTableauPhoto } = await import('/src/lib/photo/tableauPhoto.ts');
    const t = await lireTableauPhoto(prete, { coteMax: c.coteMax });
    window.__traces = [];
    const res = t.echec ? { dates: [], lignes: [] } : {
      dates: t.dates.map(d => d.iso ?? ''),
      lignes: t.lignes.map(l => ({ nom: l.nom, unite: l.unite, valeurs: l.cellules.map(x => x.proposition ?? x.texte), douteux: l.cellules.map(x => x.douteux) })),
    };
    return { traces: window.__traces, img: window.__prete, lu: [res.dates.join(' '), ...res.lignes.map(l => l.nom + ': ' + l.valeurs.map((v, k) => v + (l.douteux[k] ? '?' : '')).join('|'))], verdict: a.verdict.message, angle: a.mesure.angle, boite: !!a.boiteRelative, echec: t.echec ? t.message : '', score: noter(c, res) };
  }, c);
  if (process.env.DETAIL) { console.log(r.traces.map(x => x.slice(0, 1500)).join('\n')); console.log(r.lu.join('\n')); (await import('node:fs')).writeFileSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'prete-' + c.id + '.jpg'), Buffer.from(r.img.split(',')[1], 'base64')); }
  const s = r.score;
  tot.c += s.cellules; tot.j += s.cellulesJustes; tot.f += s.cellulesFausses; tot.fs += s.fauxSilencieux; tot.m += s.cellulesManquantes;
  console.log(c.id.padEnd(9), `${s.cellulesJustes}/${s.cellules}`.padStart(8), `fausses ${s.cellulesFausses} (silencieuses ${s.fauxSilencieux}) manquantes ${s.cellulesManquantes} dates ${s.datesJustes}/${s.dates} lignes ${s.lignesTrouvees}/${s.lignes}`, `| cadre: ${r.verdict} ${r.boite ? '' : '(non repéré)'} angle ${r.angle}`, r.echec);
}
console.log('TOTAL', `${tot.j}/${tot.c}`, (100 * tot.j / tot.c).toFixed(1) + ' %', `fausses ${tot.f} (silencieuses ${tot.fs}) manquantes ${tot.m}`);
await b.close();
