// ──────────────────────────────────────────────────────────────
// Détection de la structure d'un tableau AVANT l'OCR.
//
// On ne travaille que sur une carte d'encre binaire (1 = pixel sombre).
// Par projection horizontale on isole les BANDES (lignes de texte), par
// projection verticale les GOUTTIÈRES (colonnes de blanc qui séparent les
// colonnes du tableau). Reconnaître ensuite cellule par cellule est bien plus
// fiable qu'un OCR global suivi d'une reconstruction géométrique : chaque
// cellule est lue isolément, sans que ses voisines ne perturbent la
// segmentation de Tesseract.
//
// Tout ce module est pur (pas de DOM) : il est testable hors navigateur.
// ──────────────────────────────────────────────────────────────

export interface CarteEncre {
  largeur: number;
  hauteur: number;
  /** 1 = encre, 0 = fond. Longueur = largeur × hauteur. */
  encre: Uint8Array;
}

export interface Bande { y0: number; y1: number; }
export interface Colonne { x0: number; x1: number; }

/** Profil horizontal : nombre de pixels d'encre par ligne de pixels. */
export function profilHorizontal(carte: CarteEncre): Int32Array {
  const { largeur, hauteur, encre } = carte;
  const p = new Int32Array(hauteur);
  for (let y = 0; y < hauteur; y++) {
    let n = 0;
    const base = y * largeur;
    for (let x = 0; x < largeur; x++) n += encre[base + x];
    p[y] = n;
  }
  return p;
}

/**
 * Profil vertical restreint aux bandes de texte : nombre de pixels d'encre par
 * colonne de pixels. En ignorant l'espace entre les lignes, les gouttières
 * ressortent nettement même quand le tableau a des filets horizontaux.
 */
export function profilVertical(carte: CarteEncre, bandes: Bande[]): Int32Array {
  const { largeur, encre } = carte;
  const p = new Int32Array(largeur);
  const zones = bandes.length ? bandes : [{ y0: 0, y1: carte.hauteur - 1 }];
  for (const b of zones) {
    for (let y = b.y0; y <= b.y1; y++) {
      const base = y * largeur;
      for (let x = 0; x < largeur; x++) p[x] += encre[base + x];
    }
  }
  return p;
}

/** Médiane d'un tableau de nombres (0 si vide). */
export function mediane(valeurs: number[]): number {
  if (!valeurs.length) return 0;
  const t = [...valeurs].sort((a, b) => a - b);
  return t[Math.floor(t.length / 2)];
}

/**
 * Bandes de texte : suites de lignes de pixels contenant de l'encre.
 *
 * - `bruit` : nombre de pixels d'encre en deçà duquel une ligne est du fond
 *   (élimine le poussier et les bords).
 * - Les bandes trop fines par rapport à la médiane (filets horizontaux d'un
 *   tableau encadré, soulignements) sont écartées.
 * - Deux bandes séparées par un intervalle minuscule sont fusionnées
 *   (accents détachés, exposants).
 */
