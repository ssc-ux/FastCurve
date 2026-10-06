// ──────────────────────────────────────────────────────────────
// PRÉRÉGLAGE « IMPRESSION / N&B ».
//
// Une figure collée dans un compte-rendu finit souvent photocopiée en noir et
// blanc. Ce préréglage retouche le SVG produit par `renderChart` :
//  · textes gris → encre, et aucun texte sous 11 px (graduations, doses) ;
//  · palette des courbes → Okabe-Ito, lisible par les daltoniens et
//    distincte en niveaux de gris (le jaune pâle devient noir) ;
//  · bandes de normale → hachures, qui survivent à la photocopie ;
//  · anneau « hors-norme » rouge fin → anneau noir épais.
//
// Module PUR : une transformation de chaîne, testable hors navigateur.
// ──────────────────────────────────────────────────────────────

import { SERIES_COLORS } from '../models/types';

/** Okabe-Ito, dans l'ordre de SERIES_COLORS (bleu, rouge, vert, orange…). */
const OKABE_ITO = ['#0072b2', '#d55e00', '#009e73', '#e69f00', '#332288', '#56b4e9', '#000000', '#cc79a7'];

const TAILLE_MIN = 11;
const ENCRE = '#1f2937';
const HACHURES = '<defs><pattern id="fc-hachures" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">'
  + '<rect width="6" height="6" fill="#ffffff"/><line x1="0" y1="0" x2="0" y2="6" stroke="#9aa3ae" stroke-width="1.2"/></pattern></defs>';

export function versionImpression(svg: string): string {
  let out = svg
    .replace(/fill="#8592a8"/g, `fill="${ENCRE}"`)
    .replace(/font-size="(\d+(?:\.\d+)?)"/g, (m, t) => (Number(t) < TAILLE_MIN ? `font-size="${TAILLE_MIN}"` : m))
    .replace(/fill="#e8f6ee"/g, 'fill="url(#fc-hachures)"')
    .replace(/fill="none" stroke="#c0392b" stroke-width="1.4"/g, 'fill="none" stroke="#000000" stroke-width="2.2"');
  SERIES_COLORS.forEach((c, i) => {
    out = out.replace(new RegExp(c, 'gi'), OKABE_ITO[i % OKABE_ITO.length]);
  });
  return out.replace(/(<svg[^>]*>)/, `$1${HACHURES}`);
}
