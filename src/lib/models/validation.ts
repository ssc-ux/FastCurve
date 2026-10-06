// ──────────────────────────────────────────────────────────────
// VALIDATION D'UN SUIVI VENU DE L'EXTÉRIEUR.
//
// Un fichier .fastcurve.json (ou le stockage d'un autre onglet) n'est pas
// digne de confiance : il peut être tronqué, venir d'une autre version, ou
// avoir été modifié à la main. On n'en garde que ce qui a la forme attendue —
// clés connues, types et énumérations vérifiés, tailles bornées — et on
// écarte le reste plutôt que de le laisser corrompre le suivi ou le rendu.
//
// Module PUR (aucun DOM) : entièrement testable hors navigateur.
// ──────────────────────────────────────────────────────────────

import type {
  Annotation, DosePoint, Measurement, Parameter, Settings, StudyState, Treatment,
} from './types';

/** Taille maximale d'un fichier de suivi accepté (caractères). */
export const TAILLE_MAX_JSON = 5_000_000;

const MAX_ELEMENTS = 20_000;
const MAX_TEXTE = 500;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const COULEUR = /^#[0-9a-f]{3,8}$/i;

type Brut = Record<string, unknown>;
const estObjet = (x: unknown): x is Brut => typeof x === 'object' && x !== null && !Array.isArray(x);
const texte = (x: unknown, defaut = ''): string => (typeof x === 'string' ? x.slice(0, MAX_TEXTE) : defaut);
const nombre = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const date = (x: unknown): string | null => (typeof x === 'string' && ISO.test(x) ? x : null);
const couleur = (x: unknown): string | null => (typeof x === 'string' && COULEUR.test(x) ? x : null);
const ordre = (x: unknown, i: number): number => nombre(x) ?? i;
const liste = (x: unknown): unknown[] => (Array.isArray(x) ? x.slice(0, MAX_ELEMENTS) : []);
function parmi<T extends string>(x: unknown, valeurs: readonly T[], defaut: T): T {
  return valeurs.includes(x as T) ? (x as T) : defaut;
}

function parametre(x: unknown, i: number): Parameter | null {
  if (!estObjet(x) || typeof x.id !== 'string' || typeof x.name !== 'string') return null;
  const p: Parameter = {
    id: texte(x.id), name: texte(x.name), unit: texte(x.unit),
    category: parmi(x.category, ['biologie', 'efr', 'immunologie', 'libre'] as const, 'libre'),
    refLow: nombre(x.refLow), refHigh: nombre(x.refHigh),
    color: couleur(x.color), order: ordre(x.order, i),
    panelGroup: typeof x.panelGroup === 'string' ? texte(x.panelGroup) : null,
  };
  if (x.display === 'absolute' || x.display === 'percent') p.display = x.display;
  return p;
}

function mesure(x: unknown, ids: Set<string>): Measurement | null {
  if (!estObjet(x) || typeof x.id !== 'string') return null;
  const d = date(x.date), v = nombre(x.value);
  if (!d || v === null || typeof x.parameterId !== 'string' || !ids.has(x.parameterId)) return null;
  const q = x.qualifier === '<' || x.qualifier === '>' ? x.qualifier : null;
  return { id: texte(x.id), parameterId: x.parameterId, date: d, value: v, qualifier: q };
}

function traitement(x: unknown, i: number): Treatment | null {
  if (!estObjet(x) || typeof x.id !== 'string' || typeof x.name !== 'string') return null;
  const debut = date(x.start);
  if (!debut) return null;
  const t: Treatment = {
    id: texte(x.id), name: texte(x.name),
    kind: parmi(x.kind, ['continuous', 'event'] as const, 'continuous'),
    start: debut, end: date(x.end), color: couleur(x.color), order: ordre(x.order, i),
  };
  if (typeof x.dose === 'string') t.dose = texte(x.dose);
  if (typeof x.doseUnit === 'string') t.doseUnit = texte(x.doseUnit);
  if (Array.isArray(x.dosePoints)) {
    t.dosePoints = liste(x.dosePoints)
      .map((p): DosePoint | null => {
        if (!estObjet(p)) return null;
        const d = date(p.date), v = nombre(p.dose);
        return d && v !== null ? { date: d, dose: v } : null;
      })
      .filter((p): p is DosePoint => p !== null);
  }
  return t;
}

function annotation(x: unknown, i: number): Annotation | null {
  if (!estObjet(x) || typeof x.id !== 'string') return null;
  const d = date(x.date);
  return d ? { id: texte(x.id), date: d, text: texte(x.text), order: ordre(x.order, i) } : null;
}

/** Réglages : seulement les clés connues, au bon type ; le reste garde le défaut. */
function reglages(x: unknown, defauts: Settings): Settings {
  const s = { ...defauts };
  if (!estObjet(x)) return s;
  const r = s as unknown as Brut;
  for (const [k, v] of Object.entries(defauts)) {
    const lu = x[k];
    if (lu === undefined) continue;
    if (typeof v === 'boolean' && typeof lu === 'boolean') r[k] = lu;
    else if (typeof v === 'string' && typeof lu === 'string') r[k] = texte(lu);
  }
  s.chartMode = parmi(x.chartMode, ['stacked', 'single'] as const, defauts.chartMode);
  s.fromDate = date(x.fromDate);
  s.toDate = date(x.toDate);
  return s;
}

/**
 * Valide un suivi lu de l'extérieur. Rend `null` si ce n'est pas un suivi
 * (pas d'objet, pas de liste de paramètres) ; sinon un suivi propre, dont les
 * éléments mal formés ont été écartés.
 */
export function validerEtude(x: unknown, vide: StudyState): StudyState | null {
  if (!estObjet(x) || !Array.isArray(x.parameters)) return null;
  const garder = <T>(l: unknown[], f: (e: unknown, i: number) => T | null) =>
    l.map(f).filter((e): e is T => e !== null);
  const parameters = garder(liste(x.parameters), parametre);
  const ids = new Set(parameters.map(p => p.id));
  return {
    version: nombre(x.version) ?? vide.version,
    patientLabel: texte(x.patientLabel),
    parameters,
    measurements: garder(liste(x.measurements), e => mesure(e, ids)),
    treatments: garder(liste(x.treatments), traitement),
    annotations: garder(liste(x.annotations), annotation),
    settings: reglages(x.settings, vide.settings),
    extraDates: liste(x.extraDates).map(date).filter((d): d is string => d !== null),
  };
}
