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

  toast(text: string, kind: Toast['kind'] = 'success', ms = 2800) {
    const id = ++this.toastSeq;
    this.toasts = [...this.toasts, { id, text, kind }];
    if (ms > 0) setTimeout(() => this.dismissToast(id), ms);
    return id;
  }

  /** Toast avec une action (ex. corbeille « Annuler »). Durée plus longue par défaut. */
  toastAction(text: string, actionLabel: string, run: () => void, kind: Toast['kind'] = 'info', ms = 5000) {
    const id = ++this.toastSeq;
    const action = { label: actionLabel, run: () => { run(); this.dismissToast(id); } };
    this.toasts = [...this.toasts, { id, text, kind, action }];
    if (ms > 0) setTimeout(() => this.dismissToast(id), ms);
    return id;
  }
  dismissToast(id: number) {
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
