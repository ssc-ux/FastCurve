// ──────────────────────────────────────────────────────────────
// COHÉRENCE DES GLYPHES : sur une capture d'écran, un même chiffre a
// toujours le même dessin.
//
// Tesseract lit chaque case isolément et peut confondre 8 et 5, 3 et 8 sur
// une police donnée — même à plusieurs agrandissements, s'il se trompe de la
// même façon. Mais une capture d'écran n'est pas une photo : la police, sa
// taille et son lissage sont identiques d'une case à l'autre. Les cases lues
// sans aucune hésitation (toutes les lectures d'accord) fournissent donc un
// modèle de chaque chiffre, TIRÉ DE LA CAPTURE ELLE-MÊME. Chaque chiffre lu
// ailleurs est ensuite comparé à ces modèles : s'il ressemble nettement plus
// à un autre chiffre qu'à celui que Tesseract a proposé, la lecture est
// corrigée — et la case signalée, pour que le médecin la regarde.
// ──────────────────────────────────────────────────────────────

import { composantes, type Bande, type CarteEncre, type Colonne } from './structure';

/** Grille de normalisation d'un glyphe (hauteur fixe, largeur proportionnelle). */
const GH = 16;
const GW = 14;

export type Glyphe = Float32Array;

/**
 * Glyphes « chiffres » d'une case, de gauche à droite : composantes de pleine
 * hauteur, fusionnées quand elles se chevauchent horizontalement (un chiffre
 * coupé en deux par le seuillage reste un seul chiffre). Les signes plus
 * petits (virgule, point, « < ») sont écartés.
 */
export function glyphesChiffres(carte: CarteEncre, bande: Bande, col: Colonne): Glyphe[] {
  const comps = composantes(carte, bande, col);
  if (!comps.length) return [];
  const hMax = Math.max(...comps.map(c => c.y1 - c.y0 + 1));
  const hauts = comps.filter(c => c.y1 - c.y0 + 1 >= hMax * 0.6).sort((a, b) => a.x0 - b.x0);
  const boites: { x0: number; y0: number; x1: number; y1: number }[] = [];
  for (const c of hauts) {
    const d = boites[boites.length - 1];
    if (d && c.x0 <= d.x1) {
      d.x1 = Math.max(d.x1, c.x1); d.y0 = Math.min(d.y0, c.y0); d.y1 = Math.max(d.y1, c.y1);
    } else boites.push({ x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1 });
  }
  // Même ligne de base pour tous : on normalise sur la hauteur commune.
  const y0 = Math.min(...boites.map(b => b.y0));
  const y1 = Math.max(...boites.map(b => b.y1));
  return boites.map(b => normaliser(carte, b.x0, y0, b.x1, y1));
}

function normaliser(carte: CarteEncre, x0: number, y0: number, x1: number, y1: number): Glyphe {
  const h = y1 - y0 + 1, w = x1 - x0 + 1;
  const echelle = GH / h;
  const wN = Math.min(GW, Math.max(1, Math.round(w * echelle)));
  const decal = Math.floor((GW - wN) / 2);
  const g = new Float32Array(GW * GH);
  for (let gy = 0; gy < GH; gy++) {
    for (let gx = 0; gx < wN; gx++) {
      // Couverture moyenne de la zone source correspondante.
      const sx0 = x0 + (gx * w) / wN, sx1 = x0 + ((gx + 1) * w) / wN;
      const sy0 = y0 + (gy * h) / GH, sy1 = y0 + ((gy + 1) * h) / GH;
      let n = 0, s = 0;
      for (let y = Math.floor(sy0); y < Math.max(Math.floor(sy0) + 1, Math.ceil(sy1)); y++) {
        for (let x = Math.floor(sx0); x < Math.max(Math.floor(sx0) + 1, Math.ceil(sx1)); x++) {
          if (x < 0 || y < 0 || x >= carte.largeur || y >= carte.hauteur) continue;
          s += carte.encre[y * carte.largeur + x]; n++;
        }
      }
      g[gy * GW + gx + decal] = n ? s / n : 0;
    }
  }
  return g;
}

function distance(a: Glyphe, b: Glyphe): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}

/** Chiffres d'un texte lu, dans l'ordre (séparateurs et signes exclus). */
export function chiffresDe(texte: string): string[] {
  return texte.replace(/\D/g, '').split('');
}

/** Modèles moyens par chiffre, appris sur les cases sûres de la capture. */
export class ModelesChiffres {
  private sommes = new Map<string, { g: Float32Array; n: number }>();

  apprendre(texte: string, glyphes: Glyphe[]) {
    const ch = chiffresDe(texte);
    if (!ch.length || ch.length !== glyphes.length) return;
    ch.forEach((c, i) => {
      const m = this.sommes.get(c) ?? { g: new Float32Array(GW * GH), n: 0 };
      for (let k = 0; k < m.g.length; k++) m.g[k] += glyphes[i][k];
      m.n++;
      this.sommes.set(c, m);
    });
  }

  private modele(c: string): Glyphe | null {
    const m = this.sommes.get(c);
    if (!m) return null;
    return m.g.map(v => v / m.n);
  }

  /**
   * Vérifie une lecture. Renvoie le texte corrigé chiffre par chiffre quand un
   * glyphe ressemble NETTEMENT plus au modèle d'un autre chiffre (distance
   * au moins deux fois plus faible) qu'à celui du chiffre lu, et `ecart` dès
   * qu'un glyphe est ambigu — signal de doute, jamais de correction.
   */
  verifier(texte: string, glyphes: Glyphe[]): { texte: string; corrige: boolean; ecart: boolean } {
    const ch = chiffresDe(texte);
    if (!ch.length || ch.length !== glyphes.length || this.sommes.size < 2) {
      return { texte, corrige: false, ecart: false };
    }
    const modeles = [...this.sommes.keys()].map(c => ({ c, g: this.modele(c)! }));
    const nouveaux = [...ch];
    let corrige = false, ecart = false;
    glyphes.forEach((g, i) => {
      const lu = modeles.find(m => m.c === ch[i]);
      if (!lu) return; // chiffre jamais vu en case sûre : rien à comparer
      const dLu = distance(g, lu.g);
      const meilleur = modeles
        .map(m => ({ c: m.c, d: distance(g, m.g) }))
        .sort((a, b) => a.d - b.d)[0];
      if (meilleur.c === ch[i]) return;
      if (meilleur.d * 2 <= dLu) { nouveaux[i] = meilleur.c; corrige = true; }
      else if (meilleur.d < dLu) ecart = true;
    });
    if (!corrige) return { texte, corrige: false, ecart };
    let k = 0;
    return { texte: texte.replace(/\d/g, () => nouveaux[k++]), corrige: true, ecart: true };
  }
}
