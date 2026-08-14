// Page de banc d'épreuve : exécute un moteur OCR sur toutes les captures de
// bench/shots/ et renvoie les scores. Pilotée par bench/run.mjs (Playwright).
//
//   window.lancerBanc('ancien' | 'nouveau') → { scores, total, details }

import { noter, cumuler, type CasVerite, type Score, type TableauMesure } from './notation';

const sortie = document.getElementById('sortie')!;

function charger(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('image illisible ' + url));
    im.src = url;
  });
}

/** Ancien moteur : prétraitement par défaut → OCR global → reconstruction géométrique. */
async function moteurAncien(img: HTMLImageElement): Promise<TableauMesure> {
  const { processImage, defaultProcessOptions } = await import('./ancien/image');
  const { runOcr } = await import('./ancien/ocr');
  const { parseTable } = await import('./ancien/tableParser');
  const canvas = processImage(img, defaultProcessOptions());
  const t = parseTable((await runOcr(canvas)).words);
  return {
    dates: t.dates,
    lignes: t.rows.map(r => ({
      nom: r.name,
      unite: r.unit,
      valeurs: r.values.map(v => (v === null ? '' : String(v))),
      // L'ancien écran surligne en dessous de 65 % de confiance Tesseract.
      douteux: r.conf.map(c => c > 0 && c < 65),
    })),
  };
}

/** Nouveau moteur : chaîne complète refondue. */
async function moteurNouveau(img: HTMLImageElement): Promise<TableauMesure> {
  const { reconnaitreTableau } = await import('../src/lib/ocr/pipeline');
  const t = await reconnaitreTableau(img);
  return {
    dates: t.dates.map(d => d.iso ?? ''),
    datesDouteuses: t.dates.map(d => d.douteux),
    lignes: t.lignes.map(l => ({
      nom: l.nom,
      unite: l.unite,
      valeurs: l.cellules.map(c => c.texte),
      douteux: l.cellules.map(c => c.douteux),
    })),
  };
}

async function lancerBanc(moteur: 'ancien' | 'nouveau', filtre?: string) {
  const verite: CasVerite[] = await (await fetch('./shots/verite.json')).json();
  const cas = filtre ? verite.filter(c => c.id.includes(filtre)) : verite;
  const scores: Score[] = [];
  const details: any[] = [];
  for (const c of cas) {
    const t0 = performance.now();
    const img = await charger('./shots/' + c.fichier);
    let res: TableauMesure;
    try {
      res = moteur === 'ancien' ? await moteurAncien(img) : await moteurNouveau(img);
    } catch (e: any) {
      res = { dates: [], lignes: [] };
      details.push({ id: c.id, erreur: String(e?.message || e) });
    }
    const ms = Math.round(performance.now() - t0);
    const s = noter(c, res);
    scores.push(s);
    details.push({ id: c.id, ms, dates: res.dates, lignes: res.lignes });
    sortie.textContent += `\n${c.id} : ${s.cellulesJustes}/${s.cellules} cellules, ${s.datesJustes}/${s.dates} dates (${ms} ms)`;
  }
  return { moteur, scores, total: cumuler(scores), details };
}

(window as any).lancerBanc = lancerBanc;
(window as any).bancPret = true;
sortie.textContent = 'Banc prêt.';