export function detecterBandes(carte: CarteEncre, opts: { bruit?: number } = {}): Bande[] {
  const prof = profilHorizontal(carte);
  // Seuil de bruit RELATIF à l'encre réellement présente. Un seuil absolu de
  // deux pixels laisse un jambage, une bordure de cellule ou le bord d'une
  // zébrure gris clair relier deux lignes voisines : sur un tableau dense, les
  // cinq lignes de résultats fusionnaient alors en une seule bande et toute la
  // capture était perdue.
  const bruit = opts.bruit ?? seuilDeBruit(prof, carte.largeur);
  const brutes: Bande[] = [];
  let debut = -1;
  for (let y = 0; y < carte.hauteur; y++) {
    const plein = prof[y] > bruit;
    if (plein && debut < 0) debut = y;
    else if (!plein && debut >= 0) { brutes.push({ y0: debut, y1: y - 1 }); debut = -1; }
  }
  if (debut >= 0) brutes.push({ y0: debut, y1: carte.hauteur - 1 });
  if (!brutes.length) return [];

  // Fusion des fragments très proches (accents, jambages coupés).
  const hauteurs = brutes.map(b => b.y1 - b.y0 + 1);
  const hMed = mediane(hauteurs.filter(h => h > 2)) || mediane(hauteurs);
  const ecart = Math.max(1, Math.round(hMed * 0.25));
  const fusion: Bande[] = [];
  for (const b of brutes) {
    const p = fusion[fusion.length - 1];
    if (p && b.y0 - p.y1 <= ecart) p.y1 = b.y1;
    else fusion.push({ ...b });
  }

  // Rejet des filets (barres horizontales fines) : une bande de texte fait au
  // moins 45 % de la hauteur médiane.
  const hFus = fusion.map(b => b.y1 - b.y0 + 1);
  const hRef = mediane(hFus.filter(h => h >= 4)) || mediane(hFus);
  const minH = Math.max(3, Math.round(hRef * 0.45));
  return fusion.filter(b => b.y1 - b.y0 + 1 >= minH);
}

/**
 * Seuil séparant une ligne de texte d'une ligne de fond, calé sur le haut du
 * profil : une ligne de texte encre 10 à 30 % de la largeur du tableau, un
 * interligne quelques pixels épars.
 */
export function seuilDeBruit(profil: Int32Array, largeur: number): number {
  const tri = Array.from(profil).filter(v => v > 0).sort((a, b) => a - b);
  if (!tri.length) return 1;
  const haut = tri[Math.floor(tri.length * 0.9)];
  return Math.max(2, Math.min(Math.round(largeur * 0.02), Math.round(haut * 0.12)));
}

/** Hauteur médiane des bandes (hauteur d'une ligne de texte, en pixels). */
export function hauteurLigne(bandes: Bande[]): number {
  return mediane(bandes.map(b => b.y1 - b.y0 + 1));
}

export interface Gouttiere { x0: number; x1: number; largeur: number; }

/**
 * Gouttières : plages horizontales sans encre (ou presque), d'au moins
 * `largeurMin` pixels. Ce sont les séparations candidates entre colonnes.
 */
export function detecterGouttieres(profil: Int32Array, largeurMin: number, seuil = 0): Gouttiere[] {
  const out: Gouttiere[] = [];
  let debut = -1;
  for (let x = 0; x < profil.length; x++) {
    const vide = profil[x] <= seuil;
    if (vide && debut < 0) debut = x;
    else if (!vide && debut >= 0) {
      if (x - debut >= largeurMin) out.push({ x0: debut, x1: x - 1, largeur: x - debut });
      debut = -1;
    }
  }
  if (debut >= 0 && profil.length - debut >= largeurMin) {
    out.push({ x0: debut, x1: profil.length - 1, largeur: profil.length - debut });
  }
  return out;
}

/**
 * Découpe en colonnes à partir des gouttières : les colonnes sont les plages
 * d'encre entre deux gouttières. Les colonnes vides ou minuscules (filets
 * verticaux d'un tableau encadré) sont écartées.
 */
export function colonnesDepuisGouttieres(
  profil: Int32Array,
  largeurMinGouttiere: number,
  largeurMinColonne = 4,
  /** Encre tolérée dans une gouttière : un titre débordant ne doit pas la boucher. */
  seuil = 0,
): Colonne[] {
  const g = detecterGouttieres(profil, largeurMinGouttiere, seuil);
  const bornes: Colonne[] = [];
  let x = 0;
  for (const gg of g) {
    if (gg.x0 > x) bornes.push({ x0: x, x1: gg.x0 - 1 });
    x = gg.x1 + 1;
  }
  if (x < profil.length) bornes.push({ x0: x, x1: profil.length - 1 });
  return bornes.filter(c => c.x1 - c.x0 + 1 >= largeurMinColonne);
}

