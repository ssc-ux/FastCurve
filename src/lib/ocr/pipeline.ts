// ──────────────────────────────────────────────────────────────
// LA CHAÎNE COMPLÈTE : d'une capture d'écran à un tableau vérifiable.
//
//   préparation → structure → rôles → OCR cellule par cellule
//                → correction → confiance
//
// Le principe qui gouverne tout le module : on ne demande JAMAIS à Tesseract de
// comprendre un tableau. On lui donne une case à la fois, agrandie, avec la
// liste des caractères qu'elle a le droit de contenir. La géométrie du tableau
// est établie AVANT, par analyse d'encre, et c'est elle qui dit ce qu'est une
// ligne, ce qu'est une colonne, et à quoi sert chaque colonne.
//
// Les cinq erreurs relevées par le médecin sont traitées ici, chacune à son
// endroit :
//   1 & 2. bornes de normes prises pour des résultats → `affecterRoles` écarte
//          toute colonne dont l'en-tête ou le contenu trahit des normes ;
//   3.     virgule décimale perdue → `analyserCellule` voit la virgule dans
//          l'encre et `reparerNombre` la rétablit ;
//   4.     unité agglutinée au nom → `nettoyerNom` ;
//   5.     colonnes de dates fondues en une → la découpe en colonnes est faite
//          par projection d'encre, pas par regroupement de mots OCR.
//
// 100% local : rien ne sort du navigateur.
// ──────────────────────────────────────────────────────────────

import { matchCatalog, matchCatalogExact } from '../models/catalog';
import { jugerDate, jugerNom, jugerValeur } from './confiance';
import { corrigerDecimalePerdue, reparerNombre } from './correction';
import { glyphesChiffres, ModelesChiffres } from './glyphes';
import type { Glyphe } from './glyphes';
import { lireCellules } from './ocr';
import type { ModeCellule } from './ocr';
import { canvasSource, carteCouleur, carteEncreLocale, grisCanalMin, rendreCellule, vignette } from './preparation';
import type { Boite } from './preparation';
import { affecterRoles, corrigerNomParCatalogue, lireDate, nettoyerNom, roleDepuisEntete } from './roles';
import type { ColonneCandidate, DateLue as DateEntete } from './roles';
import { analyserCellule, boiteEncre, colonnesDepuisAncres, detecterBandes, encreDansCellule, hauteurLigne, mediane, profilBandes, sansDecorationsCouleur, carteTexte, effacerFilets } from './structure';
import type { Bande, CarteCouleur, CarteEncre, Colonne, GeometrieCellule } from './structure';
import { etendue, isolerTableau, ecarterBandesDecoratives, plageEntete, blocsDeBande, blocPourColonne, retenirBlocEntete, decouperTableau } from './decoupage';
import { AGRANDISSEMENTS_VALEUR, type LectureVotee, NOMBRE_LU, normaliserLecture, voter } from './vote';

// ── Ce que la chaîne rend ───────────────────────────────────────

export interface CelluleLue {
  /** Texte proposé au médecin ('' = case vide). */
  texte: string;
  /** Doute de LECTURE (jamais d'anormalité clinique) → case jaune. */
  douteux: boolean;
  /** Raisons du doute, en français, pour l'infobulle. */
  motifs: string[];
  /** Extrait de l'image d'origine pour CETTE case (data-URL). */
  vignette?: string;
  /** Correction PROPOSÉE (virgule perdue) : jamais appliquée sans le médecin. */
  proposition?: string;
}

export interface LigneLue {
  nom: string;
  unite: string;
  nomDouteux: boolean;
  nomMotifs: string[];
  cellules: CelluleLue[];
  /** Portion de l'image d'origine correspondant à la ligne (data-URL). */
  vignette?: string;
  /** Extrait de l'image d'origine pour le nom de la variable. */
  vignetteNom?: string;
}

export interface DateLue {
  iso: string | null;
  brut: string;
  douteux: boolean;
  motifs: string[];
  /** Extrait de l'image d'origine pour l'en-tête de date. */
  vignette?: string;
}

export interface TableauLu {
  dates: DateLue[];
  lignes: LigneLue[];
  /** Vrai quand la capture n'a rien donné d'exploitable. */
  echec: boolean;
  /** Message en français à montrer au médecin en cas d'échec. */
  message: string;
}

export interface OptionsReconnaissance {
  /** Avancement : (fait, total, étape en français). */
  onProgress?: (fait: number, total: number, etape: string) => void;
  /** Année à supposer quand l'en-tête ne porte que « 12/03 ». */
  anneeParDefaut?: number;
  /** Produire les vignettes de ligne (inutile pour le banc). */
  vignettes?: boolean;
  /** Photo d'écran (et non capture) : structure cherchée sur le texte seul. */
  photo?: boolean;
  /** Traces de diagnostic (banc d'épreuve uniquement). */
  trace?: (etape: string, donnees: unknown) => void;
  /** Interrompt la lecture entre deux lots. */
  annule?: () => boolean;
}

/** Garde-fou : au-delà, la capture n'est pas un tableau de biologie. */
const MAX_CELLULES = 700;

function echec(message: string): TableauLu {
  return { dates: [], lignes: [], echec: true, message };
}

// ── 1. Isoler le tableau dans la page ───────────────────────────

interface Cellule {
  boite: Boite;
  encre: number;
  inverse: boolean;
}

