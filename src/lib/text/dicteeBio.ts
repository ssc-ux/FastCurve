import { matchCatalog, normalize, type CatalogEntry } from '../models/catalog';
import { parseDate, parseDateSouple } from '../models/types';

// ──────────────────────────────────────────────────────────────
// DICTÉE VOCALE (Dragon ou saisie manuelle) → analytes + valeurs.
//
// Aucun micro, aucune reconnaissance vocale ici : Dragon (ou le médecin au
// clavier) tape dans un champ de texte comme n'importe quel logiciel, et ce
// module relit ce texte à chaque changement pour en extraire des paires
// « analyte → valeur ». 100% local, aucune donnée audio n'entre en jeu.
//
// Reconnaissance des noms : entièrement déléguée à `matchCatalog` (déjà
// utilisé par l'OCR), en lecture seule — pas de logique dupliquée ici.
//
// Le point délicat est la FRONTIÈRE DE MOT : le texte est relu à chaque
// frappe, donc un nombre en train de s'écrire (« créatinine 9 » qui va
// devenir « créatinine 90 ») ne doit jamais être proposé comme définitif tant
// que rien ne prouve qu'il a fini de s'écrire. Voir `estOuvert` plus bas.
//
// DATE PAR VALEUR (optionnelle) : une valeur peut être suivie d'une date
// dictée (« le 28/06/2026 », « le 28 06 2026 », « le 28 juin 2026 »). Quand
// c'est le cas, `ItemDicte.date` porte cette date ISO ; sinon elle reste
// `null` et l'appelant retombe sur la date globale du champ au-dessus du
// tableau — c'est ce qui garde le cas simple (une seule date pour tout le
// lot) strictement identique à avant. Une date mal dictée ou incomplète
// (encore en train de s'écrire) ne casse rien : elle est simplement ignorée,
// exactement comme un mot inconnu isolé l'était déjà.
// ──────────────────────────────────────────────────────────────

export interface ItemDicte {
  /** Nom affiché : le libellé canonique du catalogue, ou le texte brut dicté si l'analyte n'y figure pas. */
  nom: string;
  /** Entrée du catalogue reconnue (null si l'analyte n'est pas dans le catalogue). */
  catalogue: CatalogEntry | null;
  /** Texte de la valeur tel que dicté (virgule française conservée). */
  valeurTexte: string;
  /** Valeur numérique (point décimal), ou null si aucune valeur n'a encore été dictée pour ce nom. */
  valeur: number | null;
  /**
   * Date ISO ('AAAA-MM-JJ') dictée juste après cette valeur (« le
   * 28/06/2026 »), ou `null` si aucune date locale n'a été reconnue — dans ce
   * cas l'appelant doit utiliser la date globale du champ au-dessus du
   * tableau, exactement comme avant l'ajout de cette fonctionnalité.
   */
  date: string | null;
  /**
   * Faux tant que le nom ou la valeur touche encore le tout dernier mot du
   * texte ET que ce mot n'est pas encore refermé par un espace : il peut
   * encore s'allonger à la prochaine frappe. Un item incomplet ne doit
   * JAMAIS être écrit dans le graphique — seulement prévisualisé, sinon on
   * fige une valeur fausse puis on la corrige brutalement sous les yeux du
   * médecin.
   */
  complet: boolean;
  /** Position du premier caractère du nom dans le texte source. */
  debut: number;
  /** Position juste après le dernier caractère retenu (nom, ou valeur si trouvée) dans le texte source. */
  fin: number;
}

export interface ResultatDictee {
  /** Un item par analyte du catalogue reconnu (la dernière occurrence dictée l'emporte sur une éventuelle correction orale antérieure). */
  reconnus: ItemDicte[];
  /** Un item par bribe qui ressemble à « nom d'analyte + valeur » mais absente du catalogue — à proposer à la création, jamais ignorée en silence. */
  inconnus: ItemDicte[];
}