/**
 * Découpe en colonnes ANCRÉE sur des abscisses connues (les centres des dates
 * de l'en-tête). Entre deux ancres consécutives, la frontière est posée au
 * milieu de la gouttière la plus large ; à défaut, à mi-chemin.
 *
 * C'est la méthode la plus sûre quand l'en-tête a été lu : les colonnes de
 * valeurs sont alors calées sur la structure réelle du tableau, pas sur des
 * blancs qui peuvent être fortuits (mots courts, cellules vides).
 */
export function colonnesDepuisAncres(
  profil: Int32Array,
  ancres: number[],
  bornes: { gauche: number; droite: number },
  largeurMinGouttiere: number,
): Colonne[] {
  const tri = [...ancres].sort((a, b) => a - b);
  const gouttieres = detecterGouttieres(profil, largeurMinGouttiere);
  const frontiere = (a: number, b: number): number => {
    const dedans = gouttieres.filter(g => g.x0 > a && g.x1 < b);
    if (dedans.length) {
      const meilleure = dedans.reduce((m, g) => (g.largeur > m.largeur ? g : m));
      return Math.round((meilleure.x0 + meilleure.x1) / 2);
    }
    return Math.round((a + b) / 2);
  };
  const out: Colonne[] = [];
  for (let i = 0; i < tri.length; i++) {
    const g = i === 0 ? frontiere(bornes.gauche, tri[0]) : frontiere(tri[i - 1], tri[i]);
    const d = i === tri.length - 1 ? bornes.droite : frontiere(tri[i], tri[i + 1]);
    out.push({ x0: g, x1: d });
  }
  return out;
}

/**
 * Une cellule contient-elle de l'encre ? (sert à distinguer « case vide » de
 * « case mal lue » : une case vide dans une ligne par ailleurs remplie est
 * suspecte, une case sans encre est simplement vide.)
 */
export function encreDansCellule(carte: CarteEncre, bande: Bande, col: Colonne): number {
  let n = 0;
  const x0 = Math.max(0, col.x0), x1 = Math.min(carte.largeur - 1, col.x1);
  const y0 = Math.max(0, bande.y0), y1 = Math.min(carte.hauteur - 1, bande.y1);
  for (let y = y0; y <= y1; y++) {
    const base = y * carte.largeur;
    for (let x = x0; x <= x1; x++) n += carte.encre[base + x];
  }
  return n;
}

/**
 * Profil « nombre de BANDES » : pour chaque abscisse, combien de lignes de
 * texte contiennent de l'encre à cet endroit.
 *
 * C'est bien plus robuste que la somme des pixels pour trouver les gouttières :
 * un titre large (« Résultats du 01/01/2023 au 31/12/2026 ») ou une ligne de
 * pied de page ne pèsent qu'une bande sur douze et ne peuvent donc plus
 * boucher une gouttière que tout le reste du tableau laisse libre. C'est
 * précisément ce qui faisait perdre deux captures entières à l'ancienne chaîne.
 */
export function profilBandes(carte: CarteEncre, bandes: Bande[]): Int32Array {
  const p = new Int32Array(carte.largeur);
  for (const b of bandes) {
    const vu = new Uint8Array(carte.largeur);
    for (let y = Math.max(0, b.y0); y <= Math.min(carte.hauteur - 1, b.y1); y++) {
      const base = y * carte.largeur;
      for (let x = 0; x < carte.largeur; x++) if (carte.encre[base + x]) vu[x] = 1;
    }
    for (let x = 0; x < carte.largeur; x++) p[x] += vu[x];
  }
  return p;
}

/**
 * Colonnes de pixels qui sont en réalité un FILET vertical du tableau : de
 * l'encre à presque toutes les hauteurs de texte. Sans ce traitement, un
 * tableau encadré n'a plus de gouttière (le filet coupe le blanc en deux) et
 * la découpe en colonnes échoue.
 */
