// ──────────────────────────────────────────────────────────────
// PHOTO D'ÉCRAN → TABLEAU, à partir des zones de texte de PaddleOCR.
//
// Sur une capture, la géométrie du tableau est établie par l'encre (pipeline.ts).
// Sur une photo, c'est le détecteur de texte qui la donne : chaque zone lue a
// sa position. On regroupe les zones en LIGNES (même hauteur), on repère la
// ligne des DATES (celle qui en porte le plus), et chaque nombre est rattaché
// à la date au-dessus de lui. À gauche des dates : le nom, l'unité, la norme.
// ──────────────────────────────────────────────────────────────

import { lireTextes, type BoiteTexte } from './paddle';
import { estIntervalle, estUnite, lireDate } from '../ocr/roles';
import { corrigerDecimalePerdue, reparerNombre } from '../ocr/correction';
import type { TableauLu, LigneLue, CelluleLue, DateLue } from '../ocr/pipeline';
import { carteEncreLocale } from '../ocr/preparation';
import { analyserCellule } from '../ocr/structure';

const NOMBRE = /^[<>]?\d{1,6}([.,]\d+)?$/;
const mediane = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

/** Regroupe les zones en lignes : centres verticaux à moins d'une demi-hauteur. */
/**
 * Pente des lignes de texte (dy/dx) : médiane des pentes entre chaque zone et
 * sa voisine de droite de même hauteur. Une photo légèrement penchée (1° sur
 * 2 500 px = 44 px de dérive) mélangerait sinon les lignes au regroupement.
 */
export function penteLignes(boites: BoiteTexte[]): number {
  const h = mediane(boites.map(b => b.y1 - b.y0)) || 10;
  const pentes: number[] = [];
  for (const a of boites) {
    const ya = (a.y0 + a.y1) / 2;
    let voisin: BoiteTexte | null = null;
    for (const b of boites) {
      if (b === a || b.x0 < a.x1) continue;
      if (Math.abs((b.y0 + b.y1) / 2 - ya) > h) continue;
      if (!voisin || b.x0 < voisin.x0) voisin = b;
    }
    if (voisin) {
      const dx = (voisin.x0 + voisin.x1) / 2 - (a.x0 + a.x1) / 2;
      if (dx > h * 2) pentes.push(((voisin.y0 + voisin.y1) / 2 - ya) / dx);
    }
  }
  return mediane(pentes);
}

/**
 * Regroupe les zones en lignes par SUIVI, de gauche à droite : chaque ligne
 * prédit où elle passe plus loin (sa propre pente, affinée maillon après
 * maillon). La perspective d'une photo fait varier la pente d'un bord à
 * l'autre ; une pente globale laissait glisser les valeurs d'une ligne à la
 * suivante en bas à droite.
 */
export function grouperLignes(boites: BoiteTexte[]): BoiteTexte[][] {
  const h = mediane(boites.map(b => b.y1 - b.y0)) || 10;
  const pente0 = penteLignes(boites);
  const cx = (b: BoiteTexte) => (b.x0 + b.x1) / 2, cy = (b: BoiteTexte) => (b.y0 + b.y1) / 2;
  const lignes: { boites: BoiteTexte[]; x: number; y: number; pente: number }[] = [];
  for (const b of [...boites].sort((p, q) => p.x0 - q.x0)) {
    let meilleure: (typeof lignes)[number] | null = null, ecart = Infinity;
    for (const l of lignes) {
      const prevu = l.y + l.pente * (cx(b) - l.x);
      const e = Math.abs(cy(b) - prevu);
      if (e < h * 0.55 && e < ecart) { ecart = e; meilleure = l; }
    }
    if (meilleure) {
      const dx = cx(b) - meilleure.x;
      if (dx > h * 2) {
        const p = 0.5 * meilleure.pente + 0.5 * ((cy(b) - meilleure.y) / dx);
        meilleure.pente = Math.max(pente0 - 0.03, Math.min(pente0 + 0.03, p)); // bornée : pas de dérive
      }
      meilleure.boites.push(b); meilleure.x = cx(b); meilleure.y = cy(b);
    } else {
      lignes.push({ boites: [b], x: cx(b), y: cy(b), pente: pente0 });
    }
  }
  const yRef = (l: (typeof lignes)[number]) => l.boites[0] ? cy(l.boites[0]) - pente0 * cx(l.boites[0]) : 0;
  return lignes.sort((p, q) => yRef(p) - yRef(q)).map(l => l.boites);
}

