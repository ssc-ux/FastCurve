// ──────────────────────────────────────────────────────────────
// Les cinq erreurs du médecin, prises à la racine.
//
// Le banc (bench/) les mesure sur de vraies captures ; ici on verrouille la
// LOGIQUE qui les empêche, pour qu'une correction future ne les réintroduise
// pas en silence. Chaque bloc porte le numéro de l'erreur au cahier des
// charges.
// ──────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import {
  affecterRoles, estIntervalle, estUnite, lireDate, nettoyerNom, roleDepuisEntete,
  type ColonneCandidate,
} from './roles';
import { decimalePerdue, ordreDeGrandeurSuspect, reparerNombre } from './correction';
import { jugerDate, jugerNom, jugerValeur, type ContexteValeur } from './confiance';
import {
  blocPourColonne, blocsDeBande, ecartMaxInterne, ecarterBandesDecoratives, etendue,
  isolerTableau, plageEntete, retenirBlocEntete,
} from './pipeline';
import { seuilDeBruit, type CarteEncre } from './structure';

// ── Outils : fabriquer une carte d'encre à la main ──────────────

/** `lignes` : une chaîne par ligne de pixels, « # » = encre, « . » = fond. */
function carte(lignes: string[]): CarteEncre {
  const hauteur = lignes.length, largeur = lignes[0].length;
  const encre = new Uint8Array(largeur * hauteur);
  lignes.forEach((l, y) => {
    for (let x = 0; x < largeur; x++) encre[y * largeur + x] = l[x] === '#' ? 1 : 0;
  });
  return { largeur, hauteur, encre };
}

function gris(lignes: string[], fond = 250, encre = 20) {
  const hauteur = lignes.length, largeur = lignes[0].length;
  const v = new Float32Array(largeur * hauteur);
  lignes.forEach((l, y) => {
    for (let x = 0; x < largeur; x++) v[y * largeur + x] = l[x] === '#' ? encre : fond;
  });
  return { largeur, hauteur, v };
}

// ── Erreurs 1 & 2 : la colonne des normes n'est pas une colonne de résultats ──

describe('erreurs 1 et 2 — les bornes de normes ne deviennent jamais des résultats', () => {
  it('reconnaît un intervalle de référence sous toutes ses formes', () => {
    for (const t of ['59 - 104', '150 - 400', '2,0 - 4,0', '< 5', '> 75', '13 à 17', '[150-400]', '0.90-1.80']) {
      expect(estIntervalle(t), t).toBe(true);
    }
    // Une valeur de patient, elle, n'est pas un intervalle.
    for (const t of ['104', '12,2', '245', '0,95']) {
      expect(estIntervalle(t), t).toBe(false);
    }
    // « < 5 » est à la fois une norme et une valeur censurée : c'est pourquoi
    // le rôle d'une colonne se décide à la MAJORITÉ de son contenu, jamais sur
    // une cellule isolée.
    expect(estIntervalle('< 5')).toBe(true);
  });

  it('reconnaît la colonne des normes à son en-tête', () => {
    for (const e of ['Normes', 'Valeurs usuelles', 'Valeurs de reference', 'Réf.', 'VN', 'Intervalle']) {
      expect(roleDepuisEntete(e), e).toBe('normes');
    }
  });

  it('écarte la colonne des normes même sans en-tête lisible', () => {
    const colonnes: ColonneCandidate[] = [
      { index: 0, entete: 'Analyse', echantillon: ['Creatinine', 'Plaquettes', 'CRP'] },
      { index: 1, entete: '12/03/2024', echantillon: ['85', '245', '3'] },
      { index: 2, entete: '15/06/2024', echantillon: ['92', '198', '12'] },
      { index: 3, entete: 'Unite', echantillon: ['umol/L', 'G/L', 'mg/L'] },
      { index: 4, entete: '', echantillon: ['59 - 104', '150 - 400', '< 5'] },
    ];
    const roles = affecterRoles(colonnes, 2024);
    expect(roles[4].role).toBe('normes');
    expect(roles.filter(r => r.role === 'date').map(r => r.index)).toEqual([1, 2]);
  });

  it('n’invente jamais une colonne de résultats à partir des normes', () => {
    const roles = affecterRoles([
      { index: 0, entete: 'Analyte', echantillon: ['Creatinine'] },
      { index: 1, entete: 'Normes', echantillon: ['59 - 104'] },
    ]);
    expect(roles[1].role).toBe('normes');
    expect(roles.some(r => r.role === 'date')).toBe(false);
  });
});

