// ──────────────────────────────────────────────────────────────
// Parseur de compte-rendu clinique (« carré bleu ») → traitements.
// Extraction heuristique des lignes thérapeutiques : médicaments datés,
// doses, arrêts (→ fin de barre), décroissances. Destiné à un aperçu
// validé par le médecin (jamais d'ajout en aveugle).
// ──────────────────────────────────────────────────────────────

export interface ExtractedTreatment {
  name: string;
  dose: string;
  date: string | null;   // ISO 'YYYY-MM-DD'
  rawDate: string;       // texte d'origine (ex. « Août 2022 »)
  kind: 'continuous' | 'event';
  isStop: boolean;       // « arrêt … » → marque une fin
  taper: boolean;        // « décroissance »
  raw: string;
}

const MONTHS: Record<string, string> = {
  janvier: '01', jan: '01',
  fevrier: '02', février: '02', fev: '02', févr: '02',
  mars: '03',
  avril: '04', avr: '04',
  mai: '05',
  juin: '06',
  juillet: '07', juil: '07',
  aout: '08', août: '08',
  septembre: '09', sept: '09',
  octobre: '10', oct: '10',
  novembre: '11', nov: '11',
  decembre: '12', décembre: '12', déc: '12', dec: '12',
};

function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function pad(n: number): string { return String(n).padStart(2, '0'); }

function addMonthsISO(iso: string, m: number): string {
  const [y, mo, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, mo - 1 + m, d));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

interface DateHit { index: number; iso: string | null; raw: string; relative?: number; }

/** Repère toutes les dates du texte avec leur position. */
function findDates(text: string): DateHit[] {
  const hits: DateHit[] = [];
  const monthAlt = Object.keys(MONTHS).join('|');
  const fullRanges: [number, number][] = []; // plages des JJ/MM/AAAA déjà captées

  // 1) JJ/MM/AAAA
  for (const m of text.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g)) {
    const d = +m[1], mo = +m[2], y = +m[3];
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      hits.push({ index: m.index!, iso: `${y}-${pad(mo)}-${pad(d)}`, raw: m[0] });
      fullRanges.push([m.index!, m.index! + m[0].length]);
    }
  }
  // 2) MM/AAAA — mais pas le « MM/AAAA » contenu dans un JJ/MM/AAAA déjà capté,
  //    sinon il masquerait le jour (index plus tardif → priorité indue).
  for (const m of text.matchAll(/\b(\d{1,2})\/(\d{4})\b/g)) {
    const idx = m.index!;
    if (fullRanges.some(([a, b]) => idx >= a && idx < b)) continue;
    const mo = +m[1], y = +m[2];
    if (mo >= 1 && mo <= 12) hits.push({ index: idx, iso: `${y}-${pad(mo)}-01`, raw: m[0] });
  }
  // 3) Mois AAAA (avec ou sans « Mn (…) » autour, capté séparément)
  const monthRe = new RegExp(`\\b(${monthAlt})\\.?\\s+(\\d{4})\\b`, 'gi');
  for (const m of text.matchAll(monthRe)) {
    const mo = MONTHS[norm(m[1])];
    if (mo) hits.push({ index: m.index!, iso: `${m[2]}-${mo}-01`, raw: m[0] });
  }
  // 4) Mn seul (relatif) — résolu plus tard via une date de référence
  for (const m of text.matchAll(/\bM(\d{1,2})\b/g)) {
    // Ignore si suivi immédiatement d'une parenthèse datée (déjà capté en 3)
    hits.push({ index: m.index!, iso: null, raw: m[0], relative: +m[1] });
  }

  hits.sort((a, b) => a.index - b.index);

  // Résolution des Mn relatifs : base = 1re date absolue rencontrée
  const base = hits.find(h => h.iso)?.iso ?? null;
  for (const h of hits) {
    if (h.iso == null && h.relative != null && base) {
      h.iso = addMonthsISO(base, h.relative);
    }
  }
  return hits;
}

// Médicaments fréquents en médecine interne (marque ou DCI). La casse est
// ignorée ; sert de liste blanche prioritaire.
// Revue volontairement resserrée à la médecine interne (maladies systémiques,
// auto-immunes, vascularites) — rien à retirer ici : chaque entrée avait déjà
// sa place. Seul TACROLIMUS, dupliqué, a été dédoublonné. Les molécules plus
// récentes (biothérapies) ajoutées à `SEED_DRUGS` (seed.ts) sont reconnues
// ici aussi sans duplication : `ImportTab` fusionne `getKnownDrugs()` (qui
// inclut `SEED_DRUGS`) dans `extraDrugs` à chaque appel de `parseReport`.
const DRUGS = [
  'SOLUMEDROL', 'SMD', 'MEDROL', 'CORTANCYL', 'PREDNISONE', 'PREDNISOLONE', 'CORTICOTHERAPIE',
  'CELLCEPT', 'MYCOPHENOLATE', 'MYFORTIC', 'PROGRAF', 'TACROLIMUS', 'ADVAGRAF',
  'ENDOXAN', 'CYCLOPHOSPHAMIDE', 'RITUXIMAB', 'MABTHERA', 'IMUREL', 'AZATHIOPRINE',
  'METHOTREXATE', 'MTX', 'PLAQUENIL', 'HYDROXYCHLOROQUINE', 'NINTEDANIB', 'OFEV',
  'PIRFENIDONE', 'ESBRIET', 'TOCILIZUMAB', 'ROACTEMRA', 'ABATACEPT', 'ORENCIA',
  'BELIMUMAB', 'BENLYSTA', 'INFLIXIMAB', 'ADALIMUMAB', 'HUMIRA', 'ETANERCEPT',
  'CICLOSPORINE', 'IGIV', 'IMMUNOGLOBULINES', 'PRIVIGEN', 'TEGELINE',
  'COLCHICINE', 'ANAKINRA', 'KINERET', 'CTC',
];
const DRUG_SET = new Set(DRUGS.map(norm));