/** Dates d'une ligne d'en-tête : une date peut être lue en un bloc (« 30/09/2026 07:25 ») ou deux. */
function datesDeLigne(l: BoiteTexte[]): { iso: string; brut: string; b: BoiteTexte }[] {
  const out: { iso: string; brut: string; b: BoiteTexte }[] = [];
  for (const b of l) {
    const d = lireDate(b.texte.replace(/\s+\d{1,2}[:.h]\d{2}$/, ''));
    if (d?.iso && !d.anneeDevinee) out.push({ iso: d.iso, brut: d.brut, b });
  }
  return out;
}

/**
 * Point décimal vu dans l'IMAGE : dans la zone d'un nombre lu sans virgule, une
 * petite tache basse entre deux chiffres (même analyse que pour les captures).
 */
function separateurDansImage(image: HTMLCanvasElement, b: BoiteTexte): { chiffresAvant: number } | null {
  const w = Math.round(b.x1 - b.x0), h = Math.round(b.y1 - b.y0);
  if (w < 4 || h < 4) return null;
  const echelle = Math.max(1, 40 / h);
  const c = document.createElement('canvas');
  c.width = Math.round(w * echelle); c.height = Math.round(h * echelle);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, b.x0, b.y0, w, h, 0, 0, c.width, c.height);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  const v = new Float32Array(c.width * c.height);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) v[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  const { carte } = carteEncreLocale({ largeur: c.width, hauteur: c.height, v });
  const geo = analyserCellule(carte, { y0: 0, y1: c.height - 1 }, { x0: 0, x1: c.width - 1 });
  return geo.separateur;
}

/** Extrait de la photo autour d'une zone (data-URL), pour la vérification case par case. */
function extrait(image: HTMLCanvasElement, b: { x0: number; y0: number; x1: number; y1: number }): string {
  const m = (b.y1 - b.y0) * 0.25;
  const x0 = Math.max(0, b.x0 - m), y0 = Math.max(0, b.y0 - m);
  const x1 = Math.min(image.width, b.x1 + m), y1 = Math.min(image.height, b.y1 + m);
  const e = Math.min(1, 40 / Math.max(1, y1 - y0));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round((x1 - x0) * e)); c.height = Math.max(1, Math.round((y1 - y0) * e));
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, x0, y0, x1 - x0, y1 - y0, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.8);
}

const union = (bs: BoiteTexte[]) => ({
  x0: Math.min(...bs.map(b => b.x0)), y0: Math.min(...bs.map(b => b.y0)),
  x1: Math.max(...bs.map(b => b.x1)), y1: Math.max(...bs.map(b => b.y1)),
});

export interface OptionsPhoto {
  vignettes?: boolean;
  onProgress?: (fait: number, total: number, etape: string) => void;
  annule?: () => boolean;
  /** Taille de travail de la détection (banc). */
  coteMax?: number;
}