// ── Vocabulaire à ignorer entre un nom et sa valeur ──────────────
//
// Deux familles : les mots de liaison (« à », « de », « est »…) et les mots
// d'unité que Dragon retranscrit souvent après la valeur (« micromol par
// litre »). Sans ce filtre, « micromol par litre » apparaîtrait comme un
// pseudo-analyte non reconnu à chaque dictée de créatinine.
const MOTS_VIDES = new Set([
  'a', 'de', 'du', 'des', 'le', 'la', 'les', 'est', 'sont', 'et', 'donc',
  'egale', 'egal', 'environ', 'vaut', 'valeur', 'soit', 'aujourdhui',
  'micromol', 'micromoles', 'mmol', 'mmoles', 'mol', 'moles', 'nmol', 'nmoles',
  'pmol', 'pmoles', 'mg', 'g', 'gramme', 'grammes', 'milligramme', 'milligrammes',
  'microgramme', 'microgrammes',
  'ug', 'kg', 'ml', 'dl', 'litre', 'litres', 'par', 'pour', 'pourcent', 'pourcentage',
  'unite', 'unites', 'ui', ':', '=', '-', ',', ';',
]);

/** Combien de mots de liaison consécutifs on tolère entre un nom et sa valeur. */
const MAX_LIAISON = 3;
/** Largeur maximale (en mots) d'un nom d'analyte recherché dans le catalogue. */
const MAX_MOTS_NOM = 4;

interface Jeton { texte: string; debut: number; fin: number; }

/** Découpe en mots (espaces = séparateurs), avec la position de chacun dans le texte source. */
function tokeniser(texte: string): Jeton[] {
  const jetons: Jeton[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(texte))) jetons.push({ texte: m[0], debut: m.index, fin: m.index + m[0].length });
  return jetons;
}

const RE_NOMBRE = /^\d+(?:[.,]\d+)?/;

function estNombre(tok: string): boolean {
  return RE_NOMBRE.test(tok);
}

function estMotVide(tok: string): boolean {
  return MOTS_VIDES.has(normalize(tok));
}

/** Nombre en tête d'un jeton (unité éventuellement collée derrière est ignorée). */
function extraireValeur(tok: string): { texte: string; valeur: number } | null {
  const m = tok.match(RE_NOMBRE);
  if (!m) return null;
  const brut = m[0];
  const valeur = parseFloat(brut.replace(',', '.'));
  if (isNaN(valeur)) return null;
  return { texte: brut, valeur };
}

/**
 * Plus longue fenêtre de mots non numériques, à partir de `i`, qui matche le
 * catalogue — testée du plus long au plus court pour privilégier les noms
 * composés (« vitesse de sédimentation ») sur un mot isolé.
 *
 * La fenêtre s'arrête AVANT tout mot qui, pris seul, commence à son tour un
 * autre analyte reconnu : sans ce garde-fou, un nom dicté sans valeur
 * (« CRP créatinine 90 » — la CRP oubliée) avalerait le nom suivant dans sa
 * propre fenêtre et la valeur 90 finirait attribuée à la CRP au lieu de la
 * créatinine.
 */
function fenetreNom(jetons: Jeton[], i: number, n: number): { longueur: number; entree: CatalogEntry } | null {
  let maxNonNum = 0;
  while (i + maxNonNum < n && maxNonNum < MAX_MOTS_NOM) {
    const tok = jetons[i + maxNonNum].texte;
    if (estNombre(tok)) break;
    if (maxNonNum > 0 && matchCatalog(tok)) break;
    maxNonNum++;
  }
  for (let L = maxNonNum; L >= 1; L--) {
    const phrase = jetons.slice(i, i + L).map(t => t.texte).join(' ');
    const entree = matchCatalog(phrase);
    if (entree) return { longueur: L, entree };
  }
  return null;
}

/** Avale jusqu'à MAX_LIAISON mots de liaison/unité à partir de `i`, retourne le nouvel index. */
function sauterLiaison(jetons: Jeton[], i: number, n: number): number {
  let j = i, k = 0;
  while (j < n && k < MAX_LIAISON && estMotVide(jetons[j].texte)) { j++; k++; }
  return j;
}

// ── Date dictée après une valeur (« le 28/06/2026 », « le 28 06 2026 »,
// « le 28 juin 2026 ») ────────────────────────────────────────────
//
// Dragon colle souvent de la ponctuation en fin de mot (« 2026, »), d'où le
// nettoyage systématique avant tout test numérique/alphabétique.
function depouiller(tok: string): string {
  return tok.replace(/[.,;:]+$/, '');
}

