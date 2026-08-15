// Petit bus d'UI partagé (collage global d'image → import, notifications).

export interface Toast {
  id: number;
  text: string;
  kind: 'success' | 'info' | 'error';
  /** Action optionnelle (ex. « Annuler ») affichée dans le toast. */
  action?: { label: string; run: () => void };
}

class UiBus {
  /** Image collée globalement, à traiter par l'onglet Import. */
  pendingImage = $state<File | null>(null);

  /** Notifications éphémères (remplacent les alert()). */
  toasts = $state<Toast[]>([]);
  private toastSeq = 0;
  private timers = new Map<number, ReturnType<typeof setTimeout>>();

  /**
   * Au-delà de ce nombre affiché en même temps, le plus ancien disparaît.
   * Sans plafond, une rafale de notifications (ex. plusieurs dates refusées
   * coup sur coup en tapant) empile un mur rouge qui finit par cacher toute
   * la courbe pendant plusieurs secondes.
   */
  private static readonly MAX_VISIBLES = 3;

  private armer(id: number, ms: number) {
    const h = this.timers.get(id);
    if (h) clearTimeout(h);
    this.timers.delete(id);
    if (ms > 0) this.timers.set(id, setTimeout(() => this.dismissToast(id), ms));
  }

  /**
   * Insère (ou met à jour) une notification. Un message strictement
   * identique déjà affiché ne s'empile pas en double : sa présence est
   * juste reconduite, remontée en position la plus récente et son délai
   * relancé — plutôt que deux bulles superposées disant la même chose.
   */
  private empiler(entry: Omit<Toast, 'id'>, ms: number): number {
    const jumeau = this.toasts.find(t => t.text === entry.text && t.kind === entry.kind);
    const id = jumeau ? jumeau.id : ++this.toastSeq;
    let toasts = [...this.toasts.filter(t => t.id !== id), { id, ...entry }];
    if (toasts.length > UiBus.MAX_VISIBLES) {
      const expulsees = toasts.slice(0, toasts.length - UiBus.MAX_VISIBLES);
      expulsees.forEach(t => this.armer(t.id, 0)); // annule leur minuteur, elles sortent tout de suite
      toasts = toasts.slice(toasts.length - UiBus.MAX_VISIBLES);
    }
    this.toasts = toasts;
    this.armer(id, ms);
    return id;
  }

  toast(text: string, kind: Toast['kind'] = 'success', ms = 2800) {
    return this.empiler({ text, kind }, ms);
  }

  /** Toast avec une action (ex. corbeille « Annuler »). Durée plus longue par défaut. */
  toastAction(text: string, actionLabel: string, run: () => void, kind: Toast['kind'] = 'info', ms = 5000) {
    // Même id que celui que `empiler` va (re)utiliser, pour que l'action de ce
    // toast se réfère bien à lui-même (dedup compris : rejouer une action déjà
    // affichée referme la même bulle).
    const jumeau = this.toasts.find(t => t.text === text && t.kind === kind);
    const id = jumeau ? jumeau.id : this.toastSeq + 1;
    const action = { label: actionLabel, run: () => { run(); this.dismissToast(id); } };
    return this.empiler({ text, kind, action }, ms);
  }
  dismissToast(id: number) {
    this.armer(id, 0);
    this.toasts = this.toasts.filter(t => t.id !== id);
  }

  /** Affichage de la présentation d'accueil. */
  welcomeOpen = $state(false);

  /** Texte tabulé collé globalement (Excel / tableau) → remplissage de la grille. */
  pendingTableText = $state<string | null>(null);

  pasteTable(text: string) { this.pendingTableText = text; }
  consumeTable(): string | null {
    const t = this.pendingTableText;
    this.pendingTableText = null;
    return t;
  }

  pasteImage(file: File) {
    this.pendingImage = file;
  }
  consumeImage(): File | null {
    const f = this.pendingImage;
    this.pendingImage = null;
    return f;
  }
}

export const uiBus = new UiBus();