export async function lireTableauPhoto(image: HTMLCanvasElement, opts: OptionsPhoto = {}): Promise<TableauLu> {
  const echec = (message: string): TableauLu => ({ dates: [], lignes: [], echec: true, message });
  opts.onProgress?.(0, 1, 'Chargement du moteur photo…');
  const boites = await lireTextes(image, opts.coteMax ?? 1920, (f, t) => opts.onProgress?.(f, t, 'Lecture de la photo…'), opts.annule);
  if (boites.length < 6) return echec('Je n’ai trouvé presque aucun texte sur cette photo.');
  const lignes = grouperLignes(boites);

  // Ligne des dates : celle qui en porte le plus (au moins deux).
  let iEntete = -1, entete: ReturnType<typeof datesDeLigne> = [];
  lignes.forEach((l, i) => { const d = datesDeLigne(l); if (d.length > entete.length) { entete = d; iEntete = i; } });
  if (entete.length < 2) return echec('Je n’ai pas trouvé la ligne des dates sur cette photo.');

  // Colonnes : bord droit de chaque date (les résultats sont alignés à droite
  // sous l'en-tête, qui est centré) ; frontière à mi-chemin entre deux dates.
  const cols = entete.map(e => ({ ...e, xc: (e.b.x0 + e.b.x1) / 2, x1: e.b.x1 }));
  const debutValeurs = cols[0].b.x0 - (cols[0].b.x1 - cols[0].b.x0) * 0.4;
  const colonneDe = (b: BoiteTexte): number => {
    // Rattachement : la date dont la colonne [milieu précédent, milieu suivant] contient le bord droit.
    const x = b.x1;
    let best = -1, dist = Infinity;
    cols.forEach((c, k) => {
      const g = k ? (cols[k - 1].x1 + c.b.x0) / 2 : debutValeurs;
      const d = k + 1 < cols.length ? (c.x1 + cols[k + 1].b.x0) / 2 : c.x1 + (c.b.x1 - c.b.x0) * 0.6;
      if (x >= g && x <= d) { const e = Math.abs(x - c.x1); if (e < dist) { dist = e; best = k; } }
    });
    return best;
  };

  const dates: DateLue[] = cols.map(c => ({
    iso: c.iso, brut: c.brut, douteux: false, motifs: [], vignette: opts.vignettes ? extrait(image, c.b) : undefined,
  }));
  const sortie: LigneLue[] = [];
  let sansNom = 0;
  for (const l of lignes.slice(iEntete + 1)) {
    const gauche = l.filter(b => b.x1 < debutValeurs);
    const droite = l.filter(b => b.x1 >= debutValeurs);
    // Nom : les zones de gauche qui ne sont ni unité ni norme.
    const zonesNom = gauche.sort((p, q) => p.x0 - q.x0).filter(b => !estUnite(b.texte) && !estIntervalle(b.texte) && /[A-Za-zÀ-ÿ]{2,}/.test(b.texte));
    // Débris de 1-2 lettres avant ou après le nom (bout d'un mot voisin coupé) : écartés.
    const debris = (b: BoiteTexte) => b.texte.replace(/[^A-Za-zÀ-ÿ]/g, '').length <= 2;
    while (zonesNom.length > 1 && debris(zonesNom[0])) zonesNom.shift();
    while (zonesNom.length > 1 && debris(zonesNom[zonesNom.length - 1])) zonesNom.pop();
    const nom = zonesNom.map(b => b.texte).join(' ').replace(/\s+/g, ' ').trim();
    const unite = gauche.find(b => estUnite(b.texte))?.texte ?? '';
    const cellules: CelluleLue[] = cols.map(() => ({ texte: '', douteux: false, motifs: [] }));
    let nombres = 0, mots = 0;
    for (const b of droite) {
      const t = b.texte.replace(/\s+/g, '').replace(/^[^\d<>]+/, ''); // pictogramme « i » devant
      if (/^[<>]?\d+[.,]$/.test(t)) {
        // Nombre dont la fin est illisible (« 38. ») : case signalée, jamais devinée.
        const k = colonneDe(b);
        if (k >= 0 && !cellules[k].texte) { cellules[k].douteux = true; cellules[k].motifs.push(`fin du nombre illisible sur la photo (lu « ${t} »)`); }
        continue;
      }
      if (!NOMBRE.test(t)) { if (/[A-Za-z]{3,}/.test(b.texte)) mots++; continue; }
      const k = colonneDe(b);
      if (k < 0) continue;
      nombres++;
      const c = cellules[k];
      // Coupé par le bord de la photo : on ne sait pas ce qui manque.
      const marge = Math.max(3, image.width * 0.004);
      if (b.x1 >= image.width - marge || b.x0 <= marge) {
        c.douteux = true; c.motifs.push('valeur coupée au bord de la photo : non lue');
        continue;
      }
      let rep = reparerNombre(t);
      if (!/[.,]/.test(t) && /\d{2,}/.test(t)) {
        const sep = separateurDansImage(image, b);
        if (sep) {
          // L'image prouve qu'il y a une virgule ; sa POSITION est prise des
          // voisines de la ligne quand elles en disent le nombre de décimales.
          const decs = droite.map(o => o.texte.replace(/\s+/g, '').match(/[.,](\d+)$/)?.[1].length).filter((x): x is number => !!x);
          const nd = decs.length >= 2 ? decs.sort((p, q) => p - q)[Math.floor(decs.length / 2)] : 0;
          const chiffres = t.replace(/\D/g, '').length;
          const r2 = reparerNombre(t, nd && chiffres > nd ? { chiffresAvant: chiffres - nd } : sep);
          if (r2.separateurRetabli) { rep = r2; c.douteux = true; c.motifs.push(`virgule vue sur l’image (lu « ${t} »)`); }
        }
      }
      if (c.texte) { c.douteux = true; c.motifs.push(`deux valeurs lues dans la même case (${c.texte} et ${rep.texte})`); continue; }
      c.texte = rep.texte;
      if (opts.vignettes) c.vignette = extrait(image, b);
      if (b.confiance < 0.9) { c.douteux = true; c.motifs.push('lecture peu sûre'); }
      if (b.relu) { c.douteux = true; c.motifs.push('fin du nombre peu nette sur la photo'); }
    }
    if (!nom && nombres >= 2 && mots === 0) sansNom++;
    if (!nom || !nombres || mots > nombres) continue; // section, « Automate… », « Formule microscope »
    // Nom qui touche le bord gauche de la photo : il manque peut-être le début.
    const nomCoupe = zonesNom[0].x0 <= Math.max(3, image.width * 0.004);
    // Virgule perdue, la ligne pour témoin.
    cellules.forEach((c, k) => {
      if (!c.texte) return;
      const corrige = corrigerDecimalePerdue(c.texte, cellules.filter((_, j) => j !== k).map(o => o.texte));
      if (corrige) { c.motifs.push(`virgule probablement perdue : lu « ${c.texte} », proposé « ${corrige} »`); c.proposition = corrige; c.douteux = true; }
    });
    sortie.push({
      nom, unite, nomDouteux: nomCoupe, nomMotifs: nomCoupe ? ['nom coupé au bord gauche de la photo'] : [], cellules,
      vignetteNom: opts.vignettes ? extrait(image, union(zonesNom)) : undefined,
    });
  }
  if (sortie.length < 1) {
    return echec(sansNom >= 2
      ? 'Les noms des examens ne sont pas sur la photo : reprenez-la en cadrant aussi la colonne de gauche.'
      : 'Je n’ai su lire aucune ligne de résultats sur cette photo.');
  }
  return { dates, lignes: sortie, echec: false, message: '' };
}