// ── Erreur 3 : la virgule décimale ──────────────────────────────

describe('erreur 3 — 12,2 ne devient jamais 122', () => {
  it('rétablit la virgule que la reconnaissance a perdue', () => {
    const r = reparerNombre('122', { chiffresAvant: 2 });
    expect(r.texte).toBe('12.2');
    expect(r.separateurRetabli).toBe(true);
  });

  it('laisse tranquille un nombre déjà ponctué', () => {
    expect(reparerNombre('12,2', { chiffresAvant: 2 }).texte).toBe('12.2');
    expect(reparerNombre('12,2').separateurRetabli).toBe(false);
  });

  it('repère une décimale perdue d’après le reste de la ligne', () => {
    expect(decimalePerdue('122', ['7,4', '9,1'])).toBe(true);
    // Une vraie évolution clinique n'est pas une décimale perdue.
    expect(decimalePerdue('96', ['28', '7'])).toBe(false);
  });

  it('ne signale une virgule rétablie que si elle ne colle pas à la ligne', () => {
    const base: ContexteValeur = {
      texte: '12.2', confiance: 90, encre: 100, encreTypique: 100,
      separateurGeometrique: true, separateurRetabli: true, desaccordRelecture: false,
      nomAnalyte: 'Leucocytes', autresDeLaLigne: ['7.4', '9.1'],
    };
    // « 7,4 · 9,1 · 12,2 » : la virgule rétablie est corroborée par la ligne.
    expect(jugerValeur(base).douteux).toBe(false);
    // « 9,8 · 10,9 · 1,17 » : elle ne l'est pas — il faut regarder.
    expect(jugerValeur({
      ...base, texte: '1.17', nomAnalyte: 'Hémoglobine', autresDeLaLigne: ['9.8', '10.9'],
    }).douteux).toBe(true);
  });
});

// ── Erreur 4 : l'unité agglutinée au nom ────────────────────────

describe('erreur 4 — « Créatinine umolL » redevient « Créatinine »', () => {
  it('détache l’unité collée au nom', () => {
    expect(nettoyerNom('Créatinine umolL')).toBe('Créatinine');
    expect(nettoyerNom('Hemoglobine g/dL')).toBe('Hemoglobine');
    expect(nettoyerNom('Plaquettes (G/L)')).toBe('Plaquettes');
    expect(nettoyerNom('Leucocytes :')).toBe('Leucocytes');
  });

  it('ne mange pas un nom qui finit par un mot ordinaire', () => {
    expect(nettoyerNom('Bilirubine totale')).toBe('Bilirubine totale');
    expect(nettoyerNom('Anticorps anti-DNA')).toBe('Anticorps anti-DNA');
    expect(nettoyerNom('Vitamine D')).toBe('Vitamine D');
  });

  it('sait ce qu’est une unité, y compris agglutinée', () => {
    for (const u of ['umolL', 'µmol/L', 'g/dL', 'mg/L', 'G/L', 'UI/L', '%', 'fL']) {
      expect(estUnite(u), u).toBe(true);
    }
    expect(estUnite('Creatinine')).toBe(false);
  });
});

// ── Erreur 5 : les colonnes de dates ────────────────────────────

describe('erreur 5 — chaque colonne de dates de l’image en devient une', () => {
  it('lit une date sous ses formes courantes', () => {
    expect(lireDate('12/03/2025')?.iso).toBe('2025-03-12');
    expect(lireDate('12-03-2025')?.iso).toBe('2025-03-12');
    expect(lireDate('12/03/25')?.iso).toBe('2025-03-12');
  });

  it('recolle une date dont la barre oblique a été lue « 1 »', () => {
    // « 12/03 » écrit petit est très régulièrement rendu « 12103 ».
    const d = lireDate('12103', 2024);
    expect(d?.iso).toBe('2024-03-12');
    expect(d?.anneeDevinee).toBe(true);
  });

  it('refuse de fabriquer une date à partir de n’importe quel nombre', () => {
    expect(lireDate('12345', 2024)).toBeNull();   // mois 45
    expect(lireDate('2024', 2024)).toBeNull();    // jour 20, mois 24
    expect(lireDate('245', 2024)).toBeNull();
  });

  it('n’invente jamais l’année absente de l’image', () => {
    const d = lireDate('12/03');
    expect(d?.iso).toBeNull();
    expect(d?.anneeDevinee).toBe(true);
    expect(jugerDate(d ?? null, 100).douteux).toBe(true);
  });

  it('donne une colonne de résultats par en-tête daté', () => {
    const roles = affecterRoles([
      { index: 0, entete: 'Analyse', echantillon: ['Creatinine'] },
      { index: 1, entete: '12/03', echantillon: ['85'] },
      { index: 2, entete: '15/06', echantillon: ['92'] },
      { index: 3, entete: '20/09/24', echantillon: ['110'] },
      { index: 4, entete: 'Normes', echantillon: ['59 - 104'] },
    ], 2024);
    const dates = roles.filter(r => r.role === 'date');
    expect(dates).toHaveLength(3);
    expect(dates.map(d => d.date?.iso)).toEqual(['2024-03-12', '2024-06-15', '2024-09-20']);
  });
});