export function filetsVerticaux(profil: Int32Array, hauteurTexte: number): Set<number> {
  const out = new Set<number>();
  if (hauteurTexte <= 0) return out;
  for (let x = 0; x < profil.length; x++) {
    if (profil[x] >= hauteurTexte * 0.75) out.add(x);
  }
  return out;
}

/** Copie du profil avec les filets verticaux mis à zéro. */
export function sansFilets(profil: Int32Array, hauteurTexte: number): Int32Array {
  const filets = filetsVerticaux(profil, hauteurTexte);
  if (!filets.size) return profil;
  const p = profil.slice();
  for (const x of filets) p[x] = 0;
  return p;
}

/**
 * Découpe complète en colonnes à partir des bandes de texte.
 *
 * `largeurMinGouttiere` est calée sur la hauteur de ligne : une gouttière de
 * tableau vaut au moins ~0,55 hauteur de ligne, alors qu'une espace entre deux
 * mots d'un même libellé (« Bilirubine totale ») en vaut trois fois moins.
 */
export function decouperColonnes(carte: CarteEncre, bandes: Bande[]): Colonne[] {
  if (!bandes.length) return [];
  const profil = profilBandes(carte, bandes);
  const hLigne = hauteurLigne(bandes) || 12;
  const min = Math.max(5, Math.round(hLigne * 0.5));
  // Une gouttière tolère quelques bandes débordantes (titre, pied de page).
  const seuil = Math.max(0, Math.floor(bandes.length * 0.15));
  const largeurMinColonne = Math.max(4, Math.round(hLigne * 0.35));
  return colonnesDepuisGouttieres(profil, min, largeurMinColonne, seuil);
}

// ──────────────────────────────────────────────────────────────
// Analyse fine d'une cellule : composantes connexes.
//
// Sert à deux contrôles que Tesseract ne sait pas faire tout seul :
//  · retrouver une VIRGULE DÉCIMALE perdue (une petite tache basse entre deux
//    chiffres) — c'est l'erreur « 12,2 lu 122 », fausse d'un facteur 10 ;
//  · compter les caractères réellement présents, pour détecter une lecture
//    manifestement incomplète.
// ──────────────────────────────────────────────────────────────

export interface Composante { x0: number; y0: number; x1: number; y1: number; pixels: number; }

/** Composantes connexes (8-connexité) de l'encre à l'intérieur d'une boîte. */
export function composantes(carte: CarteEncre, bande: Bande, col: Colonne): Composante[] {
  const x0 = Math.max(0, col.x0), x1 = Math.min(carte.largeur - 1, col.x1);
  const y0 = Math.max(0, bande.y0), y1 = Math.min(carte.hauteur - 1, bande.y1);
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  if (w <= 0 || h <= 0) return [];
  const vu = new Uint8Array(w * h);
  const out: Composante[] = [];
  const pile = new Int32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (vu[i] || !carte.encre[(y0 + y) * carte.largeur + (x0 + x)]) continue;
      let sommet = 0;
      pile[sommet++] = i;
      vu[i] = 1;
      const c: Composante = { x0: x, y0: y, x1: x, y1: y, pixels: 0 };
      while (sommet > 0) {
        const j = pile[--sommet];
        const jx = j % w, jy = (j - jx) / w;
        c.pixels++;
        if (jx < c.x0) c.x0 = jx;
        if (jx > c.x1) c.x1 = jx;
        if (jy < c.y0) c.y0 = jy;
        if (jy > c.y1) c.y1 = jy;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = jy + dy;
          if (ny < 0 || ny >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const nx = jx + dx;
            if (nx < 0 || nx >= w) continue;
            const k = ny * w + nx;
            if (vu[k] || !carte.encre[(y0 + ny) * carte.largeur + (x0 + nx)]) continue;
            vu[k] = 1;
            pile[sommet++] = k;
          }
        }
      }
      // Poussière : une composante d'un ou deux pixels n'est pas un caractère.
      if (c.pixels >= 2) out.push(c);
    }
  }
  return out.sort((a, b) => a.x0 - b.x0);
}

