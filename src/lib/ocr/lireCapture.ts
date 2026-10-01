// ──────────────────────────────────────────────────────────────
// Lecture d'une CAPTURE d'écran : moteur des captures (Tesseract, case par
// case) d'abord ; s'il échoue, le moteur photo (PaddleOCR) en secours.
//
// Le moteur des captures découpe le tableau par l'encre : il lui faut
// plusieurs lignes de résultats pour reconnaître les colonnes, et il refuse
// par prudence un tableau d'une seule ligne (un seul examen suivi sur
// plusieurs dates). Le moteur photo, lui, rattache chaque nombre à la date
// au-dessus de lui : il lit ces cas sans risque de décalage de colonne.
// ──────────────────────────────────────────────────────────────

import { reconnaitreTableau, type OptionsReconnaissance, type TableauLu } from './pipeline';

export async function lireCapture(img: HTMLImageElement | HTMLCanvasElement, opts: OptionsReconnaissance = {}): Promise<TableauLu> {
  const t = await reconnaitreTableau(img, opts);
  if (!t.echec || opts.annule?.()) return t;
  try {
    const { lireTableauPhoto } = await import('../photo/tableauPhoto');
    let c: HTMLCanvasElement;
    if (img instanceof HTMLCanvasElement) c = img;
    else {
      c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d')!.drawImage(img, 0, 0);
    }
    const secours = await lireTableauPhoto(c, {
      vignettes: opts.vignettes,
      annule: opts.annule,
      onProgress: (f, tot) => opts.onProgress?.(f, tot, 'Seconde méthode de lecture…'),
    });
    return secours.echec ? t : secours;
  } catch {
    return t; // moteur photo indisponible : le premier échec reste le verdict
  }
}
