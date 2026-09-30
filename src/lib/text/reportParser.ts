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
  /**
   * Ce que la ligne dit du traitement : début (instauration, reprise, relai
   * PAR), arrêt (arrêt, relai DU), changement de dose, événement ponctuel
   * (cure, bolus) ou traitement actuel (section « Traitement actuel »).
   */
  action: 'debut' | 'arret' | 'modif' | 'evenement' | 'actuel';
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
  // 3 bis) Année seule (« de 2003 à 2010 », « en 2015 ») — hors des dates
  //    déjà captées (JJ/MM/AAAA, MM/AAAA, Mois AAAA).
  for (const m of text.matchAll(/\b(19[5-9]\d|20\d{2})\b/g)) {
    const idx = m.index!;
    if (hits.some(h => idx >= h.index && idx < h.index + h.raw.length)) continue;
    hits.push({ index: idx, iso: `${m[1]}-01-01`, raw: m[0] });
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
  // Hématologie / PTI, vasculaire et sclérodermie (carrés bleus réels).
  'REVOLADE', 'ELTROMBOPAG', 'NPLATE', 'ROMIPLOSTIM', 'VELBE', 'VINBLASTINE',
  'AMLODIPINE', 'NICARDIPINE', 'LOXEN', 'ADALATE', 'NIFEDIPINE', 'IEC',
  'BOSENTAN', 'TRACLEER', 'SILDENAFIL', 'REVATIO', 'ILOPROST', 'ILOMEDINE',
];
const DRUG_SET = new Set(DRUGS.map(norm));

// Acronymes à NE PAS confondre avec des médicaments.
const BLACKLIST = new Set([
  'efr', 'tdm', 'dlco', 'vems', 'cvf', 'cpt', 'ett', 'htp', 'pins', 'sars', 'cov', 'cov2',
  'vhb', 'vhc', 'vih', 'nk', 'iga', 'igg', 'igm', 'ige', 'cd', 'crp', 'vs', 'asia', 'avc',
  'iv', 'im', 'sc', 'atcd', 'ide', 'tec', 'ph', 'bau', 'tb', 'g', 'l', 'ml',
  // Titres de section / mots-clés fréquents des comptes-rendus (souvent en
  // MAJUSCULES), à ne pas prendre pour un médicament même quand une valeur
  // chiffrée avec unité traîne juste après (ex. « BIOLOGIE : CRP 5 mg/L »).
  'examen', 'clinique', 'biologie', 'conclusion', 'antecedents', 'antecedent',
  'histoire', 'maladie', 'traitement', 'traitements', 'actuel', 'actuels',
  'actuelle', 'actuelles', 'evolution', 'diagnostic', 'synthese', 'resume',
  'observation', 'motif', 'hospitalisation', 'consultation', 'suivi',
  'proposition', 'discussion', 'contexte', 'introduction', 'posologie',
  'duree', 'dose', 'imagerie', 'scanner', 'radiographie', 'echographie',
  'paraclinique', 'plan', 'objectif', 'indication', 'surveillance',
  'recommandation', 'recommandations', 'compte', 'rendu', 'medicaux',
  'chirurgicaux', 'familiaux', 'personnels', 'poids', 'taille', 'tension',
  'temperature', 'saturation',
]);

// Le rythme d'administration : « matin et soir », « le matin » (article
// toléré — un compte-rendu ou une dictée dit rarement « matin » tout sec),
// « par cure » (immunoglobulines, biothérapies), « 1 ampoule/comprimé par
// mois » (Zymad, biothérapies sous-cutanées), « x3 » (bolus), « /j, /sem ».
const RYTHME_RE =
  '(?:' +
    '(?:\\d+\\s?|une?\\s+)?(?:ampoules?|comprim[ée]s?|cp|g[ée]lules?|gouttes?|sachets?)\\s+par\\s+(?:jour|semaine|mois)' +
  '|' +
    '(?:le\\s+|au\\s+)?matin(?:\\s+et\\s+(?:le\\s+)?soir)?' +
  '|' +
    '(?:le\\s+|au\\s+)?soir' +
  '|' +
    'midi' +
  '|' +
    '\\d\\s?x\\s?\\/\\s?j(?:our)?' +
  '|' +
    'x\\s?\\d+(?:\\s?\\/\\s?j(?:our)?)?' +
  '|' +
    '(?:iv|sc|per\\s+os|po)(?:\\s+(?:mensuel(?:le)?|hebdomadaire|quotidien(?:ne)?|par\\s+(?:semaine|mois|jour)))?' +
  '|' +
    'mensuel(?:le)?|hebdomadaire|quotidien(?:ne)?' +
  '|' +
    '(?:\\d+\\s?fois\\s+)?par\\s+(?:jour|semaine|mois|cure|cures)' +
  '|' +
    '\\/\\s?(?:j|sem|semaine|mois)' +
  ')';

