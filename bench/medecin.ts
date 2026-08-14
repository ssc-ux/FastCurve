// ──────────────────────────────────────────────────────────────
// LES CINQ ERREURS DU MÉDECIN, en cas de test.
//
// Le taux global de cellules justes ne suffit pas : il noie les cinq fautes
// précises relevées sur sa capture. Chacune est donc mesurée à part, sur les
// dix captures du banc, et chacune a un verdict binaire.
//
// 1. une borne de la colonne « Normes » proposée comme résultat (Créatinine 104)
// 2. la même chose ailleurs (Plaquettes 400)
// 3. une virgule décimale perdue (12,2 rendu 122)
// 4. l'unité agglutinée au nom (« Créatinine umolL »)
// 5. plusieurs colonnes de dates fondues en une seule, sans date
// ──────────────────────────────────────────────────────────────

import type { CasVerite, TableauMesure } from './notation';
import { BILAN_A, BILAN_B, BILAN_C, BILAN_D, BILAN_MEDECIN } from './bilans.mjs';

interface LigneBilan { nom: string; unite: string; valeurs: string[]; normes: string }
interface Bilan { dates: string[]; entetes: string[]; lignes: LigneBilan[] }

/** Quel bilan a servi à fabriquer quelle capture. */
const BILAN_DE: Record<string, Bilan> = {
  'encadre-normal': BILAN_A, 'encadre-petit': BILAN_A,
  'zebre-normal': BILAN_B, 'zebre-petit': BILAN_B, 'encadre-minuscule': BILAN_B,
  'serif-palecontraste': BILAN_C, 'serif-petit': BILAN_C, 'encadre-gris': BILAN_C,
  'fleches-anormales': BILAN_D, 'zebre-hd': BILAN_D,
  medecin: BILAN_MEDECIN, 'medecin-petit': BILAN_MEDECIN,
};

function nombre(s: string): number | null {
  const t = (s ?? '').trim().replace(',', '.').replace(/^[<>≤≥]\s*/, '');
  if (!t) return null;
  const n = parseFloat(t);
  return isNaN(n) ? null : n;
}

/** Les bornes numériques d'un intervalle de normes : « 60 - 110 » → [60, 110]. */
export function bornesDeNormes(normes: string): number[] {
  return (normes.match(/\d+(?:[.,]\d+)?/g) ?? []).map(x => parseFloat(x.replace(',', '.')));
}

function memeNom(a: string, b: string): boolean {
  const n = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const na = n(a), nb = n(b);
  if (!na || !nb) return false;
  return na === nb || (na.length >= 4 && (na.startsWith(nb) || nb.startsWith(na)));
}

export interface CasMedecin {
  /** Numéro de l'erreur au cahier des charges (1 à 5). */
  numero: number;
  /** Nombre de fois où l'erreur se produit encore. */
  fautes: number;
  /** Où, en clair. */
  details: string[];
}

/**
 * Passe les cinq cas sur une capture. Chaque faute est décrite : un compteur
 * sans exemple ne se corrige pas.
 */
export function casMedecin(cas: CasVerite, res: TableauMesure): CasMedecin[] {
  const bilan = BILAN_DE[cas.id];
  const out: CasMedecin[] = [1, 2, 3, 4, 5].map(numero => ({ numero, fautes: 0, details: [] }));
  const faute = (n: number, quoi: string) => { out[n - 1].fautes++; out[n - 1].details.push(`${cas.id} : ${quoi}`); };

  // ── 1 & 2 : une borne de normes proposée comme résultat ──
  // On cherche, ligne par ligne, une valeur produite qui est une borne de la
  // colonne « Normes » de cette ligne SANS être une vraie valeur du patient.
  for (const lv of cas.lignes) {
    const lb = bilan?.lignes.find(l => memeNom(l.nom, lv.nom));
    const lm = res.lignes.find(l => memeNom(l.nom, lv.nom));
    if (!lb || !lm) continue;
    const bornes = bornesDeNormes(lb.normes);
    const vraies = new Set(lv.valeurs.map(v => nombre(v)).filter(v => v !== null));
    for (const brut of lm.valeurs) {
      const v = nombre(brut);
      if (v === null || vraies.has(v)) continue;
      if (bornes.includes(v)) {
        // Créatinine et Plaquettes sont les deux exemples nommés par le médecin.
        const numero = /plaquette/i.test(lv.nom) ? 2 : 1;
        faute(numero, `${lv.nom} : « ${brut} » est une borne de la norme « ${lb.normes} »`);
      }
    }
  }

  // ── 3 : virgule décimale perdue ──
  for (const lv of cas.lignes) {
    const lm = res.lignes.find(l => memeNom(l.nom, lv.nom));
    if (!lm) continue;
    lv.valeurs.forEach((attendu, k) => {
      const a = nombre(attendu);
      if (a === null || !/[.,]/.test(attendu)) return;
      const iso = cas.dates[k];
      const ci = res.dates.indexOf(iso);
      const v = ci >= 0 ? nombre(lm.valeurs[ci] ?? '') : null;
      if (v === null) return;
      // La virgule a sauté : la valeur vaut dix (ou cent) fois la vraie.
      if (Math.abs(v - a * 10) < 1e-6 || Math.abs(v - a * 100) < 1e-6) {
        faute(3, `${lv.nom} : « ${attendu} » rendu « ${lm.valeurs[ci]} »`);
      }
    });
  }

  // ── 4 : unité agglutinée au nom ──
  const UNITE_COLLEE = /\b(u?mol\/?l|µmol\/?l|mmol\/?l|nmol\/?l|g\/?dl|g\/?l|mg\/?l|[µu]g\/?l|ui\/?ml|ui\/?l|mui\/?l|fl|%)\s*$/i;
  for (const lm of res.lignes) {
    if (lm.nom && UNITE_COLLEE.test(lm.nom.trim())) faute(4, `nom proposé « ${lm.nom} »`);
  }

  // ── 5 : les colonnes de dates ──
  const colonnesDatees = res.dates.filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d ?? '')).length;
  if (colonnesDatees < cas.dates.length) {
    faute(5, `${cas.dates.length} colonnes de dates sur l'image, ${colonnesDatees} datée(s) en sortie`);
  }

  return out;
}

/** Cumule les cas de test sur toutes les captures. */
export function cumulerCas(tous: CasMedecin[][]): CasMedecin[] {
  const out: CasMedecin[] = [1, 2, 3, 4, 5].map(numero => ({ numero, fautes: 0, details: [] }));
  for (const liste of tous) {
    liste.forEach((c, i) => { out[i].fautes += c.fautes; out[i].details.push(...c.details); });
  }
  return out;
}

export const LIBELLE_CAS: Record<number, string> = {
  1: 'Créatinine 104 — borne de la colonne « Normes » prise pour un résultat',
  2: 'Plaquettes 400 — même cause, autre ligne',
  3: 'Leucocytes 12,2 rendu 122 — virgule décimale perdue',
  4: '« Créatinine umolL » — unité agglutinée au nom',
  5: '3 colonnes de dates fondues en 1 seule, sans date',
};
