// ──────────────────────────────────────────────────────────────
// RÈGLES CLAVIER PARTAGÉES et liste des raccourcis (aide « ? »).
// ──────────────────────────────────────────────────────────────

/** La touche vient-elle d'un champ de saisie (où Entrée/Échap ont leur sens propre) ? */
export function dansChamp(el: EventTarget | null): boolean {
  const t = (el as HTMLElement | null)?.tagName;
  return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT';
}

/**
 * Écran de vérification (collage, capture) : Entrée = valider, mais jamais
 * depuis un champ (il y faut Ctrl+Entrée) ; Échap dans un champ rend le
 * focus, Échap hors champ annule (réversible).
 */
export function toucheVerification(
  e: KeyboardEvent,
  actions: { valider: () => void; annuler: () => void; peutValider: boolean },
): void {
  const el = e.target as HTMLElement | null;
  const champ = dansChamp(el);
  if (e.key === 'Enter') {
    const voulu = champ ? (e.ctrlKey || e.metaKey) : (!e.shiftKey && !e.ctrlKey && !e.metaKey);
    if (voulu && actions.peutValider) { e.preventDefault(); actions.valider(); }
  } else if (e.key === 'Escape') {
    if (champ) { el!.blur(); return; }
    e.preventDefault();
    actions.annuler();
  }
}

/** Raccourcis affichés dans l'aide (touche « ? »). */
export const RACCOURCIS: { touches: string; action: string }[] = [
  { touches: 'Ctrl+V', action: 'Coller une capture d’écran ou un tableau (n’importe où)' },
  { touches: 'Ctrl+E · Ctrl+Maj+C', action: 'Copier la courbe' },
  { touches: 'Ctrl+Z', action: 'Annuler' },
  { touches: 'Ctrl+Maj+Z · Ctrl+Y', action: 'Rétablir' },
  { touches: 'Entrée · Tab · flèches', action: 'Se déplacer dans la grille de saisie' },
  { touches: 'Ctrl+Suppr', action: 'Supprimer la date (dans son en-tête de colonne)' },
  { touches: 'Entrée (hors champ) · Ctrl+Entrée', action: 'Valider un écran de vérification' },
  { touches: 'Échap', action: 'Quitter le champ, puis annuler la vérification' },
  { touches: '?', action: 'Afficher cette aide' },
];
