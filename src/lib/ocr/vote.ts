// ──────────────────────────────────────────────────────────────
// Vote entre plusieurs lectures d'une même case (agrandissements différents).
// Extrait de pipeline.ts ; module pur, aucune dépendance DOM.
// ──────────────────────────────────────────────────────────────



/** Hauteurs cibles (px) du texte agrandi ; la première est la lecture de référence. */
export const AGRANDISSEMENTS_VALEUR = [68, 44, 96];

export interface LectureVotee { texte: string; confiance: number; desaccord: boolean; unanime?: boolean; }

// Un résultat de laboratoire n'a jamais plus de six chiffres avant la
// virgule : « 2005201907 » est un numéro de demande, pas une valeur.
export const NOMBRE_LU = /^[<>]?\d{1,6}(\.\d+)?$/;
export const normaliserLecture = (t: string) => t.replace(/\s+/g, '').replace(',', '.');

/**
 * Retient la lecture majoritaire (à égalité : la plus confiante). Une lecture
 * vide ne vote pas, sauf si toutes le sont. `desaccord` quand aucune lecture
 * n'obtient la majorité absolue.
 */
export function voter(lectures: { texte: string; confiance: number }[]): LectureVotee {
  const nonVides = lectures.filter(l => normaliserLecture(l.texte));
  // Seule une lecture qui forme un nombre vote (« << » n'est pas un résultat) ;
  // à défaut d'aucune, on garde les lectures brutes pour la suite de la chaîne.
  const valides = nonVides.filter(l => NOMBRE_LU.test(normaliserLecture(l.texte)));
  const pleines = valides.length ? valides : nonVides;
  if (!pleines.length) return { texte: lectures[0]?.texte ?? '', confiance: lectures[0]?.confiance ?? 0, desaccord: false };
  const groupes = new Map<string, { n: number; conf: number; lecture: { texte: string; confiance: number } }>();
  for (const l of pleines) {
    const k = normaliserLecture(l.texte);
    const g = groupes.get(k);
    if (g) { g.n++; g.conf += l.confiance; if (l.confiance > g.lecture.confiance) g.lecture = l; }
    else groupes.set(k, { n: 1, conf: l.confiance, lecture: l });
  }
  const tri = [...groupes.values()].sort((a, b) => b.n - a.n || b.conf / b.n - a.conf / a.n);
  const gagnant = tri[0];
  return {
    texte: gagnant.lecture.texte, confiance: gagnant.conf / gagnant.n,
    desaccord: pleines.length > 1 && gagnant.n * 2 <= pleines.length,
    unanime: valides.length === lectures.length && groupes.size === 1,
  };
}

// ── 3. La chaîne ────────────────────────────────────────────────