// ── Le jaune : doute de lecture, jamais anormalité clinique ─────

describe('le jaune ne signale que le doute de LECTURE', () => {
  const base: ContexteValeur = {
    texte: '', confiance: 92, encre: 100, encreTypique: 100,
    separateurGeometrique: false, separateurRetabli: false, desaccordRelecture: false,
    nomAnalyte: '', autresDeLaLigne: [],
  };

  it('laisse blanche une valeur pathologique bien lue', () => {
    // Les trois exemples du critère 34 du cahier des charges.
    expect(jugerValeur({ ...base, texte: '45', nomAnalyte: 'CRP' }).douteux).toBe(false);
    expect(jugerValeur({ ...base, texte: '300', nomAnalyte: 'Créatinine' }).douteux).toBe(false);
    expect(jugerValeur({ ...base, texte: '7', nomAnalyte: 'Hémoglobine' }).douteux).toBe(false);
    // Et la CRP normale du second essai, qui passait en violet « incohérent ».
    expect(jugerValeur({ ...base, texte: '3', nomAnalyte: 'CRP' }).douteux).toBe(false);
  });

  it('signale une lecture peu sûre', () => {
    expect(jugerValeur({ ...base, texte: '104', confiance: 40 }).douteux).toBe(true);
  });

  it('signale une case encrée dont rien n’a été lu', () => {
    expect(jugerValeur({ ...base, texte: '', encre: 90 }).douteux).toBe(true);
    // Une case réellement vide ne demande aucune vérification.
    expect(jugerValeur({ ...base, texte: '', encre: 0 }).douteux).toBe(false);
  });

  it('signale un signe présent dans l’encre mais absent du texte (« > 300 »)', () => {
    expect(jugerValeur({ ...base, texte: '300', glyphes: 4, caracteresLus: 3 }).douteux).toBe(true);
    expect(jugerValeur({ ...base, texte: '300', glyphes: 3, caracteresLus: 3 }).douteux).toBe(false);
  });

  it('signale un nom d’analyte que l’application ne reconnaît pas', () => {
    expect(jugerNom('Créatinine', 95).douteux).toBe(false);
    expect(jugerNom('19G', 95).douteux).toBe(true);
    expect(jugerNom('', 95).douteux).toBe(true);
  });

  it('ne confond jamais pathologie et aberration de lecture', () => {
    // Créatinine à 300 µmol/L : un malade, pas une erreur.
    expect(ordreDeGrandeurSuspect('Créatinine', 300)).toBe(false);
    // Créatinine à 12 000 : personne n'a jamais vu ça.
    expect(ordreDeGrandeurSuspect('Créatinine', 12000)).toBe(true);
  });
});

// ── La géométrie du tableau ─────────────────────────────────────

