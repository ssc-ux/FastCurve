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
  { name: 'Hémoglobine', unit: 'g/dL', category: 'biologie', refLow: 12, refHigh: 16, aliases: ['hb', 'hgb', 'hemoglobine', 'hémoglo'] },
  { name: 'Hématocrite', unit: '%', category: 'biologie', refLow: 37, refHigh: 47, aliases: ['ht', 'hte', 'hct', 'hematocrite'] },
  { name: 'VGM', unit: 'fL', category: 'biologie', refLow: 80, refHigh: 100, aliases: ['vgm', 'volume globulaire moyen'] },
  { name: 'Leucocytes', unit: 'G/L', category: 'biologie', refLow: 4, refHigh: 10, aliases: ['leuco', 'gb', 'globules blancs', 'leucocytes'] },
  { name: 'PNN', unit: 'G/L', category: 'biologie', refLow: 1.5, refHigh: 7, aliases: ['pnn', 'polynucleaires neutrophiles', 'neutrophiles'] },
  { name: 'Lymphocytes', unit: 'G/L', category: 'biologie', refLow: 1, refHigh: 4, aliases: ['lympho', 'lymphocytes'] },
  { name: 'Éosinophiles', unit: 'G/L', category: 'biologie', refLow: 0, refHigh: 0.5, aliases: ['eosino', 'eosinophiles', 'peo'] },
  { name: 'Plaquettes', unit: 'G/L', category: 'biologie', refLow: 150, refHigh: 400, aliases: ['plaq', 'plt', 'thrombocytes', 'plaquettes'] },
  { name: 'Réticulocytes', unit: 'G/L', category: 'biologie', aliases: ['retic', 'reticulocytes'] },

  // ── Ionogramme / rein ──
  { name: 'Sodium', unit: 'mmol/L', category: 'biologie', refLow: 135, refHigh: 145, aliases: ['na', 'na+', 'natremie', 'sodium'] },
  { name: 'Potassium', unit: 'mmol/L', category: 'biologie', refLow: 3.5, refHigh: 5, aliases: ['k', 'k+', 'kaliemie', 'potassium'] },
  { name: 'Chlore', unit: 'mmol/L', category: 'biologie', refLow: 98, refHigh: 107, aliases: ['cl', 'cl-', 'chloremie', 'chlore', 'chlorure'] },
  { name: 'Bicarbonates', unit: 'mmol/L', category: 'biologie', refLow: 22, refHigh: 29, aliases: ['hco3', 'hco3-', 'bicar', 'bicarbonates', 'ra'] },
  { name: 'Calcium', unit: 'mmol/L', category: 'biologie', refLow: 2.2, refHigh: 2.6, aliases: ['ca', 'ca2+', 'calcemie', 'calcium'] },
  { name: 'Phosphore', unit: 'mmol/L', category: 'biologie', refLow: 0.8, refHigh: 1.45, aliases: ['phosph', 'phosphore', 'phosphoremie'] },
  { name: 'Magnésium', unit: 'mmol/L', category: 'biologie', refLow: 0.7, refHigh: 1.0, aliases: ['mg', 'mg2+', 'magnesium', 'magnesemie'] },
  { name: 'Urée', unit: 'mmol/L', category: 'biologie', refLow: 2.5, refHigh: 7.5, aliases: ['uree', 'urea'] },
  { name: 'Créatinine', unit: 'µmol/L', category: 'biologie', refLow: 60, refHigh: 110, aliases: ['creat', 'creatinine', 'creatininemie'] },
  { name: 'DFG (MDRD)', unit: 'mL/min', category: 'biologie', refLow: 90, aliases: ['dfg', 'debit de filtration', 'mdrd', 'ckd-epi', 'ckdepi', 'clairance'] },
  { name: 'Acide urique', unit: 'µmol/L', category: 'biologie', aliases: ['acide urique', 'uricemie', 'urate'] },

  // ── Inflammation ──
  { name: 'CRP', unit: 'mg/L', category: 'biologie', refLow: 0, refHigh: 5, aliases: ['crp', 'proteine c reactive', 'c reactive'] },
  { name: 'VS', unit: 'mm/h', category: 'biologie', aliases: ['vs', 'vitesse de sedimentation'] },
  { name: 'Procalcitonine', unit: 'µg/L', category: 'biologie', aliases: ['pct', 'procalcitonine'] },
  { name: 'Fibrinogène', unit: 'g/L', category: 'biologie', refLow: 2, refHigh: 4, aliases: ['fibrinogene', 'fibri'] },

  // ── Foie ──
  { name: 'ASAT', unit: 'UI/L', category: 'biologie', refLow: 0, refHigh: 40, aliases: ['asat', 'sgot', 'got', 'tgo'] },
  { name: 'ALAT', unit: 'UI/L', category: 'biologie', refLow: 0, refHigh: 40, aliases: ['alat', 'sgpt', 'gpt', 'tgp'] },
  { name: 'GGT', unit: 'UI/L', category: 'biologie', aliases: ['ggt', 'gamma gt', 'gamma-gt'] },
  { name: 'PAL', unit: 'UI/L', category: 'biologie', aliases: ['pal', 'phosphatases alcalines'] },
  { name: 'Bilirubine totale', unit: 'µmol/L', category: 'biologie', refLow: 0, refHigh: 17, aliases: ['bili', 'bilirubine', 'bilirubine totale'] },
  { name: 'Albumine', unit: 'g/L', category: 'biologie', refLow: 35, refHigh: 50, aliases: ['alb', 'albumine'] },
  { name: 'Protéines totales', unit: 'g/L', category: 'biologie', refLow: 60, refHigh: 80, aliases: ['prot tot', 'proteines totales', 'proteinemie'] },
  { name: 'TP', unit: '%', category: 'biologie', refLow: 70, refHigh: 100, aliases: ['tp', 'taux de prothrombine'] },
  { name: 'INR', unit: '', category: 'biologie', aliases: ['inr'] },

  // ── Cardio ──
  { name: 'Troponine', unit: 'ng/L', category: 'biologie', aliases: ['tropo', 'troponine', 'tnc', 'tnt'] },
  { name: 'NT-proBNP', unit: 'pg/mL', category: 'biologie', aliases: ['nt-probnp', 'nt probnp', 'ntprobnp'] },
  { name: 'BNP', unit: 'pg/mL', category: 'biologie', aliases: ['bnp'] },
  { name: 'CPK', unit: 'UI/L', category: 'biologie', aliases: ['cpk', 'ck', 'creatine kinase'] },

  // ── Métabolisme ──
  { name: 'Glycémie', unit: 'mmol/L', category: 'biologie', refLow: 3.9, refHigh: 5.5, aliases: ['glyc', 'glycemie', 'glucose'] },
  { name: 'HbA1c', unit: '%', category: 'biologie', refLow: 4, refHigh: 6, aliases: ['hba1c', 'hemoglobine glyquee'] },
  { name: 'Cholestérol total', unit: 'mmol/L', category: 'biologie', aliases: ['cholesterol', 'chol', 'cholesterol total'] },
  { name: 'LDL', unit: 'mmol/L', category: 'biologie', aliases: ['ldl', 'ldl-c'] },
  { name: 'HDL', unit: 'mmol/L', category: 'biologie', aliases: ['hdl', 'hdl-c'] },
  { name: 'Triglycérides', unit: 'mmol/L', category: 'biologie', aliases: ['tg', 'triglycerides', 'trigly'] },
  { name: 'TSH', unit: 'mUI/L', category: 'biologie', refLow: 0.4, refHigh: 4, aliases: ['tsh', 'thyreostimuline'] },
  { name: 'T4L', unit: 'pmol/L', category: 'biologie', aliases: ['t4l', 't4 libre', 'ft4'] },
  { name: 'Ferritine', unit: 'µg/L', category: 'biologie', aliases: ['ferrit', 'ferritine'] },
  { name: 'Vitamine D', unit: 'nmol/L', category: 'biologie', aliases: ['vit d', 'vitamine d', '25 oh', '25-oh'] },
  { name: 'Vitamine B12', unit: 'pmol/L', category: 'biologie', aliases: ['b12', 'vitamine b12', 'cobalamine'] },
  { name: 'Lactates', unit: 'mmol/L', category: 'biologie', aliases: ['lactate', 'lactates'] },

  // ── Gaz du sang ──
  { name: 'pH', unit: '', category: 'biologie', refLow: 7.35, refHigh: 7.45, aliases: ['ph'] },
  { name: 'PaO2', unit: 'mmHg', category: 'biologie', aliases: ['pao2', 'po2'] },
  { name: 'PaCO2', unit: 'mmHg', category: 'biologie', aliases: ['paco2', 'pco2'] },
  { name: 'SaO2', unit: '%', category: 'biologie', aliases: ['sao2', 'saturation'] },

  // ── Immunologie ──
  { name: 'IgG', unit: 'g/L', category: 'immunologie', refLow: 7, refHigh: 16, aliases: ['igg', 'immunoglobulines g'] },
  { name: 'IgA', unit: 'g/L', category: 'immunologie', refLow: 0.7, refHigh: 4, aliases: ['iga'] },
  { name: 'IgM', unit: 'g/L', category: 'immunologie', refLow: 0.4, refHigh: 2.3, aliases: ['igm'] },
  { name: 'IgE totales', unit: 'kUI/L', category: 'immunologie', aliases: ['ige', 'ige totales'] },
  { name: 'C3', unit: 'g/L', category: 'immunologie', refLow: 0.9, refHigh: 1.8, aliases: ['c3', 'complement c3'] },
  { name: 'C4', unit: 'g/L', category: 'immunologie', refLow: 0.1, refHigh: 0.4, aliases: ['c4', 'complement c4'] },
  { name: 'CH50', unit: 'U/mL', category: 'immunologie', aliases: ['ch50'] },
  { name: 'Anticorps anti-DNA', unit: 'UI/mL', category: 'immunologie', aliases: ['anti-dna', 'anti dna', 'ac anti-adn', 'anti-adn'] },
  { name: 'Anticorps anti-MPO', unit: 'UI/mL', category: 'immunologie', aliases: ['anti-mpo', 'mpo', 'p-anca'] },
  { name: 'Anticorps anti-PR3', unit: 'UI/mL', category: 'immunologie', aliases: ['anti-pr3', 'pr3', 'c-anca'] },

  // ── EFR (spirométrie / DLCO) ──
  { name: 'VEMS', unit: 'L', category: 'efr', aliases: ['vems', 'fev1'] },
  { name: 'CVF', unit: 'L', category: 'efr', aliases: ['cvf', 'fvc', 'capacite vitale forcee'] },
  { name: 'VEMS/CVF', unit: '%', category: 'efr', aliases: ['vems/cvf', 'tiffeneau', 'fev1/fvc', 'rapport'] },
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

/** Retrouve une entrée du catalogue à partir d'un nom/alias approximatif. */
export function matchCatalog(rawName: string): CatalogEntry | null {
  const n = normalize(rawName);
  if (!n) return null;
  for (const l of CATALOG_LOOKUP) {
    if (n === l.pattern) return l.entry;
  }
  for (const l of CATALOG_LOOKUP) {
    if (l.pattern.length >= 3 && (n.includes(l.pattern) || l.pattern.includes(n))) return l.entry;
  }
  return null;
}

export { normalize };