interface DateTrouvee { iso: string; finIdx: number; }

/**
 * Tente de lire une date à partir du jeton `p` (juste après le mot « le »),
 * sous l'une des trois formes que Dragon produit : un jeton déjà complet
 * (« 28/06/2026 »), trois jetons numériques séparés par des espaces
 * (« 28 06 2026 ») ou jour + mois en lettres + année (« 28 juin 2026 »).
 * Retourne `null` sans rien consommer si la forme ne matche pas — c'est ce
 * qui garantit qu'un « le » qui n'introduit pas de date (« par le litre »)
 * ne casse rien : l'appelant continue simplement sa recherche plus loin.
 */
function essaieDateApres(jetons: Jeton[], p: number, n: number): DateTrouvee | null {
  if (p >= n) return null;

  // Un seul jeton déjà séparé par / - . (ex. « 28/06/2026 »).
  const direct = parseDate(depouiller(jetons[p].texte));
  if (direct) return { iso: direct, finIdx: p };

  if (p + 2 < n) {
    const a = depouiller(jetons[p].texte);
    const b = depouiller(jetons[p + 1].texte);
    const c = depouiller(jetons[p + 2].texte);

    // Trois jetons numériques séparés par des espaces (« 28 06 2026 »).
    if (/^\d{1,2}$/.test(a) && /^\d{1,2}$/.test(b) && /^\d{2,4}$/.test(c)) {
      const iso = parseDate(`${a}/${b}/${c}`);
      if (iso) return { iso, finIdx: p + 2 };
    }

    // Jour + mois en lettres + année (« 28 juin 2026 »).
    if (/^\d{1,2}$/.test(a) && /^[A-Za-zÀ-ÿ]{3,10}$/.test(b) && /^\d{2,4}$/.test(c)) {
      const iso = parseDateSouple(`${a} ${b} ${c}`);
      if (iso) return { iso, finIdx: p + 2 };
    }
  }

  return null;
}

/** Combien de mots de liaison/unité on tolère avant de trouver (ou pas) le « le » d'une date. */
const MAX_MOTS_AVANT_DATE = 10;

/**
 * Cherche une date dictée à partir de la position `depart` (juste après une
 * valeur). Ne s'aventure qu'à travers des mots de liaison/unité déjà connus
 * (« unités », « par », « le », « litre »…) : dès qu'un mot qui n'en est pas
 * un apparaît, on arrête — ça ne peut être qu'un nouveau nom d'analyte ou du
 * texte de contexte, jamais une date. Une date encore en train de s'écrire
 * (touche le dernier mot ouvert du texte) n'est jamais retenue : elle
 * réapparaîtra, complète, à la frappe suivante — même logique que pour une
 * valeur en cours de dictée.
 */
function essaieDateLocale(jetons: Jeton[], depart: number, n: number, idxOuvert: number): DateTrouvee | null {
  let k = depart, vus = 0;
  while (k < n && vus < MAX_MOTS_AVANT_DATE) {
    const tok = jetons[k].texte;
    if (normalize(depouiller(tok)) === 'le') {
      const hit = essaieDateApres(jetons, k + 1, n);
      if (hit && hit.finIdx !== idxOuvert) return hit;
    } else if (!estMotVide(depouiller(tok))) {
      // Un mot de liaison/unité peut porter une virgule collée (« litre, »),
      // fréquente en dictée : elle ne doit pas faire échouer la recherche.
      return null;
    }
    if (k === idxOuvert) return null; // dernier mot du texte, encore ouvert : rien de plus à tenter
    k++; vus++;
  }
  return null;
}

/**
 * Analyse le texte dicté et en extrait les paires analyte → valeur.
 *
 * Conçu pour être rappelé à CHAQUE frappe (aucun bouton « Analyser ») : le
 * résultat doit rester cohérent d'un appel à l'autre, y compris pendant que
 * le dernier mot du texte est encore en train de s'écrire.
 */