// Partie numérique : chiffres simples (3, 1,5) OU groupés par milliers avec
// espace/espace insécable (comptes-rendus imprimés : « 50 000 UI »).
const NOMBRE_RE = '(?:\\d{1,3}(?:[ \\u00A0]\\d{3})+|\\d+)(?:[.,]\\d+)?';

const DOSE_RE = new RegExp(
  NOMBRE_RE + '\\s?(?:mg\\/kg\\/j(?:our)?|mg\\/kg|mg\\/m[²2]|g\\/kg|mg\\/jour|mg\\/j|g\\/jour|g\\/j|mg|µg|ug|g|ui|u\\/ml)' +
  '\\b(?:\\s?' + RYTHME_RE + ')?',
  'i',
);

// ── Doses dictées en toutes lettres ──────────────────────────────
// Dragon (ou une saisie manuelle non relue) peut laisser passer un nombre
// épelé plutôt que chiffré : « un virgule cinq grammes », « dix
// milligrammes ». On les reconnaît pour les mêmes médicaments, puis on
// reconstruit une forme numérique classique afin de réutiliser DOSE_RE tel
// quel (y compris pour capter le rythme qui suit).
const NUM_WORDS: Record<string, number> = {
  zero: 0, un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9,
  dix: 10, onze: 11, douze: 12, treize: 13, quatorze: 14, quinze: 15, seize: 16,
  vingt: 20, trente: 30, quarante: 40, cinquante: 50, soixante: 60,
  cent: 100, cents: 100, mille: 1000,
};
const NUM_TOKEN =
  '(?:zero|une?|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|treize|quatorze|quinze|' +
  'seize|vingt|trente|quarante|cinquante|soixante|cents?|mille|et)';

const DOSE_DICTEE_RE = new RegExp(
  '\\b((?:' + NUM_TOKEN + '[\\s-]+)*' + NUM_TOKEN + ')' +               // partie entière
  '(?:[\\s-]+virgule[\\s-]+((?:' + NUM_TOKEN + '[\\s-]+)*' + NUM_TOKEN + '))?' + // décimale
  '[\\s-]+(milligrammes?|microgrammes?|grammes?|unit[ée]s?\\s+internationales?)\\b',
  'i',
);

/** Convertit une suite de mots-nombres français (« cinquante mille »,
 *  « quatre vingt dix ») en entier. `null` si un mot n'est pas reconnu. */
function motsVersNombre(tokens: string[]): number | null {
  const vals: number[] = [];
  for (const t of tokens) {
    if (t === 'et') continue;
    const v = NUM_WORDS[t];
    if (v === undefined) return null;
    vals.push(v);
  }
  if (!vals.length) return null;
  let total = 0, current = 0;
  for (const v of vals) {
    if (v === 1000) { current = current === 0 ? 1000 : current * 1000; total += current; current = 0; }
    else if (v === 100) { current = current === 0 ? 100 : current * 100; }
    else if (v === 20 && current > 0 && current < 10) { current *= 20; } // « quatre-vingt(s) »
    else { current += v; }
  }
  return total + current;
}

/** Reconstruit un segment « <nombre> <unité> <reste> » chiffré à partir
 *  d'une dose dictée en toutes lettres, pour réinjection dans DOSE_RE. */
function reconstruireDoseDictee(segment: string): string | null {
  const n = norm(segment);
  const m = n.match(DOSE_DICTEE_RE);
  if (!m) return null;

  const intVal = motsVersNombre(m[1].trim().split(/[\s-]+/).filter(Boolean));
  if (intVal == null) return null;
  let numStr = String(intVal);
  if (m[2]) {
    const decVal = motsVersNombre(m[2].trim().split(/[\s-]+/).filter(Boolean));
    if (decVal != null) numStr += ',' + decVal;
  }

  const unitWord = m[3];
  const unit = /^milli/.test(unitWord) ? 'mg' : /^micro/.test(unitWord) ? 'µg'
    : /^unit/.test(unitWord) ? 'UI' : 'g';

  const restStart = (m.index ?? 0) + m[0].length;
  const rest = n.slice(restStart, restStart + 30);
  return `${numStr} ${unit}${rest}`;
}

