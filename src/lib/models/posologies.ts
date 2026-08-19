// ──────────────────────────────────────────────────────────────
// Schémas de posologie standards proposés au médecin au moment d'ajouter
// un traitement (onglet Repères) : des puces cliquables (« J1, J15 : 1 g »)
// qui remplissent la dose — et, pour un schéma à plusieurs prises, créent
// directement les événements aux bonnes dates (ex. Rituximab J1 + J15) sans
// que le médecin ait à calculer ni saisir chaque date.
//
// Rédigé comme un article de synthèse : uniquement des protocoles dont je
// suis réellement sûr (SmPC / essais fondateurs bien identifiés, dose fixe
// et non individualisée). Quand un médicament n'a pas de dose « standard »
// unique (titration, dose au poids ou à la surface corporelle sans formule
// simple, protocole qui varie selon l'indication ou la réponse), aucun
// schéma n'est renseigné plutôt qu'une dose inventée qui « a l'air
// plausible » — voir la liste des médicaments volontairement laissés sans
// schéma en bas de fichier, et le rapport d'audit (RAPPORT-TRAITEMENTS.md)
// pour le détail.
// ──────────────────────────────────────────────────────────────

import type { TreatmentKind } from './types';

export interface SchemaPosologie {
  /** Ce que le médecin voit et clique, ex. « J1, J15 : 1 g ». */
  libelle: string;
  /** Texte à mettre dans Treatment.dose. */
  dose: string;
  kind: TreatmentKind;
  /**
   * Jours après la date de la première prise (J1 = jour 0, implicite) pour
   * les prises suivantes. Absent ou vide = prise unique / traitement continu
   * à dose constante — pas de génération de dates supplémentaires.
   * Ex. Rituximab J1-J15 → [14] ; 375 mg/m² ×4 hebdomadaire → [7, 14, 21].
   */
  joursSuivants?: number[];
}

function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Clé = DCI normalisée (sans accent, minuscules). */
const POSOLOGIES_BASE: Record<string, SchemaPosologie[]> = {
  rituximab: [
    {
      // Schéma « rhumatologie/vascularites » : deux perfusions à 15 jours
      // d'intervalle. C'est le schéma cité par le médecin, et celui du RCP
      // Mabthera pour la polyarthrite rhumatoïde.
      libelle: 'J1, J15 : 1 g',
      dose: '1 g IV',
      kind: 'event',
      joursSuivants: [14],
    },
    {
      // Schéma « oncohématologie », repris tel quel par l'essai RAVE dans
      // les vascularites à ANCA (induction) : 4 perfusions hebdomadaires.
      libelle: '375 mg/m² × 4 (J1, J8, J15, J22)',
      dose: '375 mg/m²',
      kind: 'event',
      joursSuivants: [7, 14, 21],
    },
  ],

  cyclophosphamide: [
    {
      // Protocole Euro-Lupus (Euro-Lupus Nephritis Trial) : dose FIXE de
      // 500 mg (non ajustée au poids/surface), toutes les 2 semaines,
      // 6 perfusions au total. Schéma unique et non ambigu.
      libelle: 'Protocole Euro-Lupus : 500 mg IV / 2 sem. × 6',
      dose: '500 mg IV',
      kind: 'event',
      joursSuivants: [14, 28, 42, 56, 70],
    },
    {
      // Protocole NIH : dose variable (0,5-1 g/m², ajustée au nadir
      // leucocytaire) et NOMBRE de cures variable selon la réponse (6 cures
      // mensuelles puis espacement, ou relais azathioprine/MMF — plusieurs
      // variantes selon les séries). On ne génère donc PAS de série de
      // dates : seule la première cure est proposée, au médecin de répéter
      // le clic chaque mois selon la tolérance.
      libelle: 'Protocole NIH : 0,5–1 g/m² IV, 1×/mois (dose à adapter)',
      dose: '0,5–1 g/m² IV',
      kind: 'event',
    },
  ],

  anifrolumab: [
    {
      // SAPHNELO (lupus systémique) : dose fixe, pas de titration.
      // Cité explicitement par le médecin comme « 1 fois par mois ».
      libelle: '300 mg IV / mois',
      dose: '300 mg IV / mois',
      kind: 'continuous',
    },
  ],

  belimumab: [
    {
      // BENLYSTA IV : charge à J1, J15, J29 puis entretien toutes les
      // 4 semaines. On ne propose que la phase de charge (3 dates fixes,
      // non ambiguës) ; l'entretien est l'entrée continue ci-dessous.
      libelle: 'Charge IV 10 mg/kg : J1, J15, J29',
      dose: '10 mg/kg IV',
      kind: 'event',
      joursSuivants: [14, 28],
    },
    {
      // BENLYSTA SC : entretien hebdomadaire, dose fixe unique (200 mg),
      // sans charge SC nécessaire.
      libelle: 'Entretien SC hebdomadaire : 200 mg',
      dose: '200 mg SC / semaine',
      kind: 'continuous',
    },
  ],

  tocilizumab: [
    {
      // Artérite à cellules géantes (GiACTA) : c'est LE schéma qui a valu
      // l'AMM dans cette indication — dose fixe, voie et rythme uniques.
      libelle: 'Artérite à cellules géantes : 162 mg SC / semaine',
      dose: '162 mg SC / semaine',
      kind: 'continuous',
    },
    {
      // Polyarthrite rhumatoïde, voie IV : dose au poids mais rythme fixe
      // et non ambigu (toutes les 4 semaines).
      libelle: 'Polyarthrite rhumatoïde : 8 mg/kg IV / 4 semaines',
      dose: '8 mg/kg IV / 4 semaines',
      kind: 'continuous',
    },
  ],

  avacopan: [
    {
      // TAVNEOS (vascularites à ANCA, essai ADVOCATE) : dose fixe, sans
      // titration ni ajustement.
      libelle: '30 mg × 2/j (matin et soir)',
      dose: '30 mg × 2/j',
      kind: 'continuous',
    },
  ],

  mepolizumab: [
    {
      // NUCALA dans l'EGPA (essai MIRRA) : 300 mg, dose différente de
      // l'indication asthme (100 mg) — précisé dans le libellé pour éviter
      // toute confusion.
      libelle: 'EGPA : 300 mg SC / 4 semaines',
      dose: '300 mg SC / 4 semaines',
      kind: 'continuous',
    },
  ],

  anakinra: [
    {
      // Dose adulte usuelle, commune aux principales indications
      // auto-inflammatoires (fièvre méditerranéenne familiale, maladie de
      // Still, CAPS) : 100 mg/j, sans titration de départ. Certaines
      // situations (Still réfractaire) montent au-delà — non couvert ici.
      libelle: '100 mg SC / jour',
      dose: '100 mg SC / jour',
      kind: 'continuous',
    },
  ],

  golimumab: [
    {
      // SIMPONI : dose fixe adulte, injection mensuelle — schéma le plus
      // simple de tous les anti-TNF (pas de charge).
      libelle: '50 mg SC / mois',
      dose: '50 mg SC / mois',
      kind: 'continuous',
    },
  ],

  igiv: [
    {
      // Formule standard toutes indications (Guillain-Barré, myasthénie,
      // dermatomyosite, certaines vascularites) : 2 g/kg au total, répartis
      // sur 2 à 5 jours selon la tolérance — la dose est une formule
      // (mg/kg), pas un chiffre inventé, et il n'y a qu'une seule cure
      // proposée (pas de série : le rythme des cures suivantes dépend de la
      // réponse clinique).
      libelle: 'Cure : 2 g/kg (réparti sur 2 à 5 j)',
      dose: '2 g/kg',
      kind: 'event',
    },
  ],
};