export interface GeometrieCellule {
  /** Nombre de composantes de taille « caractère ». */
  glyphes: number;
  /** Pixels d'encre dans la cellule. */
  encre: number;
  /**
   * Séparateur décimal repéré dans l'encre : petite tache basse entre deux
   * chiffres. `chiffresAvant` = nombre de glyphes à sa gauche.
   */
  separateur: { chiffresAvant: number } | null;
}

/** Analyse géométrique d'une cellule numérique. */
export function analyserCellule(carte: CarteEncre, bande: Bande, col: Colonne): GeometrieCellule {
  const comps = composantes(carte, bande, col);
  const encre = comps.reduce((s, c) => s + c.pixels, 0);
  if (!comps.length) return { glyphes: 0, encre: 0, separateur: null };

  const hauteurs = comps.map(c => c.y1 - c.y0 + 1);
  const hMax = Math.max(...hauteurs);
  // Les « chiffres » sont les composantes de hauteur proche du maximum.
  const chiffres = comps.filter(c => c.y1 - c.y0 + 1 >= hMax * 0.6);
  if (!chiffres.length) return { glyphes: comps.length, encre, separateur: null };
  const basChiffres = Math.max(...chiffres.map(c => c.y1));
  const hautChiffres = Math.min(...chiffres.map(c => c.y0));
  const hChiffre = Math.max(1, basChiffres - hautChiffres + 1);

  let separateur: { chiffresAvant: number } | null = null;
  for (const c of comps) {
    const h = c.y1 - c.y0 + 1;
    const w = c.x1 - c.x0 + 1;
    if (h > hChiffre * 0.45) continue;              // trop haut pour une virgule
    if (w > hChiffre * 0.55) continue;              // trop large (un tiret, un « - »)
    const centre = (c.y0 + c.y1) / 2;
    if (centre < hautChiffres + hChiffre * 0.55) continue; // trop haut placé
    const xc = (c.x0 + c.x1) / 2;
    const avant = chiffres.filter(d => (d.x0 + d.x1) / 2 < xc).length;
    // Une virgule décimale est ENTRE deux chiffres, jamais en bout.
    if (avant === 0 || avant === chiffres.length) continue;
    separateur = { chiffresAvant: avant };
    break;
  }

  return { glyphes: chiffres.length + (separateur ? 1 : 0), encre, separateur };
}

/**
 * Classification chromatique alignée pixel à pixel sur une `CarteEncre` (voir
 * `preparation.ts#carteCouleur`) : 0 = neutre, 1/3 = bleu (franc/léger),
 * 2/4 = chaud (franc/léger — orange/rouge).
 */
export interface CarteCouleur {
  largeur: number;
  hauteur: number;
  classe: Uint8Array;
}