/** Dose en comprimés (« 1 comprimé matin et soir », « deux comprimés … »). */
const DOSE_CP_RE = new RegExp(
  '\\b(\\d+|une?|deux|trois|quatre)\\s+(?:comprim[ée]s?|cp|g[ée]lules?|sachets?|ampoules?)' +
  '(?:\\s+(?:le\\s+|au\\s+)?(?:matin(?:\\s+et\\s+(?:le\\s+)?soir)?|soir|midi|par\\s+(?:jour|semaine|mois)))?',
  'i',
);

function findDose(segment: string): string {
  const direct = segment.match(DOSE_RE);
  if (direct) {
    // Dose composée : « 1 g matin - 500 mg soir », « 1 g le matin 500 mg le soir ».
    let dose = direct[0];
    let reste = segment.slice((direct.index ?? 0) + direct[0].length);
    for (let k = 0; k < 2; k++) {
      const suite = reste.match(new RegExp('^\\s*(?:[-–,+]|et)?\\s*(' + DOSE_RE.source + ')', 'i'));
      if (!suite) break;
      dose += ' ' + suite[1];
      reste = reste.slice(suite[0].length);
    }
    return dose.replace(/\s+/g, ' ').trim();
  }
  const cp = segment.match(DOSE_CP_RE);
  if (cp) return cp[0].replace(/\s+/g, ' ').trim();
  const reconstruit = reconstruireDoseDictee(segment);
  if (reconstruit) {
    const m2 = reconstruit.match(DOSE_RE);
    if (m2) return m2[0].replace(/\s+/g, ' ').trim();
  }
  return '';
}

// ── Sections du compte-rendu ────────────────────────────────────
// Une ligne « Titre : » (ou « TITRE : contenu ») ouvre une section. Seules
// les sections thérapeutiques sont lues ; « Suivi sous traitement »,
// vaccinations, projet, bilan, examen, biologie… ne produisent rien — leurs
// dates (consultation, ostéodensitométrie) ne sont pas des dates de traitement.
type Section = 'lire' | 'ignorer' | 'actuel';
const SECTION_IGNOREE = /\b(suivi|projet|vaccin|bilan|examen|biologie|antecedent|mode de vie|allergie|conclusion|imagerie|scanner|surveillance|consultation|autres pathologies)/;
const SECTION_ACTUELLE = /\btraitements?\s+(actuels?|en cours|de sortie)|\bordonnance\b|\btraitement a la sortie/;
const SECTION_LUE = /\b(traitement|therapeutique|lignes?|pathologie|histoire|evolution)/;

function sectionDe(titre: string): Section | null {
  const t = norm(titre);
  if (SECTION_ACTUELLE.test(t)) return 'actuel';
  if (SECTION_IGNOREE.test(t)) return 'ignorer';
  if (SECTION_LUE.test(t)) return 'lire';
  return null;
}

// ── Actions ────────────────────────────────────────────────────
const ACT_ARRET = /\b(arret(e|es)?|stop(pe)?|interruption|interrompu|suspension|suspendu|sevrage)\b/;
const ACT_MODIF = /\b(augmentation|augmente|diminution|diminue|majoration|baisse|reduction|reduit|decroissance|degression|passage)\b/;
const ACT_DEBUT = /\b(reprise|repris|instauration|introduction|introduit|initiation|ajout|debut|mise sous|traitement par|relais? par|par)\b/;
const ACT_EVENT = /\b(cures?|bolus|perfusions?|j1)\b/;
const ACT_SUITE = /\b(sous|poursuite|maintien|reponse complete)\b/;

function distance1(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1 || a === b) return a === b;
  let i = 0, j = 0, diff = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++diff > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return diff + (a.length - i) + (b.length - j) <= 1;
}

interface Mention { debut: number; fin: number; nom: string; dict: boolean; }

/** Extrait les traitements d'un compte-rendu clinique (« carré bleu »).
 *  `extraDrugs` : médicaments appris des imports précédents. */
