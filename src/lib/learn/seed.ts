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

/**
 * Médicaments supplémentaires reconnus (au-delà du dictionnaire du parseur,
 * `DRUGS` dans `reportParser.ts`) : alimente l'autocomplétion de l'onglet
 * Repères (`getKnownDrugs()` dans `memory.ts`) ET, par ce même mécanisme,
 * la reconnaissance dans un compte-rendu collé (`ImportTab` passe
 * `getKnownDrugs()` à `parseReport` en `extraDrugs`).
 *
 * Périmètre volontairement resserré à la médecine interne : maladies
 * systémiques, auto-immunes, inflammatoires, vascularites, et leurs
 * traitements usuels. Un médicament de cardiologie/oncologie pure/psychiatrie
 * sans lien avec ce champ a été retiré (LUCENTIS — anti-VEGF intravitréen,
 * exclusivement ophtalmologique, aucune indication de médecine interne).
 * À l'inverse, en cas de doute on garde : un médicament suggéré en trop est
 * sans conséquence, un médicament manquant oblige à taper le nom à la main.
 *
 * VELCADE/BORTEZOMIB et DARZALEX/DARATUMUMAB sont conservés en connaissance
 * de cause : ce sont des molécules d'hémato-oncologie (myélome), mais toutes
 * deux ont une indication validée dans l'amylose AL (protocoles à base de
 * bortézomib, daratumumab-VCd) — une maladie systémique suivie en médecine
 * interne même quand la chimiothérapie est prescrite par l'hématologie.
 */
export const SEED_DRUGS: string[] = [
  // ── Corticoïdes ──
  'CORTANCYL', 'SOLUPRED', 'PREDNISONE', 'PREDNISOLONE', 'SOLUMEDROL', 'MEDROL',

  // ── Immunosuppresseurs conventionnels ──
  'LEDERTREXATE', 'NOVATREX', 'METHOTREXATE', 'ARAVA', 'LEFLUNOMIDE',
  'SALAZOPYRINE', 'SULFASALAZINE', 'IMUREL', 'AZATHIOPRINE', 'CELLCEPT',
  'MYCOPHENOLATE', 'MYFORTIC', 'ENDOXAN', 'CYCLOPHOSPHAMIDE', 'SANDIMMUN',
  'NEORAL', 'CICLOSPORINE', 'PROGRAF', 'ADVAGRAF', 'TACROLIMUS', 'PLAQUENIL',
  'HYDROXYCHLOROQUINE', 'COLCHICINE', 'COLCHIMAX',

  // ── Biothérapies (anti-cytokines et apparentées) ──
  'KINERET', 'ANAKINRA', 'ILARIS', 'CANAKINUMAB', 'TOCILIZUMAB', 'ROACTEMRA',
  'SARILUMAB', 'KEVZARA', 'ABATACEPT', 'ORENCIA', 'BELIMUMAB', 'BENLYSTA',
  'RITUXIMAB', 'MABTHERA', 'INFLIXIMAB', 'REMICADE', 'ADALIMUMAB', 'HUMIRA',
  'ETANERCEPT', 'ENBREL', 'SIMPONI', 'GOLIMUMAB', 'CIMZIA', 'CERTOLIZUMAB',
  'STELARA', 'USTEKINUMAB', 'COSENTYX', 'SECUKINUMAB', 'SAPHNELO', 'ANIFROLUMAB',
  'MEPOLIZUMAB', 'NUCALA', 'AVACOPAN', 'TAVNEOS', 'ECULIZUMAB', 'SOLIRIS',
  'RAVULIZUMAB', 'ULTOMIRIS',

  // ── Inhibiteurs de JAK ──
  'JAKAVI', 'RUXOLITINIB', 'XELJANZ', 'TOFACITINIB', 'RINVOQ', 'UPADACITINIB',
  'OLUMIANT', 'BARICITINIB',

  // ── Antifibrosants (pneumopathie interstitielle des connectivites) ──
  'NINTEDANIB', 'OFEV', 'PIRFENIDONE', 'ESBRIET',

  // ── Immunoglobulines polyvalentes ──
  'IGIV', 'IMMUNOGLOBULINES', 'PRIVIGEN', 'TEGELINE',

  // ── Interface hémato-oncologie / amylose AL (voir note ci-dessus) ──
  'VELCADE', 'BORTEZOMIB', 'DARZALEX', 'DARATUMUMAB',
];

/** Nom lu (normalisé) → nom de médicament corrigé. */
export const SEED_DRUG_ALIASES: Record<string, string> = {};
