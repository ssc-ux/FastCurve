// ──────────────────────────────────────────────────────────────
// Dictionnaire d'apprentissage INTÉGRÉ à l'application (partagé).
// Livré avec l'app → bénéficie à TOUS les postes / utilisateurs.
// Enrichi manuellement à partir des exports des médecins (aucune donnée
// patient : uniquement des correspondances de vocabulaire).
// ──────────────────────────────────────────────────────────────

/** Nom d'analyte lu (normalisé, sans accents, minuscules) → correction. */
export const SEED_ANALYTE_ALIASES: Record<string, { name: string; unit: string }> = {
  // Exemples de corrections fréquentes (à compléter via les exports) :
  // 'creatinine': { name: 'Créatinine', unit: 'µmol/L' },
};

/** Médicaments supplémentaires reconnus (au-delà du dictionnaire du parseur). */
export const SEED_DRUGS: string[] = [
  'SOLUPRED', 'LEDERTREXATE', 'NOVATREX', 'ARAVA', 'LEFLUNOMIDE', 'SALAZOPYRINE',
  'SULFASALAZINE', 'COLCHIMAX', 'KINERET', 'ILARIS', 'CANAKINUMAB', 'JAKAVI',
  'RUXOLITINIB', 'XELJANZ', 'TOFACITINIB', 'RINVOQ', 'UPADACITINIB', 'OLUMIANT',
  'BARICITINIB', 'SIMPONI', 'GOLIMUMAB', 'CIMZIA', 'CERTOLIZUMAB', 'STELARA',
  'USTEKINUMAB', 'COSENTYX', 'SECUKINUMAB', 'SAPHNELO', 'ANIFROLUMAB', 'LUCENTIS',
  'VELCADE', 'BORTEZOMIB', 'DARZALEX', 'DARATUMUMAB', 'SANDIMMUN', 'NEORAL',
];

/** Nom lu (normalisé) → nom de médicament corrigé. */
export const SEED_DRUG_ALIASES: Record<string, string> = {};