export function parseReport(text: string, extraDrugs: string[] = []): ExtractedTreatment[] {
  if (!text || !text.trim()) return [];
  const drugSet = new Set(DRUG_SET);
  for (const d of extraDrugs) drugSet.add(norm(d));
  const connus = [...drugSet];

  const clean = text.replace(/\r/g, '');
  const dates = findDates(clean);
  const out: ExtractedTreatment[] = [];
  const seen = new Set<string>();

  let section: Section = 'lire';
  let dateReportee: DateHit | null = null; // date de tête de la dernière ligne datée
  let pos = 0;
  for (const ligneBrute of clean.split('\n')) {
    const debutLigne = pos;
    pos += ligneBrute.length + 1;
    const ligne = ligneBrute.replace(/^[\s•·●◦○▪■\-–*o]+(?=\S)/, m => ' '.repeat(m.length));
    if (!ligne.trim()) continue;

    // Titre de section, seul (« Suivi sous traitement : ») ou suivi d'un contenu.
    let offsetContenu = 0;
    const titre = ligne.match(/^\s*([A-Za-zÀ-ÿ'’ ]{3,60}?)\s*(?:\([^)]*\))?\s*:\s*/);
    if (titre) {
      const sec = sectionDe(titre[1]);
      if (sec) {
        section = sec;
        dateReportee = null;
        offsetContenu = titre[0].length;
      }
    } else if (/^\s*[A-Za-zÀ-ÿ'’ ]{3,60}\s*(?:\([^)]*\))?\s*$/.test(ligne)) {
      const sec = sectionDe(ligne);
      if (sec) { section = sec; dateReportee = null; continue; }
    }
    if (section === 'ignorer') continue;

    const aLigne = debutLigne + offsetContenu, bLigne = debutLigne + ligne.length;
    const datesLigne = dates.filter(d => d.index >= aLigne && d.index < bLigne);
    // Date de tête : avant les deux-points de la ligne (« Janvier 2020 : … »).
    const deuxPoints = ligne.indexOf(':', offsetContenu);
    const dateTete = datesLigne.find(d => deuxPoints > 0 && d.index < debutLigne + deuxPoints && d.index - aLigne < 60) ?? null;
    if (dateTete) dateReportee = dateTete;

    // Propositions : fin de phrase, « ; », « => », « puis », virgule (hors décimale).
    const coupures = [aLigne];
    const reCoupe = /\.\s+(?=[A-ZÀ-Ý0-9])|;|=>|→|\bpuis\b|,\s+(?!\d)/g;
    const contenu = clean.slice(aLigne, bLigne);
    for (const m of contenu.matchAll(reCoupe)) coupures.push(aLigne + m.index! + m[0].length);
    coupures.push(bLigne);

    for (let ci = 0; ci + 1 < coupures.length; ci++) {
      const a = coupures[ci], b = coupures[ci + 1];
      const prop = clean.slice(a, b);

      // Médicaments de la proposition.
      const mentions: Mention[] = [];
      for (const m of prop.matchAll(/\bI[gG]\s?I[Vv]\b|\b[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\-]{2,}\b|\b[A-Z]{1,2}\s+[A-Z]{3,}\b/g)) {
        const tok = m[0];
        const n = norm(tok).replace(/\s+/g, '');
        let nom = tok.replace(/\s+/g, ' ');
        let dict = drugSet.has(n) || /^igiv$/.test(n);
        if (/^igiv$/.test(n)) nom = 'IgIV';
        const caps = /^[A-ZÀ-Ý][A-ZÀ-Ý\- ]{2,}$/.test(tok);
        if (!dict && !caps) continue;
        if (BLACKLIST.has(n)) continue;
        if (!dict && caps && n.length >= 6) {
          // Faute de frappe sur un médicament connu (« MYORTIC » → MYFORTIC).
          const proche = connus.find(c => c.length >= 6 && distance1(c, n));
          if (proche) { dict = true; nom = proche.toUpperCase(); }
        }
        const d = a + m.index!;
        if (mentions.some(x => d < x.fin)) continue; // chevauchement (« N PLATE »)
        mentions.push({ debut: d, fin: d + tok.length, nom, dict });
      }

      mentions.forEach((mt, k) => {
        const finZone = k + 1 < mentions.length ? mentions[k + 1].debut : b;
        const apres = clean.slice(mt.fin, finZone);
        const avant = clean.slice(k > 0 ? mentions[k - 1].fin : a, mt.debut);
        const avantProp = clean.slice(a, mt.debut);
        const dose = findDose(apres.slice(0, 80));
        const nAvant = norm(avant), nAvantProp = norm(avantProp), nApres = norm(apres);

        // Un mot en MAJUSCULES inconnu n'est un médicament qu'avec une dose
        // ou une action claire (sinon : titre, sigle, nom propre…).
        if (!mt.dict && !dose && !ACT_ARRET.test(nAvant) && !ACT_DEBUT.test(nAvant)) return;

        // Action.
        let action: ExtractedTreatment['action'];
        if (section === 'actuel') action = 'actuel';
        else if (/\brelais?\s+(du|de la|de l|des)\s*$/.test(nAvant)) action = 'arret';
        else if (ACT_ARRET.test(nAvant)) action = 'arret';
        else if (ACT_EVENT.test(nAvant) || ACT_EVENT.test(nApres) || /\bx\s?\d\b(?!\s?\/)/.test(nApres)) action = 'evenement';
        else if (ACT_MODIF.test(nAvantProp)) action = 'modif';
        else if (ACT_DEBUT.test(nAvantProp)) action = 'debut';
        // « sous CELLCEPT seul », « poursuite » : rien de neuf — sauf avec une
        // dose (« actuellement sous cellcept 1,5 g… ») : c'est le traitement actuel.
        else if (ACT_SUITE.test(nAvant)) { if (!dose) return; action = 'actuel'; }
        else action = 'debut';

        // Date.
        let dh: DateHit | null = null, fin: DateHit | null = null;
        if (action !== 'actuel') {
          const apresDates = dates.filter(d => d.index >= mt.fin && d.index < finZone);
          const plage = apres.match(/^\s*(?:de|du|entre)\s+\S+(?:\s+\S+)?\s+(?:a|à|au|et)\s+\S+/i);
          if (plage && apresDates.length >= 2) { dh = apresDates[0]; fin = apresDates[1]; }
          else if (apresDates.length) dh = apresDates[0];
          else {
            // « CELLCEPT + REVOLADE en 2015 » : la date qui suit dans la proposition.
            const suivante = dates.find(d => d.index >= mt.fin && d.index < b);
            const tete = dates.filter(d => d.index >= a && d.index < mt.debut).pop();
            const precedente = dates.filter(d => d.index >= aLigne && d.index < mt.debut).pop();
            dh = suivante ?? tete ?? dateTete ?? precedente ?? dateReportee;
          }
        }

        const kind: 'continuous' | 'event' = action === 'evenement' ? 'event' : 'continuous';
        const taper = /\b(decroissance|degression|decroissant)/.test(nAvantProp + ' ' + nApres);
        const pousser = (act: ExtractedTreatment['action'], d: DateHit | null, dos: string) => {
          const key = `${norm(mt.nom)}|${d?.iso}|${act}|${dos}`;
          if (seen.has(key)) return;
          seen.add(key);
          out.push({
            name: mt.nom, dose: dos, date: d?.iso ?? null, rawDate: d?.raw ?? '', kind: act === 'evenement' ? 'event' : kind,
            isStop: act === 'arret', taper, raw: (avantProp + clean.slice(mt.debut, finZone)).replace(/\s+/g, ' ').trim(), action: act,
          });
        };
        pousser(action, dh, dose);
        if (fin) pousser('arret', fin, '');
      });
    }
  }
  return out;
}

/**
 * Dose quotidienne en mg quand la posologie le permet (« 1 g x 2/j » → 2000,
 * « 1 g matin 500 mg soir » → 1500, « 1,5 g matin et soir » → 3000). `null`
 * pour les doses non journalières ou non pondérales (mg/kg, comprimés, UI…).
 */
export function doseJournaliereMg(dose: string): number | null {
  const d = norm(dose ?? '').replace(/,/g, '.');
  if (!d || /mg\/kg|g\/kg|mg\/m|comprim|cp\b|gelule|ui\b|mensuel|semaine|mois|cure/.test(d)) return null;
  const termes = [...d.matchAll(/(\d+(?:\.\d+)?)\s?(mg|g)\b([^0-9]*)/g)];
  if (!termes.length) return null;
  let total = 0;
  for (const t of termes) {
    let mg = parseFloat(t[1]) * (t[2] === 'g' ? 1000 : 1);
    const suite = t[3];
    // Multiplicateur juste après la dose : « x 2 », « 2x/j ».
    const zone = d.slice(t.index! + t[0].length - suite.length, t.index! + t[0].length + 3);
    const fois = zone.match(/^\s*x\s?(\d)|^\s*(\d)\s?x/);
    if (fois) mg *= +(fois[1] ?? fois[2]);
    else if (/matin\s+et\s+(le\s+)?soir/.test(suite)) mg *= 2;
    total += mg;
  }
  return Math.round(total);
}