describe('structure — séparer le tableau du reste de la page', () => {
  it('distingue une ligne de tableau d’un titre', () => {
    // Une ligne de tableau a une gouttière large ; un titre n'a que des espaces.
    const c = carte([
      '##.##.##.##.##.##.##', // titre : espaces d'un pixel
      '###.............####', // ligne de tableau : gouttière de 13 pixels
    ]);
    expect(ecartMaxInterne(c, { y0: 0, y1: 0 })).toBe(1);
    expect(ecartMaxInterne(c, { y0: 1, y1: 1 })).toBe(13);
  });

  it('garde le tableau et jette le titre et le pied de page', () => {
    const lignes = [
      '##.##.###...........', // titre
      '....................',
      '###.............####', // en-tête
      '....................',
      '###.............####', // ligne 1
      '....................',
      '###.............####', // ligne 2
      '....................',
      '#.#.#.#.............', // pied de page
    ];
    const c = carte(lignes);
    const bandes = [0, 2, 4, 6, 8].map(y => ({ y0: y, y1: y }));
    const gardees = isolerTableau(c, bandes, 1);
    expect(gardees.map(b => b.y0)).toEqual([2, 4, 6]);
  });

  it('cale le seuil de bruit sur l’encre du tableau, pas sur un absolu', () => {
    // Profil : des lignes de texte à ~120 pixels, des interlignes à 3.
    const profil = new Int32Array([120, 130, 125, 3, 2, 118, 122, 3, 0, 128]);
    const seuil = seuilDeBruit(profil, 600);
    expect(seuil).toBeGreaterThan(3);
    expect(seuil).toBeLessThan(118);
  });

  it('donne à l’en-tête la place qui déborde sa colonne', () => {
    const colonnes = [{ x0: 10, x1: 40 }, { x0: 100, x1: 130 }, { x0: 200, x1: 230 }];
    const p = plageEntete(colonnes, 1, 300);
    expect(p.x0).toBe(70);   // mi-chemin entre 40 et 100
    expect(p.x1).toBe(165);  // mi-chemin entre 130 et 200
    expect(plageEntete(colonnes, 0, 300).x0).toBe(0);
    expect(plageEntete(colonnes, 2, 300).x1).toBe(299);
  });

  it('retrouve les en-têtes malgré un bandeau de couleur', () => {
    // Fond gris uniforme (200) avec du texte sombre : le seuillage binaire
    // prendrait tout le bandeau pour de l'encre, l'analyse en gris non.
    const g = gris(['####.......####.....####'], 200, 20);
    const blocs = blocsDeBande(g, { y0: 0, y1: 0 }, 6, { gauche: 0, droite: 23 });
    expect(blocs).toHaveLength(3);
    expect(blocs[0]).toEqual({ x0: 0, x1: 3 });
    expect(blocs[2]).toEqual({ x0: 20, x1: 23 });
  });

  it('rattache chaque bloc d’en-tête à la colonne qu’il surplombe', () => {
    const blocs = [{ x0: 0, x1: 12 }, { x0: 30, x1: 60 }, { x0: 80, x1: 110 }];
    expect(blocPourColonne(blocs, { x0: 45, x1: 60 }, 10)).toEqual({ x0: 30, x1: 60 });
    expect(blocPourColonne(blocs, { x0: 95, x1: 110 }, 10)).toEqual({ x0: 80, x1: 110 });
    expect(blocPourColonne([], { x0: 0, x1: 10 }, 10)).toBeNull();
  });
});

