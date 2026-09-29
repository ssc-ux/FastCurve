import type { ParamCategory } from './types';

// ──────────────────────────────────────────────────────────────
// Catalogue de paramètres pré-configurés (nom, unité, normes, alias)
// Les alias servent à la reconnaissance OCR / dictée.
// ──────────────────────────────────────────────────────────────

export interface CatalogEntry {
  name: string;
  unit: string;
  category: ParamCategory;
  refLow?: number;
  refHigh?: number;
  aliases: string[];
}

export const CATALOG: CatalogEntry[] = [
  // ── Hématologie ──
  // Hémoglobine et hématocrite sont sexuées (femme ~12-16 g/dL / 37-47 %,
  // homme ~13-17 g/dL / 40-52 %). Le catalogue n'a qu'une borne : on prend
  // l'union des deux sexes plutôt qu'une valeur qui sous-signalerait un homme
  // normal ou sur-signalerait une femme normale.
  { name: 'Hémoglobine', unit: 'g/dL', category: 'biologie', aliases: ['hb', 'hgb', 'hemoglobine', 'hémoglo'] },
  { name: 'Hématocrite', unit: '%', category: 'biologie', aliases: ['ht', 'hte', 'hct', 'hematocrite'] },
  { name: 'VGM', unit: 'fL', category: 'biologie', aliases: ['vgm', 'volume globulaire moyen'] },
  { name: 'Leucocytes', unit: 'G/L', category: 'biologie', aliases: ['leuco', 'gb', 'globules blancs', 'leucocytes'] },
  { name: 'PNN', unit: 'G/L', category: 'biologie', aliases: ['pnn', 'polynucleaires neutrophiles', 'neutrophiles'] },
  { name: 'Lymphocytes', unit: 'G/L', category: 'biologie', aliases: ['lympho', 'lymphocytes'] },
  { name: 'Monocytes', unit: 'G/L', category: 'biologie', aliases: ['mono', 'monocytes'] },
  { name: 'Éosinophiles', unit: 'G/L', category: 'biologie', aliases: ['eosino', 'eosinophiles', 'pne'] },
  { name: 'Basophiles', unit: 'G/L', category: 'biologie', aliases: ['baso', 'basophiles', 'pnb'] },
  { name: 'Plaquettes', unit: 'G/L', category: 'biologie', aliases: ['plaq', 'plt', 'thrombocytes', 'plaquettes'] },
  // Compte absolu ; certains labos ne rendent que le % (hors norme alors non comparable).
  { name: 'Réticulocytes', unit: 'G/L', category: 'biologie', aliases: ['retic', 'reticulocytes'] },

  // ── Ionogramme / rein ──
  { name: 'Sodium', unit: 'mmol/L', category: 'biologie', aliases: ['na', 'na+', 'natremie', 'sodium'] },
  { name: 'Potassium', unit: 'mmol/L', category: 'biologie', aliases: ['k', 'k+', 'kaliemie', 'potassium'] },
  { name: 'Chlore', unit: 'mmol/L', category: 'biologie', aliases: ['cl', 'cl-', 'chloremie', 'chlore', 'chlorure'] },
  { name: 'Bicarbonates', unit: 'mmol/L', category: 'biologie', aliases: ['hco3', 'hco3-', 'bicar', 'bicarbonates', 'ra'] },
  { name: 'Calcium', unit: 'mmol/L', category: 'biologie', aliases: ['ca', 'ca2+', 'calcemie', 'calcium'] },
  { name: 'Phosphore', unit: 'mmol/L', category: 'biologie', aliases: ['phosph', 'phosphore', 'phosphoremie'] },
  { name: 'Magnésium', unit: 'mmol/L', category: 'biologie', aliases: ['mg', 'mg2+', 'magnesium', 'magnesemie'] },
  { name: 'Urée', unit: 'mmol/L', category: 'biologie', aliases: ['uree', 'urea'] },
  // Sexuée (femme ~45-84, homme ~64-104 µmol/L) : union des deux sexes, cf. Hb.
  // Unité choisie par le médecin lui-même (mg/L, pas µmol/L malgré l'usage SI
  // le plus répandu) : c'est ce que rend son laboratoire habituel. Bornes
  // reconverties depuis 45-115 µmol/L (masse molaire 113,12 g/mol), arrondies.
  { name: 'Créatinine', unit: 'mg/L', category: 'biologie', aliases: ['creat', 'creatinine', 'creatininemie'] },
  // Renommé MDRD → CKD-EPI : le MDRD est abandonné en pratique courante en
  // France depuis le début des années 2010, CKD-EPI est la formule rendue par
  // les laboratoires aujourd'hui. Alias 'mdrd' conservé pour les anciens CR.
  // Unité corrigée : le DFG estimé est rapporté à la surface corporelle
  // (mL/min/1,73 m²), jamais en mL/min brut (ça, c'est la clairance calculée).
  { name: 'DFG (CKD-EPI)', unit: 'mL/min/1.73m²', category: 'biologie', aliases: ['dfg', 'debit de filtration', 'mdrd', 'ckd-epi', 'ckdepi', 'clairance'] },
  // Sexuée (femme ~140-360, homme ~200-420 µmol/L) : union des deux sexes.
  { name: 'Acide urique', unit: 'µmol/L', category: 'biologie', aliases: ['acide urique', 'uricemie', 'urate'] },
  { name: 'Protéinurie des 24h', unit: 'g/24h', category: 'biologie', aliases: ['proteinurie', 'proteinurie 24h', 'proteinurie des 24h', 'proteinurie/24h'] },

  // ── Inflammation ──
  { name: 'CRP', unit: 'mg/L', category: 'biologie', aliases: ['crp', 'proteine c reactive', 'c reactive'] },
  // Pas de borne : la VS varie avec l'âge et le sexe (formule de Miller usuelle
  // : homme ≈ âge/2, femme ≈ (âge+10)/2). Une borne fixe serait fausse pour la
  // plupart des patients ; l'absence de borne est le choix honnête ici.
  { name: 'VS', unit: 'mm/h', category: 'biologie', aliases: ['vs', 'vitesse de sedimentation'] },
  // Pas de borne : la procalcitonine se lit par seuils DÉCISIONNELS selon le
  // contexte clinique (sepsis, désescalade antibiotique), pas par un intervalle
  // de référence populationnel unique.
  { name: 'Procalcitonine', unit: 'µg/L', category: 'biologie', aliases: ['pct', 'procalcitonine'] },
  { name: 'Fibrinogène', unit: 'g/L', category: 'biologie', aliases: ['fibrinogene', 'fibri'] },

  // ── Foie ──
  { name: 'ASAT', unit: 'UI/L', category: 'biologie', aliases: ['asat', 'sgot', 'got', 'tgo'] },
  { name: 'ALAT', unit: 'UI/L', category: 'biologie', aliases: ['alat', 'sgpt', 'gpt', 'tgp'] },
  // Pas de borne, volontairement : la GGT varie fortement d'un laboratoire à
  // l'autre (méthode) ET selon le sexe (homme jusqu'à ~55, femme jusqu'à ~38
  // UI/L), avec un écart bien plus grand qu'ASAT/ALAT. Une borne unique serait
  // trompeuse plus souvent qu'utile.
  { name: 'GGT', unit: 'UI/L', category: 'biologie', aliases: ['ggt', 'gamma gt', 'gamma-gt'] },
  { name: 'PAL', unit: 'UI/L', category: 'biologie', aliases: ['pal', 'phosphatases alcalines'] },
  { name: 'Bilirubine totale', unit: 'µmol/L', category: 'biologie', aliases: ['bili', 'bilirubine', 'bilirubine totale'] },
  { name: 'Bilirubine conjuguée', unit: 'µmol/L', category: 'biologie', aliases: ['bili conj', 'bilirubine conjuguee', 'bilirubine directe'] },
  { name: 'Albumine', unit: 'g/L', category: 'biologie', aliases: ['alb', 'albumine'] },
  { name: 'Protéines totales', unit: 'g/L', category: 'biologie', aliases: ['prot tot', 'proteines totales', 'proteinemie'] },
  { name: 'TP', unit: '%', category: 'biologie', aliases: ['tp', 'taux de prothrombine'] },
  { name: 'INR', unit: '', category: 'biologie', aliases: ['inr'] },

  // ── Cardio ──
  // Troponine, BNP, NT-proBNP : pas de borne, volontairement. Les seuils
  // dépendent entièrement du kit (99e percentile propre à chaque trousse
  // haute sensibilité, souvent sexué pour la troponine) — un chiffre unique
  // ici serait faux pour une bonne partie des dosages réels.
  { name: 'Troponine', unit: 'ng/L', category: 'biologie', aliases: ['tropo', 'troponine', 'tn', 'tni', 'tnt'] },
  { name: 'NT-proBNP', unit: 'pg/mL', category: 'biologie', aliases: ['nt-probnp', 'nt probnp', 'ntprobnp'] },
  { name: 'BNP', unit: 'pg/mL', category: 'biologie', aliases: ['bnp'] },
  // Pas de borne : très variable selon le sexe et la masse musculaire (et
  // l'origine ethnique, à valeur basale plus élevée chez les patients afro-
  // descendants) ; je n'ai pas de chiffre combiné fiable à proposer.
  { name: 'CPK', unit: 'UI/L', category: 'biologie', aliases: ['cpk', 'ck', 'creatine kinase'] },

  // ── Métabolisme ──
  // Glycémie à jeun normale : 0,70-1,10 g/L, soit 3,9-6,1 mmol/L (seuil
  // français usuel avant définition du diabète ≥ 7,0 mmol/L / 1,26 g/L).
  // L'ancienne borne haute (5,5) était trop basse : elle aurait signalé
  // « hors norme » une glycémie à jeun normale de 5,8 mmol/L.
  { name: 'Glycémie', unit: 'mmol/L', category: 'biologie', aliases: ['glyc', 'glycemie', 'glucose', 'gaj'] },
  { name: 'HbA1c', unit: '%', category: 'biologie', aliases: ['hba1c', 'hemoglobine glyquee', 'hemoglobine glycosylee'] },
  // Seuil « souhaitable » usuel (< 2 g/L), pas une borne basse : un cholestérol
  // total bas n'est pas en soi pathologique en pratique courante.
  { name: 'Cholestérol total', unit: 'mmol/L', category: 'biologie', aliases: ['cholesterol', 'chol', 'cholesterol total'] },
  // Pas de borne, volontairement : la cible LDL n'est pas une valeur normale
  // de population mais un objectif thérapeutique qui dépend du risque
  // cardiovasculaire du patient (recommandations ESC : de < 1,4 à < 3,0 mmol/L
  // selon le risque). Une borne unique romprait cette logique.
  { name: 'LDL', unit: 'mmol/L', category: 'biologie', aliases: ['ldl', 'ldl-c', 'cholesterol ldl'] },
  // Pas de borne, volontairement : le seuil « bas » est sexué (< 1,0 mmol/L
  // homme, < 1,3 mmol/L femme) et un HDL haut n'est pas pathologique — aucune
  // borne unique ne rend les deux sexes correctement.
  { name: 'HDL', unit: 'mmol/L', category: 'biologie', aliases: ['hdl', 'hdl-c', 'cholesterol hdl'] },
  { name: 'Triglycérides', unit: 'mmol/L', category: 'biologie', aliases: ['tg', 'triglycerides', 'trigly'] },
  { name: 'TSH', unit: 'mUI/L', category: 'biologie', aliases: ['tsh', 'thyreostimuline'] },
  { name: 'T4L', unit: 'pmol/L', category: 'biologie', aliases: ['t4l', 't4 libre', 'ft4'] },
  // Sexuée et large (femme ~15-150, homme ~30-300 µg/L) : union des deux
  // sexes. La fourchette combinée reste utile aux deux extrêmes (< 15 ou
  // > 300 restent anormaux quel que soit le sexe) mais perd en sensibilité
  // dans la zone intermédiaire — c'est le compromis assumé plutôt que
  // l'absence totale de repère.
  { name: 'Ferritine', unit: 'µg/L', category: 'biologie', aliases: ['ferrit', 'ferritine'] },
  // Seuil de suffisance (≥ 50 nmol/L = 20 ng/mL) ; pas de borne haute, la
  // toxicité ne s'envisage qu'à des valeurs bien plus hautes (> 250 nmol/L)
  // et rarement rencontrées en suivi courant.
  { name: 'Vitamine D', unit: 'nmol/L', category: 'biologie', aliases: ['vit d', 'vitamine d', 'vitamine d3', 'cholecalciferol', '25 oh', '25-oh'] },
  { name: 'Vitamine B12', unit: 'pmol/L', category: 'biologie', aliases: ['b12', 'vit b12', 'vitamine b12', 'cobalamine'] },
  { name: 'Lactates', unit: 'mmol/L', category: 'biologie', aliases: ['lactate', 'lactates', 'acide lactique'] },

  // ── Gaz du sang ──
  { name: 'pH', unit: '', category: 'biologie', aliases: ['ph'] },
  // Pas de borne, volontairement : la PaO2 baisse physiologiquement avec
  // l'âge (repère ≈ 100 - 0,3×âge mmHg) ; une borne fixe surinterpréterait un
  // sujet âgé normal.
  { name: 'PaO2', unit: 'mmHg', category: 'biologie', aliases: ['pao2', 'po2'] },
  { name: 'PaCO2', unit: 'mmHg', category: 'biologie', aliases: ['paco2', 'pco2'] },
  { name: 'SaO2', unit: '%', category: 'biologie', aliases: ['sao2', 'saturation'] },

  // ── Immunologie ──
  { name: 'IgG', unit: 'g/L', category: 'immunologie', aliases: ['igg', 'immunoglobulines g'] },
  { name: 'IgA', unit: 'g/L', category: 'immunologie', aliases: ['iga'] },
  { name: 'IgM', unit: 'g/L', category: 'immunologie', aliases: ['igm'] },
  // Pas de borne, volontairement : distribution très étalée dans la
  // population générale (atopie), fortement dépendante de l'âge.
  { name: 'IgE totales', unit: 'kUI/L', category: 'immunologie', aliases: ['ige', 'ige totales'] },
  { name: 'C3', unit: 'g/L', category: 'immunologie', aliases: ['c3', 'complement c3'] },
  { name: 'C4', unit: 'g/L', category: 'immunologie', aliases: ['c4', 'complement c4'] },
  // Pas de borne : méthode et unité non standardisées entre laboratoires.
  { name: 'CH50', unit: 'U/mL', category: 'immunologie', aliases: ['ch50'] },
  { name: 'Anticorps anti-DNA', unit: 'UI/mL', category: 'immunologie', aliases: ['anti-dna', 'anti dna', 'ac anti-adn', 'anti-adn', 'adn natif', 'anti-adn natif'] },
  { name: 'Anticorps anti-MPO', unit: 'UI/mL', category: 'immunologie', aliases: ['anti-mpo', 'mpo', 'p-anca'] },
  { name: 'Anticorps anti-PR3', unit: 'UI/mL', category: 'immunologie', aliases: ['anti-pr3', 'pr3', 'c-anca'] },
  // Pas de borne : seuil de positivité propre à chaque trousse.
  { name: 'Facteur rhumatoïde', unit: 'UI/mL', category: 'immunologie', aliases: ['facteur rhumatoide', 'fr'] },
  { name: 'Anticorps anti-CCP', unit: 'UI/mL', category: 'immunologie', aliases: ['anti-ccp', 'anti ccp', 'ccp', 'acpa'] },

  // ── EFR (spirométrie / DLCO) ──
  // VEMS, CVF, CPT, CV, VR, DLCO, KCO, DEP : pas de borne en valeur absolue,
  // volontairement. Ces volumes dépendent de la taille, de l'âge et du sexe du
  // patient (équations de référence, ex. GLI 2012) — seul le % de la théorique
  // (voir Parameter.display) a un sens en « normal / anormal ». Une borne
  // fixe en litres serait fausse pour presque tout le monde.
  { name: 'VEMS', unit: 'L', category: 'efr', aliases: ['vems', 'fev1'] },
  { name: 'CVF', unit: 'L', category: 'efr', aliases: ['cvf', 'fvc', 'capacite vitale forcee'] },
  // Seuil classique du rapport de Tiffeneau (GOLD, 70 %). Limite connue :
  // ce seuil fixe surdiagnostique l'obstruction chez le sujet âgé et la
  // sous-diagnostique chez le sujet jeune (la LIN théorique, dépendante de
  // l'âge, serait plus juste mais n'est pas calculable ici).
  { name: 'VEMS/CVF', unit: '%', category: 'efr', aliases: ['vems/cvf', 'tiffeneau', 'fev1/fvc'] },
  { name: 'CPT', unit: 'L', category: 'efr', aliases: ['cpt', 'tlc', 'capacite pulmonaire totale'] },
  { name: 'CV', unit: 'L', category: 'efr', aliases: ['cv', 'vc', 'capacite vitale'] },
  { name: 'VR', unit: 'L', category: 'efr', aliases: ['vr', 'rv', 'volume residuel'] },
  { name: 'DLCO', unit: 'mmol/min/kPa', category: 'efr', aliases: ['dlco', 'tlco', 'diffusion'] },
  { name: 'KCO', unit: 'mmol/min/kPa/L', category: 'efr', aliases: ['kco', 'dlco/va'] },
  { name: 'DEP', unit: 'L/min', category: 'efr', aliases: ['dep', 'pef', 'peak flow', 'debit de pointe'] },
];