export function parseDicteeBio(texte: string): ResultatDictee {
  const jetons = tokeniser(texte ?? '');
  const n = jetons.length;
  if (!n) return { reconnus: [], inconnus: [] };

  // Le dernier mot du texte est « ouvert » (peut encore s'allonger à la
  // prochaine frappe) tant qu'aucun caractère de coupure (espace, saut de
  // ligne) n'a été tapé après lui.
  const ouvert = !/\s$/.test(texte);
  const idxOuvert = ouvert ? n - 1 : -1;

  const reconnus = new Map<string, ItemDicte>();
  const inconnus = new Map<string, ItemDicte>();

  let i = 0;
  while (i < n) {
    const tok = jetons[i].texte;
    if (estNombre(tok)) { i++; continue; }         // valeur sans nom : ignorée
    if (estMotVide(tok)) { i++; continue; }         // liaison/unité isolée : ignorée

    const m = fenetreNom(jetons, i, n);
    if (m) {
      const debutNom = jetons[i].debut;
      const finNomIdx = i + m.longueur - 1;
      let j = sauterLiaison(jetons, i + m.longueur, n);
      if (j < n && estNombre(jetons[j].texte)) {
        const v = extraireValeur(jetons[j].texte)!;
        const dateHit = essaieDateLocale(jetons, j + 1, n, idxOuvert);
        const item: ItemDicte = {
          nom: m.entree.name, catalogue: m.entree, valeurTexte: v.texte, valeur: v.valeur,
          date: dateHit?.iso ?? null,
          complet: j !== idxOuvert, debut: debutNom, fin: dateHit ? jetons[dateHit.finIdx].fin : jetons[j].fin,
        };
        reconnus.set(normalize(m.entree.name), item);
        i = (dateHit?.finIdx ?? j) + 1;
      } else {
        const item: ItemDicte = {
          nom: m.entree.name, catalogue: m.entree, valeurTexte: '', valeur: null, date: null,
          complet: finNomIdx !== idxOuvert, debut: debutNom, fin: jetons[finNomIdx].fin,
        };
        reconnus.set(normalize(m.entree.name), item);
        i = i + m.longueur;
      }
      continue;
    }

    // Aucun nom reconnu à cette position : on regroupe les mots qui suivent,
    // au minimum nécessaire — on s'arrête dès qu'un nombre apparaît OU
    // qu'un mot, pris seul, amorce un autre analyte reconnu (même raison que
    // dans `fenetreNom` : ne pas avaler le début du nom suivant).
    let runEnd = i;
    while (runEnd - i + 1 < MAX_MOTS_NOM) {
      const suivant = runEnd + 1;
      if (suivant >= n) break;
      const t = jetons[suivant].texte;
      if (estNombre(t) || estMotVide(t) || fenetreNom(jetons, suivant, n)) break;
      runEnd = suivant;
    }
    let j = sauterLiaison(jetons, runEnd + 1, n);
    if (j < n && estNombre(jetons[j].texte)) {
      const v = extraireValeur(jetons[j].texte)!;
      const nomTexte = jetons.slice(i, runEnd + 1).map(t => t.texte).join(' ');
      const dateHit = essaieDateLocale(jetons, j + 1, n, idxOuvert);
      const item: ItemDicte = {
        nom: nomTexte, catalogue: null, valeurTexte: v.texte, valeur: v.valeur,
        date: dateHit?.iso ?? null,
        complet: j !== idxOuvert, debut: jetons[i].debut, fin: dateHit ? jetons[dateHit.finIdx].fin : jetons[j].fin,
      };
      inconnus.set(normalize(nomTexte), item);
      i = (dateHit?.finIdx ?? j) + 1;
    } else {
      // Pas de valeur trouvée. On ne signale une bribe SANS valeur que si
      // elle est encore en train de s'écrire (le dernier mot du texte) —
      // sinon n'importe quelle phrase de contexte (« biologie du jour »)
      // deviendrait un faux « analyte non reconnu » permanent.
      if (runEnd === idxOuvert) {
        const nomTexte = jetons.slice(i, runEnd + 1).map(t => t.texte).join(' ');
        const item: ItemDicte = {
          nom: nomTexte, catalogue: null, valeurTexte: '', valeur: null, date: null,
          complet: false, debut: jetons[i].debut, fin: jetons[runEnd].fin,
        };
        inconnus.set(normalize(nomTexte), item);
      }
      i = runEnd + 1;
    }
  }

  return { reconnus: [...reconnus.values()], inconnus: [...inconnus.values()] };
}