/**
 * Boîte d'une cellule, resserrée sur son encre pour que l'agrandissement porte.
 *
 * `limites` donne le droit de déborder la colonne jusqu'au milieu des
 * gouttières voisines, et ce détail vaut plusieurs points : les valeurs étant
 * alignées à droite, la colonne est calée au pixel près sur le chiffre le plus
 * à gauche de la plus longue valeur. Découpée à ras, cette valeur-là perd son
 * premier chiffre — « 1240 » devenait « 240 », faux d'un facteur cinq et
 * parfaitement crédible.
 *
 * `coul`, quand fourni (cases de VALEUR seulement), écarte d'abord l'encre
 * d'un pictogramme accolé au nombre (badge d'information, flèche de
 * tendance — voir `structure.ts#sansDecorationsCouleur`) avant de resserrer
 * la boîte sur ce qui reste : sans ce tri, l'icône élargit la boîte à gauche
 * et la flèche à droite, et Tesseract reçoit un chiffre noyé entre deux
 * pictogrammes qu'il n'a pas le droit de nommer (liste blanche numérique).
 */
function celluleDe(
  carte: CarteEncre, polarite: Uint8Array, bande: Bande, col: Colonne, hL: number,
  limites?: Colonne, coul?: CarteCouleur,
): Cellule {
  const marge = Math.max(3, Math.round(hL * 0.45));
  const bornes = limites ?? col;
  let carteBbox = carte, bandeBbox = bande, colBbox = col, dx = 0, dy = 0, picto = false;
  if (coul) {
    const net = sansDecorationsCouleur(carte, coul, bande, col);
    carteBbox = net.carte; bandeBbox = net.bande; colBbox = net.col; dx = net.dx; dy = net.dy; picto = net.picto;
    // Pictogramme accolé : le texte est d'un seul côté. On garde le côté qui
    // porte le plus d'encre, à distance du pictogramme (son liseré compris).
    if (net.picto && net.pictoX0 !== undefined && net.pictoX1 !== undefined) {
      const garde = Math.max(2, Math.round(hL * 0.15));
      const gauche = { x0: net.col.x0, x1: net.pictoX0 - garde };
      const droite = { x0: net.pictoX1 + garde, x1: net.col.x1 };
      const eG = gauche.x1 >= gauche.x0 ? encreDansCellule(net.carte, net.bande, gauche) : 0;
      const eD = droite.x1 >= droite.x0 ? encreDansCellule(net.carte, net.bande, droite) : 0;
      if (eG || eD) colBbox = eD >= eG ? droite : gauche;
    }
  }
  const encre = encreDansCellule(carteBbox, bandeBbox, colBbox);
  const bLocal = boiteEncre(carteBbox, bandeBbox, colBbox);
  const b = bLocal ? { x0: bLocal.x0 + dx, y0: bLocal.y0 + dy, x1: bLocal.x1 + dx, y1: bLocal.y1 + dy } : null;
  // Pictogramme accolé (ⓘ, flèche ↑) : la marge horizontale en rattraperait
  // un morceau, que Tesseract lirait comme un chiffre (« 24↑ » → « 241 »).
  // On découpe alors au ras de l'encre du texte — `rendreCellule` ajoute de
  // toute façon sa propre marge blanche.
  const margeH = picto ? 1 : marge;
  const x0 = b ? Math.max(bornes.x0, b.x0 - margeH) : col.x0;
  const x1 = b ? Math.min(bornes.x1, b.x1 + margeH) : col.x1;
  let sombres = 0;
  for (let y = Math.max(0, bande.y0); y <= Math.min(polarite.length - 1, bande.y1); y++) {
    sombres += polarite[y];
  }
  const hauteur = bande.y1 - bande.y0 + 1;
  return {
    boite: { x0, y0: bande.y0 - marge, x1, y1: bande.y1 + marge },
    encre,
    inverse: sombres > hauteur / 2,
  };
}

// ── Lecture multiple des valeurs ─────────────────────────────────
//
// Une même case est lue à trois agrandissements. Tesseract confond 5/9, 8/6,
// 3/8 selon la taille du glyphe, mais rarement de la même façon à trois
// échelles : le vote à la majorité efface ces confusions isolées. Quand les
// lectures ne s'accordent pas, la case est de toute façon signalée en jaune.

/**
 * Point d'entrée. Une barre de titre posée au-dessus du tableau (« Résultats
 * du 27/01/2020 au 30/09/2026 ») peut être prise pour la ligne d'en-tête : ses
 * deux dates deviennent des colonnes et tout le découpage déraille. Quand la
 * lecture échoue ou ne trouve presque pas de dates, on la relance en écartant
 * la (puis les deux) première(s) bande(s) de texte, et on garde la lecture
 * qui a produit le plus de valeurs.
 */
export async function reconnaitreTableau(
  img: HTMLImageElement | HTMLCanvasElement,
  opts: OptionsReconnaissance = {},
): Promise<TableauLu> {
  const remplies = (t: TableauLu) => t.echec ? -1 : t.lignes.reduce((n, l) => n + l.cellules.filter(c => c.texte).length, 0);
  let meilleur = await reconnaitreTableauDepuis(img, opts, 0);
  for (let saut = 1; saut <= 2; saut++) {
    if (!meilleur.echec && meilleur.dates.length >= 3) break;
    if (opts.annule?.()) break;
    const essai = await reconnaitreTableauDepuis(img, opts, saut);
    if (remplies(essai) > remplies(meilleur)) meilleur = essai;
  }
  return meilleur;
}