/** Index normalisé alias → entrée, trié par longueur d'alias décroissante. */
function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

interface LookupEntry {
  pattern: string;
  entry: CatalogEntry;
}

export const CATALOG_LOOKUP: LookupEntry[] = (() => {
  const out: LookupEntry[] = [];
  for (const entry of CATALOG) {
    out.push({ pattern: normalize(entry.name), entry });
    for (const a of entry.aliases) out.push({ pattern: normalize(a), entry });
  }
  out.sort((a, b) => b.pattern.length - a.pattern.length);
  return out;
})();

function echapperRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Un alias apparaît-il comme un token entier dans le texte, et non comme le
 * simple préfixe d'un mot plus long ? Sans ce garde-fou, « igg » (alias
 * d'IgG) matcherait « IgG4 sérique » — une entité clinique différente
 * (maladie associée aux IgG4) que le médecin doit pouvoir saisir en texte
 * libre sans qu'elle soit siphonnée vers IgG (critère du cahier des
 * charges : un libellé absent du catalogue est accepté tel quel).
 * Un chiffre ou une lettre collée derrière l'alias casse le match ; un
 * espace, une ponctuation ou une unité ne le cassent pas (« Créatinine
 * umolL » doit continuer à matcher « créatinine »).
 */
function commeToken(pattern: string, texte: string): boolean {
  return new RegExp(`(?:^|[^a-z0-9])${echapperRegex(pattern)}(?:[^a-z0-9]|$)`).test(texte);
}

/** Retrouve une entrée du catalogue à partir d'un nom/alias approximatif. */
export function matchCatalog(rawName: string): CatalogEntry | null {
  const n = normalize(rawName);
  if (!n) return null;
  for (const l of CATALOG_LOOKUP) {
    if (n === l.pattern) return l.entry;
  }
  for (const l of CATALOG_LOOKUP) {
    if (l.pattern.length < 3) continue;
    if (commeToken(l.pattern, n) || l.pattern.includes(n)) return l.entry;
  }
  return null;
}

/** Correspondance EXACTE (nom ou alias normalisé), sans approximation. */
export function matchCatalogExact(rawName: string): CatalogEntry | null {
  const n = normalize(rawName);
  if (!n) return null;
  return CATALOG_LOOKUP.find(l => n === l.pattern)?.entry ?? null;
}

export { normalize };