/**
 * Repère, dans une case de VALEUR, l'encre d'un pictogramme accolé au nombre
 * (badge « i » d'information bleu, flèche de tendance orange) — un usage
 * répandu des extranets hospitaliers, glué sans espace au résultat
 * (« ⓘ17↓ »).
 *
 * Le repérage se fait par HYSTÉRÉSIS (comme un détecteur de contours), à
 * l'intérieur de chaque famille de teinte séparément (le bleu ne se propage
 * jamais dans le chaud, ni l'un ni l'autre dans le neutre) :
 *
 *  1. un pixel FRANCHEMENT coloré amorce un bloc ;
 *  2. le bloc s'étend aux pixels FAIBLEMENT colorés de MÊME famille qui le
 *     touchent — le liséré antialiasé d'un badge rond, fondu vers le blanc,
 *     rejoint ainsi son cœur plutôt que de survivre comme résidu ;
 *  3. jamais à un pixel NEUTRE, même adjacent — c'est ce qui protège un
 *     chiffre qui toucherait le pictogramme par un unique pixel de contour
 *     (l'antialiasing les fait parfois se frôler) : n'étant pas coloré, il
 *     n'est jamais entraîné dans le bloc à retirer, à la différence d'un
 *     découpage en composantes de l'ENCRE (bleu et chiffre voisin fusionnés
 *     en une seule composante, retirée en bloc).
 *
 * Deux règles, une fois les blocs formés :
 *
 *  · le BLEU n'est jamais la couleur d'un résultat — c'est toujours un
 *    pictogramme, donc systématiquement retiré ;
 *  · le CHAUD (orange/rouge) est ambigu : c'est aussi la couleur d'une
 *    valeur pathologique ENTIÈREMENT colorée par certains systèmes. On ne le
 *    retire donc que si la case porte, PAR AILLEURS, une quantité d'encre
 *    neutre comparable à un vrai chiffre (au moins 1,5 fois la hauteur de
 *    ligne) — la preuve que la vraie couleur du résultat est neutre, et que
 *    le chaud n'est qu'une flèche accolée. Un simple rapport de comptage
 *    aurait laissé passer une flèche pleine, dont la pointe élargie pèse
 *    souvent PLUS de pixels qu'un « 1 » fin.
 *
 * Renvoie une carte LOCALE (indices 0-based, réutilisable telle quelle par
 * `boiteEncre`/`composantes`/`analyserCellule`), avec le décalage `dx, dy`
 * pour reconvertir une position locale en coordonnées de l'image d'origine,
 * et `picto` (au moins un pixel de décoration effectivement retiré) — signal
 * repris par `confiance.ts#jugerValeur` : une case où un pictogramme a dû
 * être découpé est structurellement plus fragile à lire, et mérite qu'on ne
 * laisse pas passer une lecture Tesseract à confiance nulle sans un jaune.
 */