/** Marque/DCI alternative → clé DCI utilisée dans POSOLOGIES_BASE. */
const ALIASES: Record<string, string> = {
  mabthera: 'rituximab',
  endoxan: 'cyclophosphamide',
  saphnelo: 'anifrolumab',
  benlysta: 'belimumab',
  roactemra: 'tocilizumab',
  tavneos: 'avacopan',
  nucala: 'mepolizumab',
  kineret: 'anakinra',
  simponi: 'golimumab',
  immunoglobulines: 'igiv',
  privigen: 'igiv',
  tegeline: 'igiv',
};

/** Schémas connus pour le nom de médicament tapé (marque ou DCI), sinon []. */
export function posologiesPour(nomMedicament: string): SchemaPosologie[] {
  const n = norm(nomMedicament);
  if (!n) return [];
  if (POSOLOGIES_BASE[n]) return POSOLOGIES_BASE[n];
  const cle = ALIASES[n];
  return cle ? (POSOLOGIES_BASE[cle] ?? []) : [];
}

/** Ajoute `jours` jours à une date ISO ('YYYY-MM-DD'), en UTC (pas de DST). */
export function ajouterJoursISO(iso: string, jours: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + jours));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** Dates ISO de toutes les prises d'un schéma, à partir de la date de départ. */
export function datesDuSchema(startISO: string, schema: SchemaPosologie): string[] {
  const suivants = schema.joursSuivants ?? [];
  return [startISO, ...suivants.map(j => ajouterJoursISO(startISO, j))];
}

// ──────────────────────────────────────────────────────────────
// Médicaments envisagés puis volontairement laissés SANS schéma — détail
// des raisons dans RAPPORT-TRAITEMENTS.md (section 4) :
//   Méthotrexate, azathioprine, mycophénolate, hydroxychloroquine,
//   colchicine : dose individualisée/titrée, pas de « dose standard ».
//   Abatacept IV, éculizumab/ravulizumab, canakinumab : dose qui dépend du
//   poids et/ou de l'indication (plusieurs paliers selon le poids ou la
//   maladie) — pas un schéma unique et non ambigu.
//   Certolizumab, infliximab, adalimumab, ustekinumab, secukinumab :
//   schéma à double phase (charge puis entretien à rythme différent) que
//   je ne suis pas certain de restituer sans erreur pour toutes les
//   indications (RA/PsA/SpA/MICI n'ont pas toujours le même schéma).
//   Sarilumab : indication médecine interne (pseudo-polyarthrite
//   rhizomélique) trop récente pour que je sois sûr du schéma retenu
//   en pratique française.
// ──────────────────────────────────────────────────────────────