async function reconnaitreTableauDepuis(
  img: HTMLImageElement | HTMLCanvasElement,
  opts: OptionsReconnaissance,
  sauterBandes: number,
): Promise<TableauLu> {
  const annule = () => !!opts.annule?.();
  const avancer = (f: number, t: number, e: string) => opts.onProgress?.(f, t, e);

  // — Préparation —
  avancer(0, 1, 'Préparation de l’image…');
  // Photo : pleine résolution (jusqu'à 2 800 px), sinon les points décimaux
  // ne font plus que deux ou trois pixels.
  const source = canvasSource(img);
  const gris = grisCanalMin(source);
  const encreBrute = carteEncreLocale(gris);
  const polarite = encreBrute.polarite;
  // Photo d'écran : filets, bords et moiré relient toutes les lignes entre
  // elles ; on ne garde que ce qui a la taille du texte (voir carteTexte).
  const carte = opts.photo ? carteTexte(encreBrute.carte) : encreBrute.carte;
  // Repère le bleu et l'orange/rouge de l'image ORIGINALE (perdus par
  // `grisCanalMin`, qui aplatit tout en niveaux de gris) : c'est ce qui
  // permet de distinguer un pictogramme accolé à une valeur (§ « Valeurs »
  // ci-dessous) d'une valeur pathologique entièrement colorée.
  const coul = carteCouleur(source);

  // — Structure —
  const toutes = detecterBandes(carte);
  if (toutes.length < 2) {
    return echec('Je n’ai trouvé aucun tableau dans cette image.');
  }
  const hL = hauteurLigne(toutes) || 12;
  // Au niveau des cases, les filets du tableau ne sont que du bruit.
  const carteCases = effacerFilets(carte, hL);
  const bandesIsolees = isolerTableau(carte, toutes, hL);
  const bandes = ecarterBandesDecoratives(bandesIsolees, hL).slice(sauterBandes);
  if (bandes.length < 2) {
    return echec('Je n’ai trouvé qu’une seule ligne de texte : ce n’est pas un tableau.');
  }
  // Bandes écartées comme décoratives (rangées d'icônes) : une partie de
  // l'en-tête (les colonnes SANS icône — « Unité », « Normes » — n'ayant rien
  // sous elles, leur libellé peut être centré verticalement à la même hauteur
  // que la rangée d'icônes des colonnes de dates voisines). Gardées de côté
  // pour l'ancrage de l'en-tête ci-dessous, jamais pour la découpe en
  // colonnes ni pour la lecture des lignes.
  const bandesDecoratives = bandesIsolees.filter(b => !bandes.includes(b));
  // Les colonnes sont établies sur les LIGNES DE DONNÉES seulement : la ligne
  // d'en-tête, plus large (une date au-dessus d'un nombre à trois chiffres) et
  // parfois posée sur un fond plein, boucherait toutes les gouttières.
  let colonnes = decouperTableau(carte, bandes.slice(1), hL);
  if (colonnes.length < 2) {
    return echec(
      'Je n’ai pas su séparer les colonnes de cette capture. ' +
      'Essayez une capture plus large, ou collez le tableau depuis Excel.',
    );
  }
  if (bandes.length * colonnes.length > MAX_CELLULES) {
    return echec('Cette image est trop dense pour être lue d’un bloc — recadrez sur le tableau.');
  }

  const cellule = (bi: number, ci: number) =>
    celluleDe(carteCases, polarite, bandes[bi], colonnes[ci], hL, plageEntete(colonnes, ci, carte.largeur));
  // Une case de résultat est agrandie plus fort que les autres : c'est là que
  // se joue la virgule décimale, et une virgule de deux pixels ne survit pas à
  // un agrandissement timide.
  const rendre = (c: Cellule, mode: ModeCellule, hauteurCible?: number) =>
    rendreCellule(source, c.boite, { inverse: c.inverse, hauteurCible: hauteurCible ?? (mode === 'valeur' ? 68 : 46) });

  const bornesTable = {
    gauche: colonnes[0].x0,
    droite: colonnes[colonnes.length - 1].x1,
  };
  const blocsEntete = new Map<number, Colonne[]>();

  /**
   * Cellule d'en-tête : on part du bloc de texte réellement présent dans la
   * bande d'en-tête, pas de la largeur des valeurs. À défaut, la plage élargie.
   */
  const celluleEntete = (bi: number, ci: number): Cellule => {
    if (!blocsEntete.has(bi)) blocsEntete.set(bi, blocsDeBande(gris, bandes[bi], hL, bornesTable));
    const col = colonnes[ci];
    const plage = plageEntete(colonnes, ci, carte.largeur);
    const bloc = blocPourColonne(blocsEntete.get(bi)!, col, hL);
    // Un bloc appartient à UNE colonne : celle qu'il recouvre le plus. Une
    // colonne sans titre dans cette bande (« Normales » centré plus bas, à
    // côté d'une date large) ne doit pas hériter du bloc de sa voisine — elle
    // lirait « 29/1 » et deviendrait une colonne de résultats fantôme.
    if (bloc) {
      const recouvre = (c: Colonne) => Math.min(bloc.x1, c.x1) - Math.max(bloc.x0, c.x0);
      const proprietaire = colonnes.reduce((m, c, k) => (recouvre(c) > recouvre(colonnes[m]) ? k : m), ci);
      if (proprietaire !== ci) {
        return {
          boite: { x0: col.x0, y0: bandes[bi].y0, x1: col.x1, y1: bandes[bi].y1 },
          encre: encreDansCellule(carte, bandes[bi], col),
          inverse: celluleDe(carte, polarite, bandes[bi], col, hL).inverse,
        };
      }
    }
    // Les valeurs étant alignées à droite et l'en-tête centré, le bloc déborde
    // très souvent la colonne vers la gauche : on le suit tel quel. La plage
    // ne sert que si aucun bloc ne se rattache à la colonne.
    //
    // Un bloc ANORMALEMENT plus large que sa colonne de données ne doit pas
    // déborder au-delà de la plage : quand des en-têtes denses (beaucoup de
    // colonnes de dates, peu de place) se touchent, `blocsDeBande` les
    // fusionne en un seul bloc qui couvre toute la ligne — sans ce plafond,
    // CHAQUE colonne se voyait attribuer la ligne entière, et la même date
    // envahissait tous les rôles (plus de colonne de noms du tout). On ne
    // plafonne que ce cas net (bloc bien plus large que trois colonnes) : un
    // en-tête simplement un peu plus large que sa colonne de valeurs — le cas
    // courant, une date au-dessus d'un nombre à trois chiffres — garde tout
    // son débordement, c'est justement ce que la plage lui accorde.
    const marge = Math.max(2, Math.round(hL * 0.2));
    let retenu = retenirBlocEntete(bloc, col, plage, marge);
    if (!bloc) {
      // Sans bloc à elle, la colonne se rabat sur sa plage — mais jamais sur
      // le texte d'un bloc voisin qui y déborde (une date large à droite).
      for (const b of blocsEntete.get(bi)!) {
        if (b.x0 > col.x1) retenu = { ...retenu, x1: Math.min(retenu.x1, b.x0 - 1) };
        else if (b.x1 < col.x0) retenu = { ...retenu, x0: Math.max(retenu.x0, b.x1 + 1) };
      }
      if (retenu.x1 <= retenu.x0) retenu = { x0: col.x0, x1: col.x1 };
    }
    return {
      boite: {
        x0: retenu.x0, y0: bandes[bi].y0 - marge,
        x1: retenu.x1, y1: bandes[bi].y1 + marge,
      },
      encre: Math.max(1, encreDansCellule(carte, bandes[bi], retenu)),
      inverse: celluleDe(carte, polarite, bandes[bi], col, hL).inverse,
    };
  };

  /** Lit un lot de cellules ; les cases sans encre ne coûtent aucun appel OCR. */
  async function lire(
    cases: Cellule[], mode: ModeCellule, etape: string, hauteurCible?: number,
  ): Promise<{ texte: string; confiance: number }[]> {
    const utiles: number[] = [];
    const canvases: HTMLCanvasElement[] = [];
    cases.forEach((c, i) => {
      if (c.encre >= 3) { utiles.push(i); canvases.push(rendre(c, mode, hauteurCible)); }
    });
    const out = cases.map(() => ({ texte: '', confiance: 0 }));
    if (!canvases.length) return out;
    const lus = await lireCellules(canvases, mode, (f, t) => avancer(f, t, etape));
    utiles.forEach((i, k) => { out[i] = { texte: lus[k].texte, confiance: lus[k].confiance }; });
    return out;
  }

  // — En-tête : quelle bande, et que dit-elle ? —
  avancer(0, 1, 'Lecture de l’en-tête…');
  let iEntete = 0;
  let entetes = (await lire(colonnes.map((_, ci) => celluleEntete(0, ci)), 'texte', 'En-tête')).map(r => r.texte);
  if (annule()) return echec('Lecture interrompue.');

  const scoreEntete = (txts: string[]) =>
    txts.filter(t => !!lireDate(t)).length * 2 + txts.filter(t => !!roleDepuisEntete(t)).length;

  // La bande retenue peut être un reliquat de titre resté collé au tableau :
  // si elle ne dit rien, on essaie la suivante, une seule fois.
  if (scoreEntete(entetes) === 0 && bandes.length >= 3) {
    const suivantes = (await lire(colonnes.map((_, ci) => celluleEntete(1, ci)), 'texte', 'En-tête')).map(r => r.texte);
    if (scoreEntete(suivantes) > 0) { iEntete = 1; entetes = suivantes; }
  }
  if (annule()) return echec('Lecture interrompue.');

  // — Ancrage des colonnes sur l'en-tête, quand les gouttières ne suffisent
  //   pas. —
  //
  // La découpe en colonnes ci-dessus (`decouperTableau`) est fondée sur
  // l'encre des LIGNES DE DONNÉES : elle suppose qu'à peu près toutes les
  // colonnes portent une valeur sur à peu près toutes les lignes. C'est vrai
  // des bilans compacts du banc de test, mais c'est faux d'un bilan CUMULÉ
  // réel, où chaque analyte n'est mesuré qu'à certaines dates — une colonne
  // de date sans AUCUNE valeur sur les quelques lignes lues n'a alors aucune
  // encre du tout, et se dissout dans la gouttière voisine : deux dates
  // fusionnent en une, silencieusement.
  //
  // La ligne d'en-tête, elle, a TOUJOURS quelque chose sous chaque date. On
  // la segmente donc indépendamment (comme pour un bandeau de couleur), et si
  // elle donne plus de dates valides que la découpe par gouttières, on
  // reconstruit les colonnes ANCRÉES sur ces dates : chaque frontière se pose
  // au milieu de la plus large gouttière entre deux dates voisines, ou à
  // mi-chemin à défaut. Le texte de chaque bloc, déjà lu, devient l'en-tête
  // de la colonne correspondante — aucun OCR supplémentaire.
  // Une bande décorative écartée juste après l'en-tête peut malgré tout
  // porter le libellé DES COLONNES QUI N'ONT PAS D'ICÔNE (« Unité », « Normes »
  // sont vides sur la ligne d'icônes, alors le moteur qui a produit la page
  // centre leur libellé sur toute la hauteur de l'en-tête, à la hauteur des
  // icônes). On la mêle donc à l'en-tête pour l'ancrage — mais seulement là où
  // elle ajoute une colonne, jamais là où elle ne fait que répéter (en
  // charabia) ce qu'une icône dit déjà sous une date déjà trouvée.
  const bandeIcones = bandesDecoratives.find(
    b => b.y0 > bandes[iEntete].y1 && b.y0 - bandes[iEntete].y1 < hL * 3,
  );
  const blocsDate = (blocsEntete.get(iEntete) ?? blocsDeBande(gris, bandes[iEntete], hL, bornesTable))
    .map(b => ({ ...b, bande: bandes[iEntete] }));
  const chevauche = (a: Colonne, b: Colonne) => a.x0 <= b.x1 && b.x0 <= a.x1;
  const blocsIcones = bandeIcones
    ? blocsDeBande(gris, bandeIcones, hL, bornesTable)
        .filter(bi => !blocsDate.some(bt => chevauche(bi, bt)))
        .map(b => ({ ...b, bande: bandeIcones }))
    : [];
  const blocsAncrage = [...blocsDate, ...blocsIcones].sort((a, b) => a.x0 - b.x0);
  if (blocsAncrage.length >= 2) {
    const margeAncrage = Math.max(2, Math.round(hL * 0.2));
    const casAncrage: Cellule[] = blocsAncrage.map(b => ({
      boite: { x0: b.x0 - margeAncrage, y0: b.bande.y0 - margeAncrage, x1: b.x1 + margeAncrage, y1: b.bande.y1 + margeAncrage },
      encre: Math.max(1, encreDansCellule(carte, b.bande, b)),
      inverse: celluleDe(carte, polarite, b.bande, b, hL).inverse,
    }));
    const textesAncrage = (await lire(casAncrage, 'texte', 'En-tête (ancrage)')).map(r => r.texte);
    if (annule()) return echec('Lecture interrompue.');
    // Relecture chiffrée systématique : à cette densité (beaucoup de colonnes,
    // petite police), le mode « texte » libre confond parfois un chiffre du
    // jour ou du mois (08 lu 18, 13 lu 03…) — un jour VALIDE mais FAUX, qui ne
    // se signale à personne. La liste blanche « date » (chiffres et
    // séparateurs seulement) n'a pas ce problème ; on la préfère chaque fois
    // qu'elle donne, elle aussi, une date reconnaissable.
    const relecturesDate = await lire(casAncrage, 'date', 'En-tête (ancrage, dates)');
    if (annule()) return echec('Lecture interrompue.');
    relecturesDate.forEach((r, i) => { if (lireDate(r.texte)) textesAncrage[i] = r.texte; });
    const nDatesAncrage = textesAncrage.filter(t => !!lireDate(t)).length;
    const nDatesGouttieres = entetes.filter(t => !!lireDate(t)).length;
    const datesAncrage = blocsAncrage
      .map((b, i) => ({ b, t: textesAncrage[i] }))
      .filter(x => !!lireDate(x.t));
    if (nDatesAncrage > nDatesGouttieres && datesAncrage.length >= 2) {
      // On ne remplace QUE le territoire des dates, jamais les colonnes de
      // noms / unité / normes : leur libellé d'en-tête est presque toujours
      // bien plus étroit que leur contenu (« Analyte » contre
      // « Anticorps anti-DNA », « Unite » contre une valeur d'unité longue),
      // et ancrer sur ce libellé leur donnerait une largeur de bloc-en-tête,
      // pas de colonne — un nom de deux caractères de trop court, tronqué à
      // gauche. Les colonnes gouttières qui ne sont pas des dates restent
      // donc telles quelles ; seules les dates sont reconstruites, ancrées.
      const colonnesGardees = colonnes
        .map((c, ci) => ({ c, ci }))
        .filter(({ ci }) => !lireDate(entetes[ci]));
      const xMinDate = Math.min(...datesAncrage.map(({ b }) => b.x0));
      const xMaxDate = Math.max(...datesAncrage.map(({ b }) => b.x1));
      const avantDates = colonnesGardees.filter(({ c }) => c.x1 < xMinDate);
      const apresDates = colonnesGardees.filter(({ c }) => c.x0 > xMaxDate);
      const borneGauche = avantDates.length ? Math.max(...avantDates.map(({ c }) => c.x1)) + 1 : bornesTable.gauche;
      const borneDroite = apresDates.length ? Math.min(...apresDates.map(({ c }) => c.x0)) - 1 : bornesTable.droite;
      const ancresDates = datesAncrage.map(({ b }) => (b.x0 + b.x1) / 2);
      const minGouttiereAncrage = Math.max(5, Math.round(hL * 0.5));
      const colonnesDates = colonnesDepuisAncres(
        profilBandes(carte, bandes.slice(1)), ancresDates,
        { gauche: borneGauche, droite: borneDroite }, minGouttiereAncrage,
      );
      const fusion = [
        ...avantDates.map(({ c, ci }) => ({ colonne: c, entete: entetes[ci] })),
        ...colonnesDates.map((c, i) => ({ colonne: c, entete: datesAncrage[i].t })),
        ...apresDates.map(({ c, ci }) => ({ colonne: c, entete: entetes[ci] })),
      ].sort((a, b) => a.colonne.x0 - b.colonne.x0);
      colonnes = fusion.map(f => f.colonne);
      entetes = fusion.map(f => f.entete);
    }
  }

  // Certains systèmes hospitaliers intercalent, ENTRE les lignes d'un même
  // tableau, une ligne de titre de section (« BIOCHIMIE (2 analyses) »),
  // repliable, posée sur un bandeau gris. Ce n'est pas une ligne de résultats :
  // son encre ne dépasse jamais la colonne des noms (rien en face, dans les
  // colonnes de dates), alors qu'une vraie ligne d'analyte — même très
  // incomplète — a toujours au moins une valeur quelque part sur sa largeur.
  // Sans ce tri, elle devenait une ligne fantôme (un nom, aucune valeur) qui
  // gonflait le nombre de lignes attendues et faisait chuter le taux de
  // lecture en dessous du seuil d'échec.
  const nomDroite = colonnes[0].x1;
  const margeTitre = Math.round(hL * 0.6);
  const estTitreDeSection = (bi: number): boolean => {
    const e = etendue(carte, bandes[bi]);
    return !!e && e.x1 <= nomDroite + margeTitre;
  };

  const iDonnees: number[] = [];
  for (let i = iEntete + 1; i < bandes.length; i++) {
    if (!estTitreDeSection(i)) iDonnees.push(i);
  }
  if (!iDonnees.length) return echec('Le tableau ne contient aucune ligne de résultats.');

  // — Relecture chiffrée des en-têtes indécis : une date mal lue en mode texte
  //   (« 12I03I2025 ») redevient lisible avec la liste blanche des dates. C'est
  //   ce qui évite trois colonnes de dates fondues en une seule sans date. —
  const indecis = colonnes.map((_, ci) => ci)
    .filter(ci => !lireDate(entetes[ci]) && !roleDepuisEntete(entetes[ci]));
  if (indecis.length) {
    const relus = await lire(indecis.map(ci => celluleEntete(iEntete, ci)), 'date', 'En-tête (dates)');
    indecis.forEach((ci, k) => { if (lireDate(relus[k].texte)) entetes[ci] = relus[k].texte; });
  }
  if (annule()) return echec('Lecture interrompue.');

  // — Échantillon de contenu, seulement là où l'en-tête n'a pas tranché —
  const aEchantillonner = colonnes.map((_, ci) => ci)
    .filter(ci => !lireDate(entetes[ci]) && !roleDepuisEntete(entetes[ci]));
  const echantillons: string[][] = colonnes.map(() => []);
  if (aEchantillonner.length) {
    const pris = [0, Math.floor(iDonnees.length / 2), iDonnees.length - 1]
      .filter((v, i, a) => v >= 0 && a.indexOf(v) === i);
    const cases: Cellule[] = [];
    const ref: number[] = [];
    for (const ci of aEchantillonner) for (const p of pris) { cases.push(cellule(iDonnees[p], ci)); ref.push(ci); }
    const lus = await lire(cases, 'texte', 'Reconnaissance des colonnes');
    lus.forEach((r, k) => echantillons[ref[k]].push(r.texte));
  }
  if (annule()) return echec('Lecture interrompue.');

  // — Rôles —
  const anneeParDefaut = opts.anneeParDefaut ?? anneeDominante(entetes);
  const candidates: ColonneCandidate[] = colonnes.map((_, ci) => ({
    index: ci, entete: entetes[ci], echantillon: echantillons[ci],
  }));
  const roles = affecterRoles(candidates, anneeParDefaut);
  opts.trace?.('roles', { colonnes, entetes, echantillons, roles: roles.map(r => r.role), bandes: bandes.map(b => [b.y0, b.y1]), iEntete });

  const colDates = roles.filter(r => r.role === 'date');
  // Titre de section qui déborde de la colonne des noms (« HÉMATO CELLULAIRE
  // GÉNÉRALE (1 analyse) ») : aucune encre sous AUCUNE colonne de résultats.
  // Ce n'est pas une ligne d'analyte.
  for (let k = iDonnees.length - 1; k >= 0; k--) {
    const bi = iDonnees[k];
    if (colDates.length && colDates.every(d => encreDansCellule(carteCases, bandes[bi], colonnes[d.index]) < 3)) {
      iDonnees.splice(k, 1);
    }
  }
  if (!iDonnees.length) return echec('Le tableau ne contient aucune ligne de résultats.');
  const colNoms = roles.filter(r => r.role === 'nom').map(r => r.index).sort((a, b) => a - b);
  const colUnite = roles.find(r => r.role === 'unite')?.index ?? -1;

  if (!colDates.length) {
    return echec(
      'Je n’ai reconnu aucune colonne de résultats dans cette capture. ' +
      'Essayez une capture plus nette, ou collez le tableau depuis Excel.',
    );
  }
  if (!colNoms.length) {
    return echec(
      'Je n’ai pas trouvé la colonne des noms de variables. ' +
      'Essayez une capture plus large, ou collez le tableau depuis Excel.',
    );
  }

  // — Noms d'analytes : les colonnes de libellés contiguës sont relues d'un
  //   seul tenant (« Anticorps anti-DNA » coupé en deux redevient entier). —
  const colNom: Colonne = {
    x0: colonnes[colNoms[0]].x0,
    x1: colonnes[colNoms[colNoms.length - 1]].x1,
  };
  avancer(0, 1, 'Lecture des variables…');
  const limitesNom = {
    x0: plageEntete(colonnes, colNoms[0], carte.largeur).x0,
    x1: plageEntete(colonnes, colNoms[colNoms.length - 1], carte.largeur).x1,
  };
  const casNoms = iDonnees.map(bi => celluleDe(carteCases, polarite, bandes[bi], colNom, hL, limitesNom));
  const lusNoms = await lire(casNoms, 'texte', 'Variables');
  if (annule()) return echec('Lecture interrompue.');

  // — Valeurs, colonne de résultats par colonne de résultats —
  const brutes: LectureVotee[][] = [];
  const boitesValeurs: Boite[][] = [];
  const glyphes: Glyphe[][][] = [];
  const geos: GeometrieCellule[][] = [];
  const pictos: boolean[][] = [];
  for (const d of colDates) {
    const col = colonnes[d.index];
    const limites = plageEntete(colonnes, d.index, carte.largeur);
    const cases = iDonnees.map(bi => celluleDe(carteCases, polarite, bandes[bi], col, hL, limites, coul));
    boitesValeurs.push(cases.map(c => c.boite));
    // Le worker OCR est unique : les lectures se font l'une après l'autre.
    const lectures: { texte: string; confiance: number }[][] = [];
    for (const h of AGRANDISSEMENTS_VALEUR) lectures.push(await lire(cases, 'valeur', 'Valeurs', h));
    brutes.push(cases.map((_, i) => voter(lectures.map(l => l[i]))));
    const nets = iDonnees.map(bi => sansDecorationsCouleur(carteCases, coul, bandes[bi], col));
    glyphes.push(nets.map(net => glyphesChiffres(net.carte, net.bande, net.col)));
    geos.push(nets.map(net => analyserCellule(net.carte, net.bande, net.col)));
    pictos.push(nets.map(net => net.picto));
    if (annule()) return echec('Lecture interrompue.');
  }

  opts.trace?.('pictos', pictos.map(col => col.map(Number).join('')));
  // — Cohérence des glyphes (voir glyphes.ts) : modèles appris sur les cases
  //   lues à l'unanimité, puis chaque autre case confrontée à ces modèles. —
  const modeles = new ModelesChiffres();
  brutes.forEach((col, c) => col.forEach((b, r) => { if (b.unanime) modeles.apprendre(b.texte, glyphes[c][r]); }));
  brutes.forEach((col, c) => col.forEach((b, r) => {
    if (b.unanime || !b.texte) return;
    const v = modeles.verifier(b.texte, glyphes[c][r]);
    // Alerte seulement, jamais de correction : sur le banc, une flèche noire
    // accolée suffit à fausser l'appariement glyphe ↔ chiffre.
    if (v.corrige) b.desaccord = true;
  }));

  // — Lignes de TEXTE (« non communiquée », « Automate : … ») : aucune case
  //   ne donne de nombre, mais il y a de l'encre. On relit une case encrée
  //   en mode texte ; si ce sont des mots, ce n'est pas une ligne de résultats.
  //   Une ligne de résultats illisible, elle, ne donne pas de mots et reste
  //   (en jaune). —
  const lignesTexte = new Set<number>();
  const casTexte: { r: number; c: number }[] = [];
  for (let r = 0; r < iDonnees.length; r++) {
    // Moins de la moitié des cases encrées donnent un nombre : suspect.
    const encrees = geos.filter(g => g[r].encre > 0).length;
    const nombres = brutes.filter(col => NOMBRE_LU.test(normaliserLecture(col[r].texte))).length;
    if (!encrees || nombres * 2 >= encrees) continue;
    const c = geos.findIndex((g, k) => g[r].encre > 0 && !NOMBRE_LU.test(normaliserLecture(brutes[k][r].texte)));
    if (c >= 0) casTexte.push({ r, c });
  }
  if (casTexte.length) {
    const lus = await lire(
      casTexte.map(({ r, c }) => celluleDe(carteCases, polarite, bandes[iDonnees[r]], colonnes[colDates[c].index], hL,
        plageEntete(colonnes, colDates[c].index, carte.largeur))),
      'texte', 'Lignes de texte',
    );
    casTexte.forEach(({ r }, k) => { if (/\p{L}{3,}/u.test(lus[k].texte)) lignesTexte.add(r); });
  }

  // — Encre typique d'une case pleine : sert à distinguer « case vide » de
  //   « case encrée mais non lue » (une valeur perdue, elle, doit être jaune). —
  const encres: number[] = [];
  for (const g of geos) for (const c of g) if (c.encre > 0) encres.push(c.encre);
  const encreTypique = encres.length ? mediane(encres) : 0;

  // — Colonnes de dates anormalement larges : le signe qu'elles ont
  //   probablement avalé deux dates voisines (gouttière non détectée entre
  //   deux dates toutes deux peu remplies). On ne le corrige pas — on ne
  //   SAIT pas où recouper — on le signale, sur CHAQUE case de la colonne,
  //   même celles qui semblent parfaitement lisibles : c'est justement le cas
  //   le plus trompeur (deux chiffres proprement recollés en un seul nombre
  //   crédible). Comparaison à la MÉDIANE des largeurs de colonnes de dates,
  //   pas à une constante : une capture dense a des colonnes bien plus
  //   étroites qu'une capture aérée, et ce sont leurs largeurs mutuelles qui
  //   comptent.
  const largeursDates = colDates.map(d => colonnes[d.index].x1 - colonnes[d.index].x0 + 1);
  const largeurMedianeDate = mediane(largeursDates) || 1;
  const colonneAnormale = largeursDates.map(l => l > largeurMedianeDate * 1.7 && l > largeurMedianeDate + hL);

  // — Dates de colonnes —
  const dates: DateLue[] = colDates.map(d => {
    const v = jugerDate(d.date as DateEntete | null, 100);
    return {
      iso: d.date?.iso ?? null, brut: d.date?.brut ?? '', douteux: v.douteux, motifs: v.motifs,
      vignette: opts.vignettes ? vignette(source, celluleEntete(iEntete, d.index).boite) : undefined,
    };
  });

  // — Assemblage des lignes —
  const lignes: LigneLue[] = [];
  const unitesALire: { ligne: number; bande: number }[] = [];

  for (let r = 0; r < iDonnees.length; r++) {
    if (lignesTexte.has(r)) continue;
    const nom = corrigerNomParCatalogue(nettoyerNom(lusNoms[r].texte), n => !!matchCatalogExact(n));
    const valeurs = colDates.map((_, c) => {
      const g = geos[c][r];
      const brut = brutes[c][r];
      const rep = reparerNombre(brut.texte, g.separateur);
      return {
        texte: rep.texte, retabli: rep.separateurRetabli, desaccord: brut.desaccord,
        sepGeo: !!g.separateur,
        // Trois agrandissements lus à l'identique : la confiance interne de
        // Tesseract sur UNE lecture n'apporte plus rien.
        conf: brut.unanime ? 100 : brut.confiance, encre: g.encre,
        glyphes: g.glyphes, picto: pictos[c][r],
        // Une virgule rétablie compte comme lue : sans cela, la réparation
        // déclencherait elle-même l'alerte « un signe n'a pas été lu ».
        lus: (brut.texte.match(/[0-9.,<>]/g) ?? []).length + (rep.separateurRetabli ? 1 : 0),
      };
    });

    // Une ligne sans nom ET sans valeur n'est pas une ligne : filet, séparateur.
    if (!nom && valeurs.every(v => !v.texte)) continue;

    const cat = matchCatalog(nom);
    const cellules: CelluleLue[] = valeurs.map((v, c) => {
      const verdict = jugerValeur({
        texte: v.texte,
        confiance: v.conf,
        encre: v.encre,
        encreTypique,
        separateurGeometrique: v.sepGeo,
        separateurRetabli: v.retabli,
        desaccordRelecture: v.desaccord,
        nomAnalyte: nom,
        autresDeLaLigne: valeurs.filter((_, k) => k !== c).map(o => o.texte),
        confiancesAutresDeLaLigne: valeurs.filter((_, k) => k !== c).map(o => o.conf),
        glyphes: v.glyphes,
        caracteresLus: v.lus,
        colonneAnormale: colonneAnormale[c],
        picto: v.picto,
      });
      // Virgule perdue, la ligne pour témoin : on PROPOSE la correction, le
      // texte lu reste tel quel tant que le médecin ne l'a pas acceptée.
      const corrige = corrigerDecimalePerdue(v.texte, valeurs.filter((_, k) => k !== c).map(o => o.texte));
      if (corrige) {
        return {
          texte: v.texte, douteux: true, proposition: corrige,
          motifs: [...verdict.motifs.filter(m => !m.includes('facteur 10')), `virgule probablement perdue : lu « ${v.texte} », proposé « ${corrige} »`],
          vignette: opts.vignettes && v.encre > 0 ? vignette(source, boitesValeurs[c][r]) : undefined,
        };
      }
      return {
        texte: v.texte, douteux: verdict.douteux, motifs: verdict.motifs,
        vignette: opts.vignettes && v.encre > 0 ? vignette(source, boitesValeurs[c][r]) : undefined,
      };
    });

    const vNom = jugerNom(nom, lusNoms[r].confiance);
    lignes.push({
      nom,
      unite: cat ? cat.unit : '',
      nomDouteux: vNom.douteux,
      nomMotifs: vNom.motifs,
      cellules,
      vignette: opts.vignettes
        ? vignette(source, {
            x0: colNom.x0, y0: bandes[iDonnees[r]].y0 - 2,
            x1: colonnes[colDates[colDates.length - 1].index].x1,
            y1: bandes[iDonnees[r]].y1 + 2,
          })
        : undefined,
      vignetteNom: opts.vignettes ? vignette(source, casNoms[r].boite) : undefined,
    });
    if (!cat && colUnite >= 0) unitesALire.push({ ligne: lignes.length - 1, bande: iDonnees[r] });
  }

  // — Unité : le catalogue d'abord (c'est la demande du médecin) ; on ne va la
  //   chercher sur l'image que pour les analytes que l'application ne connaît
  //   pas, sinon on paierait dix reconnaissances pour rien. —
  if (unitesALire.length && colUnite >= 0) {
    const lus = await lire(
      unitesALire.map(u => celluleDe(carteCases, polarite, bandes[u.bande], colonnes[colUnite], hL,
        plageEntete(colonnes, colUnite, carte.largeur))),
      'texte', 'Unités',
    );
    unitesALire.forEach((u, k) => { lignes[u.ligne].unite = lus[k].texte.replace(/\s+/g, ''); });
  }

  // Un « tableau » d'une seule ligne n'est pas un bilan : c'est une découpe qui
  // a échoué. Mieux vaut le dire franchement que proposer une ligne inventée.
  if (lignes.length < 2) {
    return echec('Je n’ai su lire aucune ligne de résultats dans cette capture.');
  }

  // — Verdict global : mieux vaut un échec net que cinq valeurs fausses. —
  const cellulesTotal = lignes.length * dates.length;
  const remplies = lignes.reduce((s, l) => s + l.cellules.filter(c => c.texte).length, 0);
  if (cellulesTotal > 0 && remplies < cellulesTotal * 0.25) {
    return echec(
      `Je n’ai su lire que ${remplies} valeur(s) sur ${cellulesTotal}. ` +
      'Essayez une capture plus large ou plus nette, ou collez le tableau depuis Excel.',
    );
  }

  return { dates, lignes, echec: false, message: '' };
}

/** Année la plus fréquente parmi les en-têtes lisibles (contexte des « 12/03 »). */
export function anneeDominante(entetes: string[]): number | undefined {
  const compte = new Map<number, number>();
  for (const e of entetes) {
    const d = lireDate(e);
    if (d?.iso) {
      const a = +d.iso.slice(0, 4);
      compte.set(a, (compte.get(a) ?? 0) + 1);
    }
  }
  let meilleure: number | undefined, n = 0;
  for (const [a, c] of compte) if (c > n) { n = c; meilleure = a; }
  return meilleure;
}