// ── Grilles denses : beaucoup de colonnes de dates, beaucoup de lignes ─
//
// Trois défaillances distinctes, chacune observée sur une vraie capture
// hospitalière dense (extranet CHRUL, fragment recadré) :
//  A. une rangée d'icônes (rappel, info, pièces jointes) intercalée sous
//     l'en-tête corrompt la découpe en colonnes si on la traite comme une
//     ligne de plus — `ecarterBandesDecoratives` l'écarte à sa hauteur ;
//  B. des en-têtes de dates denses qui se touchent fusionnent en un seul
//     bloc de texte — `retenirBlocEntete` plafonne ce bloc à la plage de sa
//     colonne, sans jamais rogner un en-tête simplement un peu large ;
//  C. une ligne de titre de section (« BIOCHIMIE (2 analyses) ») intercalée
//     entre des lignes de résultats n'a d'encre que sous la colonne des
//     noms — le test documente le calcul qui la distingue d'une ligne de
//     données réelle, même incomplète.
describe('grilles denses — trois défaillances de la vraie capture hospitalière', () => {
  it('écarte une bande décorative bien plus haute que les lignes de texte (rangée d’icônes)', () => {
    const hL = 9;
    const bandes = [
      { y0: 0, y1: 8 },     // en-tête (date) — jamais écartée, même haute
      { y0: 12, y1: 38 },   // rangée d'icônes : 27 px, 3x la hauteur de ligne
      { y0: 45, y1: 53 },   // ligne de données normale
      { y0: 60, y1: 68 },   // ligne de données normale
    ];
    const gardees = ecarterBandesDecoratives(bandes, hL);
    expect(gardees).toEqual([bandes[0], bandes[2], bandes[3]]);
  });

  it('ne touche jamais à l’en-tête (bande 0), même anormalement haute', () => {
    const hL = 9;
    const bandes = [
      { y0: 0, y1: 30 },  // en-tête haut (deux graisses de police, par ex.)
      { y0: 40, y1: 48 },
      { y0: 55, y1: 63 },
    ];
    expect(ecarterBandesDecoratives(bandes, hL)).toEqual(bandes);
  });

  it('garde toutes les bandes quand aucune n’est anormale', () => {
    const hL = 10;
    const bandes = [{ y0: 0, y1: 9 }, { y0: 15, y1: 24 }, { y0: 30, y1: 39 }];
    expect(ecarterBandesDecoratives(bandes, hL)).toEqual(bandes);
  });

  it('plafonne un bloc d’en-tête ÉNORME (en-têtes denses fusionnés) à la plage de sa colonne', () => {
    // Une ligne d'en-têtes entière (« 10/01/2023 14/02/2023 … Unite Normes »)
    // fusionnée par blocsDeBande en un seul bloc de 900 px, pour une colonne
    // de valeurs de 30 px et une plage de 60 px.
    const bloc = { x0: 10, x1: 910 };
    const col = { x0: 400, x1: 430 };
    const plage = { x0: 370, x1: 460 };
    expect(retenirBlocEntete(bloc, col, plage, 5)).toEqual({ x0: 370, x1: 460 });
  });

  it('garde tout le débordement d’un bloc d’en-tête simplement un peu plus large que sa colonne', () => {
    // Le cas courant et voulu : une date (« 15/01/2024 ») au-dessus d'un
    // nombre à trois chiffres. Le bloc déborde la colonne mais reste dans
    // l'ordre de grandeur de la plage — jamais plafonné.
    const bloc = { x0: 390, x1: 445 };
    const col = { x0: 400, x1: 430 };
    const plage = { x0: 370, x1: 460 };
    expect(retenirBlocEntete(bloc, col, plage, 5)).toEqual({ x0: 385, x1: 450 });
  });

  it('retombe sur la plage quand aucun bloc ne se rattache à la colonne', () => {
    const col = { x0: 400, x1: 430 };
    const plage = { x0: 370, x1: 460 };
    expect(retenirBlocEntete(null, col, plage, 5)).toEqual(plage);
  });

  it('distingue une ligne de titre de section (encre confinée à la colonne des noms) d’une ligne de données réelle', () => {
    // « BIOCHIMIE (2 analyses) » : rien sous les colonnes de dates.
    const carteTitre: CarteEncre = carte([
      '####..####........................',
    ]);
    // Une ligne de données réelle, même clairsemée (CPK n'a un résultat qu'à
    // deux dates sur cinq) : de l'encre APRÈS la colonne des noms.
    const carteDonnees: CarteEncre = carte([
      '####...........###..........###...',
    ]);
    const bande = { y0: 0, y1: 0 };
    const nomDroite = 8; // fin de la colonne des noms
    const margeTitre = 3;

    const eTitre = etendue(carteTitre, bande)!;
    const eDonnees = etendue(carteDonnees, bande)!;
    expect(eTitre.x1).toBeLessThanOrEqual(nomDroite + margeTitre);
    expect(eDonnees.x1).toBeGreaterThan(nomDroite + margeTitre);
  });
});

// ── Le jaune protège aussi contre une colonne mal ancrée ────────────────
describe('grilles denses — une colonne anormalement large est toujours signalée', () => {
  const base: ContexteValeur = {
    texte: '', confiance: 92, encre: 100, encreTypique: 100,
    separateurGeometrique: false, separateurRetabli: false, desaccordRelecture: false,
    nomAnalyte: 'Hemoglobine', autresDeLaLigne: [],
  };

  it('signale une valeur d’une colonne anormale même si elle a l’air parfaitement lue', () => {
    // Deux dates fondues en une donnent souvent un nombre propre et crédible
    // (« 9,6101 », deux valeurs recollées) — c'est le cas le plus trompeur,
    // et c'est justement celui-là qu'il faut signaler.
    expect(jugerValeur({ ...base, texte: '9.6101', colonneAnormale: true }).douteux).toBe(true);
  });

  it('ne signale rien de plus pour une colonne normale', () => {
    expect(jugerValeur({ ...base, texte: '9.6', colonneAnormale: false }).douteux).toBe(false);
  });

  it('signale aussi une case VIDE d’une colonne anormale (aucune valeur n’est fiable dans cette colonne)', () => {
    expect(jugerValeur({ ...base, texte: '', encre: 0, colonneAnormale: true }).douteux).toBe(true);
    expect(jugerValeur({ ...base, texte: '', encre: 0, colonneAnormale: false }).douteux).toBe(false);
  });
});