const cleNom = (n: string) => n.toUpperCase().replace(/[^A-Z0-9%]/g, '');

/**
 * DOUBLE LECTURE : la même table lue sur deux images de la rafale. Toute case
 * dont les deux lectures diffèrent passe en jaune ; une case lue sur une
 * seule image est reprise, en jaune. Les lignes sont appariées par nom, les
 * colonnes par date ; ce qui n'a pas d'équivalent reste tel quel.
 */
export function confronter(a: TableauLu, b: TableauLu): TableauLu {
  if (a.echec || b.echec) return a.echec ? b : a;
  const colB = new Map<string, number>();
  b.dates.forEach((d, k) => { if (d.iso) colB.set(d.iso + '#' + rang(b.dates, k), k); });
  const pris = new Set<LigneLue>();
  for (const l of a.lignes) {
    const lb = apparier(l.nom, b.lignes.filter(x => !pris.has(x)));
    if (lb) pris.add(lb);
    if (!lb) continue;
    l.cellules.forEach((c, k) => {
      const d = a.dates[k];
      if (!d?.iso) return;
      const kb = colB.get(d.iso + '#' + rang(a.dates, k));
      if (kb === undefined) return;
      const cb = lb.cellules[kb];
      if (!cb) return;
      if (c.texte && cb.texte && c.texte !== cb.texte) {
        c.douteux = true; c.motifs.push(`lu « ${c.texte} » sur une image, « ${cb.texte} » sur l’autre`);
      } else if (!c.texte && cb.texte) {
        c.texte = cb.texte; c.vignette = cb.vignette; c.douteux = true;
        c.motifs.push('lu sur une seule des deux images');
      }
    });
  }
  return a;
}

/** Ressemblance de deux noms (bigrammes communs, 0..1) : un nom mal lu sur une image reste reconnu. */
function ressemblance(p: string, q: string): number {
  const bi = (t: string) => { const m = new Map<string, number>(); for (let i = 0; i + 1 < t.length; i++) m.set(t.slice(i, i + 2), (m.get(t.slice(i, i + 2)) ?? 0) + 1); return m; };
  const a = bi(p), b = bi(q);
  let commun = 0;
  for (const [k, n] of a) commun += Math.min(n, b.get(k) ?? 0);
  const total = Math.max(1, p.length - 1 + q.length - 1);
  return (2 * commun) / total;
}

function apparier(nom: string, lignes: LigneLue[]): LigneLue | null {
  const k = cleNom(nom);
  let meilleure: LigneLue | null = null, score = 0.7;
  for (const l of lignes) {
    const s = cleNom(l.nom) === k ? 1 : ressemblance(k, cleNom(l.nom));
    if (s > score || (s === 1 && score < 1)) { score = s; meilleure = l; }
  }
  return meilleure;
}

/** Rang d'une date parmi les colonnes de même date (deux prélèvements le même jour). */
function rang(dates: DateLue[], k: number): number {
  let r = 0;
  for (let j = 0; j < k; j++) if (dates[j].iso === dates[k].iso) r++;
  return r;
}