// Acronymes à NE PAS confondre avec des médicaments.
const BLACKLIST = new Set([
  'efr', 'tdm', 'dlco', 'vems', 'cvf', 'cpt', 'ett', 'htp', 'pins', 'sars', 'cov', 'cov2',
  'vhb', 'vhc', 'vih', 'nk', 'iga', 'igg', 'igm', 'ige', 'cd', 'crp', 'vs', 'asia', 'avc',
  'iv', 'im', 'sc', 'atcd', 'ide', 'tec', 'ph', 'bau', 'tb', 'g', 'l', 'ml',
]);

const DOSE_RE = /\d+(?:[.,]\d+)?\s?(?:mg\/kg\/j(?:our)?|mg\/kg|mg\/m[²2]|g\/kg|mg\/jour|mg\/j|g\/jour|g\/j|mg|µg|ug|g|ui|u\/ml)\b(?:\s?(?:matin et soir|matin|soir|x\s?\d+|par\s+(?:jour|semaine|mois)|\/\s?(?:j|sem|semaine|mois)))?/i;

function findDose(segment: string): string {
  const m = segment.match(DOSE_RE);
  return m ? m[0].replace(/\s+/g, ' ').trim() : '';
}

/** Extrait les traitements datés d'un compte-rendu clinique.
 *  `extraDrugs` : médicaments appris des imports précédents. */
export function parseReport(text: string, extraDrugs: string[] = []): ExtractedTreatment[] {
  if (!text || !text.trim()) return [];
  const drugSet = new Set(DRUG_SET);
  for (const d of extraDrugs) drugSet.add(norm(d));

  const clean = text.replace(/\r/g, '');
  const dates = findDates(clean);

  const dateBefore = (idx: number): DateHit | null => {
    let best: DateHit | null = null;
    for (const d of dates) {
      if (d.index <= idx) best = d;
      else break;
    }
    return best;
  };

  const out: ExtractedTreatment[] = [];
  const seen = new Set<string>();

  // Parcours des tokens en majuscules OU mots du dictionnaire.
  const tokenRe = /[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\-]{2,}/g;
  for (const m of clean.matchAll(tokenRe)) {
    const tok = m[0];
    const n = norm(tok);
    const isDict = drugSet.has(n);
    const isCaps = /^[A-ZÀ-Ý][A-ZÀ-Ý\-]{2,}$/.test(tok); // token en majuscules
    if (!isDict && !isCaps) continue;
    if (BLACKLIST.has(n)) continue;

    const idx = m.index!;
    // Contexte : 20 caractères avant, 45 après
    const before = clean.slice(Math.max(0, idx - 22), idx);
    const after = clean.slice(idx + tok.length, idx + tok.length + 46);
    // Le contexte utile pour qualifier CE médicament s'arrête à la fin de la
    // prescription précédente : sans cette coupure, le « bolus x3 » du produit
    // d'avant fait passer une corticothérapie continue pour un événement
    // (« SOLUMEDROL 1 g en bolus x3 puis CORTANCYL 60 mg/j »).
    const beforeUtile = before.split(/[\n;.]|\bpuis\b/).pop() ?? '';
    const ctx = beforeUtile + tok + after;

    const dose = findDose(after);
    // Un token en MAJ non catalogué n'est retenu que s'il a une dose proche.
    if (!isDict && !dose) continue;

    const nctx = norm(ctx);
    const nbefore = norm(before);
    const isStop = /\barr[e]t\b/.test(nbefore) || /\bstop\b/.test(nbefore);
    const taper = /\b(decroissance|degression|decroissant)/.test(norm(after));
    const kind: 'continuous' | 'event' =
      /\b(bolus|cure|cures|perfusion|perfusions|x\s?\d)\b/.test(nctx) ? 'event' : 'continuous';

    const dh = dateBefore(idx);
    const iso = dh?.iso ?? null;
    const key = `${n}|${iso}|${dose}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      name: tok,
      dose,
      date: iso,
      rawDate: dh?.raw ?? '',
      kind,
      isStop,
      taper,
      raw: ctx.replace(/\s+/g, ' ').trim(),
    });
  }

  return out;
}
