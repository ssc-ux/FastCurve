// ──────────────────────────────────────────────────────────────
// Mémoire d'apprentissage locale (100% navigateur).
// L'outil retient les corrections du médecin pour les réappliquer :
//  - alias d'analytes (OCR) : nom lu → nom + unité corrigés
//  - médicaments confirmés (compte-rendu) : reconnus la prochaine fois
// Rien ne quitte le poste ; réinitialisable.
// ──────────────────────────────────────────────────────────────

import { SEED_ANALYTE_ALIASES, SEED_DRUGS, SEED_DRUG_ALIASES } from './seed';

const KEY = 'fastcurve.learn.v1';

export interface LearnData {
  analyteAliases: Record<string, { name: string; unit: string }>;
  drugs: string[];              // noms de médicaments confirmés (forme d'origine)
  drugAliases: Record<string, string>; // nom lu → nom corrigé
}

function empty(): LearnData {
  return { analyteAliases: {}, drugs: [], drugAliases: {} };
}

export function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function load(): LearnData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    return { ...empty(), ...JSON.parse(raw) };
  } catch {
    return empty();
  }
}

function save(d: LearnData) {
  try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* ignore */ }
}

// ── Analytes (OCR) ──────────────────────────────
/** Retient qu'un nom lu correspond à tel analyte + unité. */
export function learnAnalyte(readName: string, finalName: string, finalUnit: string) {
  const k = norm(readName);
  if (!k || !finalName.trim()) return;
  // On n'apprend que si la lecture différait de la correction.
  if (norm(readName) === norm(finalName) && !finalUnit) return;
  const d = load();
  d.analyteAliases[k] = { name: finalName.trim(), unit: finalUnit.trim() };
  save(d);
}

/** Cherche une correction apprise (mémoire locale, puis dictionnaire intégré). */
export function lookupAnalyte(readName: string): { name: string; unit: string } | null {
  const k = norm(readName);
  const d = load();
  return d.analyteAliases[k] ?? SEED_ANALYTE_ALIASES[k] ?? null;
}

// ── Médicaments (compte-rendu) ──────────────────
export function learnDrug(readName: string, finalName: string) {
  const d = load();
  const fn = finalName.trim();
  if (!fn) return;
  if (!d.drugs.some(x => norm(x) === norm(fn))) d.drugs.push(fn);
  if (norm(readName) && norm(readName) !== norm(fn)) d.drugAliases[norm(readName)] = fn;
  save(d);
}

/** Médicaments connus = dictionnaire intégré + mémoire locale (dédupliqués). */
export function getKnownDrugs(): string[] {
  const local = load().drugs;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of [...SEED_DRUGS, ...local]) {
    const k = norm(x);
    if (!seen.has(k)) { seen.add(k); out.push(x); }
  }
  return out;
}

export function lookupDrug(readName: string): string | null {
  const k = norm(readName);
  return load().drugAliases[k] ?? SEED_DRUG_ALIASES[k] ?? null;
}

// ── Gestion ─────────────────────────────────────
export function learnStats(): { analytes: number; drugs: number; builtinAnalytes: number; builtinDrugs: number } {
  const d = load();
  return {
    analytes: Object.keys(d.analyteAliases).length,
    drugs: d.drugs.length,
    builtinAnalytes: Object.keys(SEED_ANALYTE_ALIASES).length,
    builtinDrugs: SEED_DRUGS.length,
  };
}

/** Exporte ce que CE poste a appris (à transmettre pour intégration à l'app). */
export function exportLearning(): string {
  return JSON.stringify(load(), null, 2);
}

/** Fusionne un fichier d'apprentissage dans la mémoire locale. */
export function importLearning(json: string): boolean {
  try {
    const inc = JSON.parse(json) as Partial<LearnData>;
    const d = load();
    Object.assign(d.analyteAliases, inc.analyteAliases || {});
    Object.assign(d.drugAliases, inc.drugAliases || {});
    for (const x of inc.drugs || []) if (!d.drugs.some(y => norm(y) === norm(x))) d.drugs.push(x);
    save(d);
    return true;
  } catch {
    return false;
  }
}

export function resetLearning() {
  save(empty());
}