export function sansDecorationsCouleur(
  carte: CarteEncre, coul: CarteCouleur, bande: Bande, col: Colonne,
): { carte: CarteEncre; bande: Bande; col: Colonne; dx: number; dy: number; picto: boolean } {
  const x0 = Math.max(0, col.x0), x1 = Math.min(carte.largeur - 1, col.x1);
  const y0 = Math.max(0, bande.y0), y1 = Math.min(carte.hauteur - 1, bande.y1);
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const local = { bande: { y0: 0, y1: Math.max(0, h - 1) }, col: { x0: 0, x1: Math.max(0, w - 1) }, dx: x0, dy: y0 };
  if (w <= 0 || h <= 0) return { carte, ...local, picto: false };

  const encre = new Uint8Array(w * h);
  const classe = new Uint8Array(w * h);
  let neutreTotal = 0;
  for (let y = 0; y < h; y++) {
    const gBase = (y0 + y) * carte.largeur;
    for (let x = 0; x < w; x++) {
      const li = y * w + x;
      const v = carte.encre[gBase + (x0 + x)];
      encre[li] = v;
      if (!v) continue;
      const c = coul.classe[gBase + (x0 + x)];
      classe[li] = c;
      if (c === 0) neutreTotal++;
    }
  }
  const oteChaud = neutreTotal >= Math.max(4, h * 1.5);

  // Un pixel isolé, ou presque, peut franchir les seuils « francs » sans
  // être un pictogramme : le lissage sous-pixel des polices (ClearType et
  // apparentés) produit, sur le contour de N'IMPORTE QUEL texte noir, des
  // franges rouges et bleues qui dépassent largement 30 de chroma — jusqu'à
  // 140 mesuré sur les captures du banc, plus que certains pixels du VRAI
  // badge. Ce qui les distingue : la frange n'est qu'un liséré d'UN pixel de
  // large, jamais un aplat ; un vrai pictogramme, lui, est une tache pleine
  // de plusieurs dizaines de pixels francs, connectés entre eux (le cœur du
  // badge, pas son contour). On n'amorce donc la propagation qu'à partir
  // d'un bloc de pixels francs qui atteint cette taille — jamais depuis un
  // pixel franc isolé.
  const TAILLE_MIN_PICTO = 45;
  const seedsQualifies = (franc: 1 | 2): Uint8Array => {
    const vu = new Uint8Array(w * h);
    const qualifie = new Uint8Array(w * h);
    const px = new Int32Array(w * h), py = new Int32Array(w * h);
    for (let y0l = 0; y0l < h; y0l++) {
      for (let x0l = 0; x0l < w; x0l++) {
        const depart = y0l * w + x0l;
        if (classe[depart] !== franc || vu[depart]) continue;
        const membres: number[] = [];
        let sommet = 0;
        px[sommet] = x0l; py[sommet] = y0l; sommet++;
        vu[depart] = 1;
        while (sommet > 0) {
          sommet--;
          const cx = px[sommet], cy = py[sommet];
          membres.push(cy * w + cx);
          for (let dy = -1; dy <= 1; dy++) {
            const ny = cy + dy;
            if (ny < 0 || ny >= h) continue;
            for (let dx = -1; dx <= 1; dx++) {
              const nx = cx + dx;
              if (nx < 0 || nx >= w) continue;
              const ni = ny * w + nx;
              if (vu[ni] || classe[ni] !== franc) continue;
              vu[ni] = 1;
              px[sommet] = nx; py[sommet] = ny; sommet++;
            }
          }
        }
        if (membres.length >= TAILLE_MIN_PICTO) for (const m of membres) qualifie[m] = 1;
      }
    }
    return qualifie;
  };

  // Propagation par hystérésis : un bloc franc QUALIFIÉ amorce, et le
  // retrait gagne les pixels faibles de MÊME famille (3 avec 1, 4 avec 2)
  // par 8-connexité — jamais au-delà.
  const retire = new Uint8Array(w * h);
  const pileX = new Int32Array(w * h), pileY = new Int32Array(w * h);
  const propage = (franc: 1 | 2, faible: 3 | 4, condition: boolean) => {
    if (!condition) return;
    const qualifies = seedsQualifies(franc);
    let sommet = 0;
    for (let i = 0; i < classe.length; i++) {
      if (qualifies[i] && !retire[i]) { retire[i] = 1; pileX[sommet] = i % w; pileY[sommet] = (i / w) | 0; sommet++; }
    }
    while (sommet > 0) {
      sommet--;
      const cx = pileX[sommet], cy = pileY[sommet];
      for (let dy = -1; dy <= 1; dy++) {
        const ny = cy + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx;
          if (nx < 0 || nx >= w) continue;
          const ni = ny * w + nx;
          if (retire[ni] || !encre[ni]) continue;
          if (classe[ni] !== franc && classe[ni] !== faible) continue;
          retire[ni] = 1;
          pileX[sommet] = nx; pileY[sommet] = ny; sommet++;
        }
      }
    }
  };
  propage(1, 3, true);
  propage(2, 4, oteChaud);

  let picto = false;
  for (let i = 0; i < encre.length; i++) {
    if (!retire[i]) continue;
    picto = true;
    encre[i] = 0;
  }
  return { carte: { largeur: w, hauteur: h, encre }, ...local, picto };
}

/** Boîte englobante de l'encre d'une cellule (null si la cellule est vide). */
export function boiteEncre(carte: CarteEncre, bande: Bande, col: Colonne): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const cx0 = Math.max(0, col.x0), cx1 = Math.min(carte.largeur - 1, col.x1);
  const by0 = Math.max(0, bande.y0), by1 = Math.min(carte.hauteur - 1, bande.y1);
  for (let y = by0; y <= by1; y++) {
    const base = y * carte.largeur;
    for (let x = cx0; x <= cx1; x++) {
      if (carte.encre[base + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < x0 ? null : { x0, y0, x1, y1 };
}
