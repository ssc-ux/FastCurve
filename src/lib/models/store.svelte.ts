import type {
  StudyState, Parameter, Measurement, Treatment, Settings, ParamCategory, EfrDisplay,
  Annotation, Template,
} from './types';
import { uid, SERIES_COLORS, TREATMENT_COLORS } from './types';
import { matchCatalog, type CatalogEntry } from './catalog';

// Un seul document de travail. Le navigateur le retrouve à la réouverture ;
// pour le garder ou le reprendre ailleurs, on exporte un fichier .json.
const ETUDE_KEY = 'fastcurve.etude.v1';
const TEMPLATES_KEY = 'fastcurve.templates.v1';
const WIPE_PENDING_KEY = 'fastcurve.wipePending.v1';
// Anciennes clés, lues une seule fois pour reprendre le travail existant.
const LEGACY_KEY = 'fastcurve.study.v1';
const LEGACY_DOSSIERS = 'fastcurve.dossiers.v1';
const LEGACY_CURRENT = 'fastcurve.current.v1';
const legacyDossierKey = (id: string) => `fastcurve.dossier.${id}`;

export function nomEtude(study: StudyState): string {
  return (study.patientLabel || '').trim() || (study.settings?.title || '').trim() || 'Sans titre';
}

function defaultSettings(): Settings {
  return {
    chartMode: 'stacked',
    title: 'Suivi biologique',
    subtitle: '',
    // Décision explicite du médecin : les bandes de normale et le marquage
    // « hors-norme » sont retirés par défaut. Une seule borne générique par
    // analyte (le catalogue n'a pas le sexe/l'âge du patient) est trop
    // grossière pour un jugement clinique ; mieux vaut que le médecin lise la
    // valeur lui-même que de laisser une bande potentiellement fausse dicter
    // une lecture. Il les réactive lui-même dans le menu Affichage s'il en a
    // besoin sur un suivi donné.
    showReference: false,
    showLegend: true,
    showValues: false,
    timeAxis: true,
    markOutOfRange: false,
  };
}

function emptyStudy(): StudyState {
  return {
    version: 1,
    patientLabel: '',
    parameters: [],
    measurements: [],
    treatments: [],
    annotations: [],
    settings: defaultSettings(),
    extraDates: [],
  };
}

class Store {
  study = $state<StudyState>(emptyStudy());
  history = $state<string[]>([]);

  /** Message d'erreur de sauvegarde (null = tout va bien). Consommé par l'UI. */
  saveError = $state<string | null>(null);

  /** Horodatage de la dernière reprise d'une modification faite dans un autre onglet. */
  externalReload = $state(0);

  constructor() {
    this.boot();
    this.watchOtherTabs();
  }

  /**
   * Deux onglets ouverts : chacun garde son étude en mémoire et écrase le
   * stockage au prochain enregistrement. Sans cette écoute, la saisie faite
   * dans le premier onglet disparaît dès que le second enregistre — en
   * silence. On adopte donc la version de l'autre onglet dès qu'elle arrive,
   * avant d'avoir la moindre chance de l'écraser.
   */
  private watchOtherTabs() {
    if (typeof window === 'undefined') return;
    window.addEventListener('storage', (e) => {
      if (!e.key || e.key !== ETUDE_KEY || !e.newValue) return;
      try {
        const externe = this.mergeDefaults(JSON.parse(e.newValue) as StudyState);
        if (JSON.stringify(externe) === JSON.stringify(this.study)) return;
        this.study = externe;
        this.externalReload = Date.now();
      } catch { /* contenu illisible : on garde l'état courant */ }
    });
  }

  // ── Historique / annulation-rétablissement (anti-perte de données) ──
  future = $state<string[]>([]);

  private dernierSnapCle = '';
  private dernierSnapAt = 0;
  private enGroupe = false;

  /**
   * `cle` regroupe les instantanés d'une même édition : taper « 4242 » dans une
   * cellule enregistre à chaque caractère, mais ne doit produire qu'UN seul
   * point d'annulation, sinon Ctrl+Z revient caractère par caractère.
   */
  private snap(cle?: string) {
    if (this.enGroupe) return; // le point d'annulation du groupe a déjà été pris
    const maintenant = Date.now();
    if (cle && cle === this.dernierSnapCle && maintenant - this.dernierSnapAt < 2000) {
      this.dernierSnapAt = maintenant;
      return;
    }
    this.dernierSnapCle = cle ?? '';
    this.dernierSnapAt = maintenant;
    this.snapImmediat();
  }

  private snapImmediat() {
    try {
      this.history.push(JSON.stringify(this.study));
      if (this.history.length > 100) this.history.shift();
      this.future = []; // toute nouvelle action invalide le « rétablir »
    } catch { /* ignore */ }
  }

  /**
   * Exécute plusieurs écritures sous UN SEUL point d'annulation.
   *
   * Sans cela, coller douze valeurs ou créer douze colonnes empile douze
   * instantanés : le bouton « Annuler » du bandeau ne défait que la dernière
   * écriture et laisse les onze autres en place — le médecin croit avoir tout
   * annulé alors que la grille reste à moitié modifiée.
   */
  groupe<T>(fn: () => T): T {
    if (this.enGroupe) return fn();
    this.snapImmediat();
    this.dernierSnapCle = '';
    this.enGroupe = true;
    try {
      return fn();
    } finally {
      this.enGroupe = false;
      this.save();
    }
  }

  get canUndo(): boolean {
    return this.history.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }

  undo() {
    const prev = this.history.pop();
    if (prev == null) return;
    this.dernierSnapCle = ''; // une édition après annulation repart d'un point neuf
    try {
      this.future.push(JSON.stringify(this.study));
      this.study = JSON.parse(prev);
      this.save();
    } catch { /* ignore */ }
  }

  redo() {
    const next = this.future.pop();
    if (next == null) return;
    this.dernierSnapCle = '';
    try {
      this.history.push(JSON.stringify(this.study));
      this.study = JSON.parse(next);
      this.save();
    } catch { /* ignore */ }
  }

  // ── Persistance du document ──────────────────
  private mergeDefaults(parsed: StudyState): StudyState {
    return {
      ...emptyStudy(),
      ...parsed,
      settings: { ...defaultSettings(), ...(parsed.settings || {}) },
    };
  }

  private flagSaveError(e: unknown) {
    console.warn('Sauvegarde échouée', e);
    const isQuota = e instanceof DOMException &&
      (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED');
    this.saveError = isQuota
      ? "Espace de stockage saturé : impossible d'enregistrer. Enregistrez le fichier (.json) pour ne rien perdre."
      : "Enregistrement impossible dans ce navigateur (navigation privée ou stockage bloqué). Enregistrez le fichier (.json) pour ne rien perdre.";
  }

  /** Démarrage : reprend le document du navigateur, ou l'ancien format. */
  private boot() {
    this.maybeWipeOnBoot();
    const repris = this.lireDocument() ?? this.reprendreAncienFormat();
    this.study = repris ?? emptyStudy();
  }

  private lireDocument(): StudyState | null {
    try {
      const raw = localStorage.getItem(ETUDE_KEY);
      return raw ? this.mergeDefaults(JSON.parse(raw) as StudyState) : null;
    } catch (e) {
      console.warn('Lecture du document échouée', e);
      return null;
    }
  }

  /**
   * Reprise unique de l'ancien stockage multi-dossiers : on ouvre le dossier le
   * plus récemment modifié, puis on nettoie. Personne ne doit perdre son travail
   * parce que l'application a changé de modèle.
   */
  private reprendreAncienFormat(): StudyState | null {
    try {
      let repris: StudyState | null = null;
      const rawIndex = localStorage.getItem(LEGACY_DOSSIERS);
      const index = rawIndex ? (JSON.parse(rawIndex) as { id: string; updatedAt: number }[]) : [];
      if (Array.isArray(index) && index.length) {
        const courant = localStorage.getItem(LEGACY_CURRENT);
        const choisi = index.find(d => d.id === courant)
          ?? [...index].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0];
        const raw = choisi ? localStorage.getItem(legacyDossierKey(choisi.id)) : null;
        if (raw) repris = this.mergeDefaults(JSON.parse(raw) as StudyState);
        for (const d of index) localStorage.removeItem(legacyDossierKey(d.id));
        localStorage.removeItem(LEGACY_DOSSIERS);
        localStorage.removeItem(LEGACY_CURRENT);
      }
      if (!repris) {
        const raw = localStorage.getItem(LEGACY_KEY);
        if (raw) repris = this.mergeDefaults(JSON.parse(raw) as StudyState);
      }
      localStorage.removeItem(LEGACY_KEY);
      if (repris) { this.study = repris; this.save(); }
      return repris;
    } catch {
      return null;
    }
  }

  private persistCurrent(): boolean {
    try {
      localStorage.setItem(ETUDE_KEY, JSON.stringify(this.study));
      return true;
    } catch (e) {
      this.flagSaveError(e);
      return false;
    }
  }

  /** Horodatage de la dernière sauvegarde réussie (indicateur « ✓ Enregistré »). */
  savedAt = $state(0);

  /** Enregistre le document dans ce navigateur. */
  /** Incrémenté à chaque écriture : sert à invalider l'index des mesures. */
  #rev = 0;

  save() {
    this.#rev++;
    if (!this.persistCurrent()) return;
    this.saveError = null;
    this.savedAt = Date.now();
  }

  /** Repart d'un document vierge. */
  nouvelleEtude() {
    this.study = emptyStudy();
    this.history = []; this.future = [];
    this.saveError = null;
    this.save();
  }

  // ── Paramètres ───────────────────────────────
  private nextOrder(): number {
    return this.study.parameters.length
      ? Math.max(...this.study.parameters.map(p => p.order)) + 1
      : 0;
  }

  private assignColor(): string {
    const used = new Set(this.study.parameters.map(p => p.color).filter(Boolean));
    for (const c of SERIES_COLORS) if (!used.has(c)) return c;
    return SERIES_COLORS[this.study.parameters.length % SERIES_COLORS.length];
  }

  /** Trouve un paramètre par nom (insensible à la casse/accents). */
  findParameterByName(name: string): Parameter | undefined {
    const n = name.trim().toLowerCase();
    return this.study.parameters.find(p => p.name.trim().toLowerCase() === n);
  }

  addParameter(input: Partial<Parameter> & { name: string }): Parameter {
    this.snap();
    const cat: ParamCategory = input.category || 'libre';
    const p: Parameter = {
      id: uid(),
      name: input.name,
      unit: input.unit ?? '',
      category: cat,
      refLow: input.refLow ?? null,
      refHigh: input.refHigh ?? null,
      // Par défaut on affiche l'unité déclarée (L, mmol/min/kPa…). Basculer un
      // EFR en « % théorique » d'office étiquetterait l'axe en pourcentage
      // alors que les valeurs saisies sont dans l'unité du catalogue.
      display: input.display ?? 'absolute',
      color: input.color ?? this.assignColor(),
      order: input.order ?? this.nextOrder(),
    };
    this.study.parameters.push(p);
    this.save();
    return p;
  }

  /** Ajoute depuis une entrée du catalogue si absente, retourne le paramètre. */
  addFromCatalog(entry: CatalogEntry): Parameter {
    const existing = this.findParameterByName(entry.name);
    if (existing) return existing;
    return this.addParameter({
      name: entry.name,
      unit: entry.unit,
      category: entry.category,
      refLow: entry.refLow ?? null,
      refHigh: entry.refHigh ?? null,
    });
  }

  /**
   * Retrouve ou crée un paramètre à partir d'un nom brut (import/OCR).
   * Tente le catalogue puis crée un paramètre libre.
   */
  resolveParameter(rawName: string, unitHint?: string): Parameter {
    const existing = this.findParameterByName(rawName);
    if (existing) return existing;
    const cat = matchCatalog(rawName);
    if (cat) return this.addFromCatalog(cat);
    return this.addParameter({ name: rawName.trim(), unit: unitHint ?? '', category: 'libre' });
  }

  updateParameter(id: string, patch: Partial<Parameter>) {
    const p = this.study.parameters.find(x => x.id === id);
    if (!p) return;
    this.snap();
    Object.assign(p, patch);
    this.save();
  }

  removeParameter(id: string) {
    this.snap();
    this.study.parameters = this.study.parameters.filter(p => p.id !== id);
    this.study.measurements = this.study.measurements.filter(m => m.parameterId !== id);
    this.save();
  }

  setParameterDisplay(id: string, display: EfrDisplay) {
    this.updateParameter(id, { display });
  }

  /**
   * Associe (ou dissocie) un paramètre à un groupe de panneau partagé — le
   * geste du médecin pour dire « ces deux-là vont sur le même graphique ».
   *
   * `targetId` null : le paramètre reprend son panneau à lui.
   * `targetId` = id d'un autre paramètre : il rejoint le groupe de ce
   * paramètre (créé au besoin, à partir de l'id du paramètre cible — donc
   * stable, pas de nouvel identifiant à faire circuler).
   */
  groupParameterWith(paramId: string, targetId: string | null) {
    const p = this.study.parameters.find(x => x.id === paramId);
    if (!p) return;
    this.snap();
    if (!targetId || targetId === paramId) {
      p.panelGroup = null;
    } else {
      const target = this.study.parameters.find(x => x.id === targetId);
      if (!target) return;
      const groupId = target.panelGroup || target.id;
      target.panelGroup = groupId;
      p.panelGroup = groupId;
    }
    this.save();
  }

  // ── Mesures ──────────────────────────────────
  /** Insère ou remplace la mesure (param, date). */
  setMeasurement(parameterId: string, date: string, value: number | null, qualifier?: '<' | '>' | null) {
    this.snap(`mesure:${parameterId}:${date}`);
    const idx = this.study.measurements.findIndex(m => m.parameterId === parameterId && m.date === date);
    if (value === null || Number.isNaN(value)) {
      if (idx >= 0) this.study.measurements.splice(idx, 1);
      this.save();
      return;
    }
    if (idx >= 0) {
      this.study.measurements[idx].value = value;
      this.study.measurements[idx].qualifier = qualifier ?? null;
    } else {
      this.study.measurements.push({ id: uid(), parameterId, date, value, qualifier: qualifier ?? null });
    }
    this.save();
  }

  removeMeasurement(parameterId: string, date: string) {
    this.snap();
    this.study.measurements = this.study.measurements.filter(
      m => !(m.parameterId === parameterId && m.date === date),
    );
    this.save();
  }

  /** Toutes les dates distinctes présentes, triées chronologiquement. */
  get dates(): string[] {
    const set = new Set(this.study.measurements.map(m => m.date));
    return [...set].sort();
  }

  /** Colonnes affichées : dates avec valeur + colonnes vides ajoutées. */
  get columnDates(): string[] {
    return [...new Set([...this.dates, ...(this.study.extraDates || [])])].sort();
  }

  /** Ajoute une colonne de date vide (persistée). */
  addDateColumn(iso: string) {
    if (!iso) return;
    if (!this.study.extraDates.includes(iso) && !this.dates.includes(iso)) {
      this.snap();
      this.study.extraDates = [...this.study.extraDates, iso];
      this.save();
    }
  }

  /** Supprime une colonne : efface les mesures de cette date + la colonne vide. */
  removeDateColumn(iso: string) {
    this.snap();
    this.study.measurements = this.study.measurements.filter(m => m.date !== iso);
    this.study.extraDates = this.study.extraDates.filter(x => x !== iso);
    this.save();
  }

  /**
   * Change la date d'une colonne : déplace TOUTES les mesures (valeur, %, seuil)
   * de oldIso vers newIso. Si newIso a déjà des valeurs, les mesures existantes
   * y sont conservées (pas d'écrasement silencieux ligne par ligne).
   *
   * Retourne le nombre de mesures perdues par collision, pour que l'appelant
   * puisse le signaler : sans cela, des valeurs cliniques disparaissent sans
   * un mot à l'écran.
   */
  moveDate(oldIso: string, newIso: string): number {
    if (!newIso || newIso === oldIso) return 0;
    this.snap();
    let perdues = 0;
    for (const m of this.study.measurements) {
      if (m.date !== oldIso) continue;
      const clash = this.study.measurements.find(x => x.parameterId === m.parameterId && x.date === newIso);
      if (clash) { perdues++; continue; } // la date cible a déjà une valeur pour ce paramètre : on la conserve
      m.date = newIso;
    }
    // Toute mesure restée sur oldIso (collision) est retirée
    this.study.measurements = this.study.measurements.filter(m => m.date !== oldIso);
    // Report de la colonne vide ; on ne garde dans extraDates que les colonnes sans valeur
    const remapped = this.study.extraDates.map(x => (x === oldIso ? newIso : x));
    const withValue = new Set(this.dates);
    this.study.extraDates = [...new Set(remapped)].filter(x => !withValue.has(x));
    this.save();
    return perdues;
  }

  measurementsFor(parameterId: string): Measurement[] {
    return this.study.measurements
      .filter(m => m.parameterId === parameterId)
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Index paramètre+date → mesure, reconstruit quand les mesures changent.
   *
   * `valueAt` est appelé une fois par cellule à chaque rendu de la grille ; en
   * parcourant la liste il coûtait O(cellules × mesures). Mesuré à 12
   * paramètres × 80 dates, c'était 95% du délai ressenti à la frappe — 270 ms
   * par caractère. L'index ramène chaque lecture à un accès direct.
   */
  #index = new Map<string, Measurement>();
  #indexSource: Measurement[] | null = null;
  #indexRev = -1;

  private indexMesures(): Map<string, Measurement> {
    // Le tableau est remplacé à chaque modification (jamais muté en place) :
    // comparer la référence suffit à savoir si l'index est encore valable.
    // Deux invalidations, car les deux cas existent. `setMeasurement` modifie le
    // tableau EN PLACE (push / splice) : la référence ne bouge pas, c'est le
    // compteur bougé par `save()` qui rattrape. Annuler, rétablir ou ouvrir un
    // fichier remplacent l'étude entière sans passer par là : c'est la
    // référence qui rattrape. Se fier à un seul des deux laisserait l'index
    // périmé, et la grille afficherait de vieilles valeurs en silence.
    if (this.#indexSource !== this.study.measurements || this.#indexRev !== this.#rev) {
      this.#index = new Map();
      for (const m of this.study.measurements) this.#index.set(`${m.parameterId} ${m.date}`, m);
      this.#indexSource = this.study.measurements;
      this.#indexRev = this.#rev;
    }
    return this.#index;
  }

  valueAt(parameterId: string, date: string): Measurement | undefined {
    return this.indexMesures().get(`${parameterId} ${date}`);
  }

  // ── Traitements ──────────────────────────────
  addTreatment(input: Partial<Treatment> & { name: string; start: string }): Treatment {
    this.snap();
    const used = new Set(this.study.treatments.map(t => t.color).filter(Boolean));
    let color = input.color ?? null;
    if (!color) {
      // Un traitement de même nom (ex. cures répétées) garde la même couleur.
      const sameName = this.study.treatments.find(t => t.name.trim().toLowerCase() === input.name.trim().toLowerCase() && t.color);
      if (sameName) color = sameName.color!;
      else color = TREATMENT_COLORS.find(c => !used.has(c)) ?? TREATMENT_COLORS[this.study.treatments.length % TREATMENT_COLORS.length];
    }
    const t: Treatment = {
      id: uid(),
      name: input.name,
      dose: input.dose ?? '',
      kind: input.kind ?? 'continuous',
      start: input.start,
      end: input.end ?? null,
      dosePoints: input.dosePoints ?? undefined,
      doseUnit: input.doseUnit ?? 'mg/j',
      color,
      order: input.order ?? (this.study.treatments.length ? Math.max(...this.study.treatments.map(x => x.order)) + 1 : 0),
    };
    this.study.treatments.push(t);
    this.save();
    return t;
  }

  updateTreatment(id: string, patch: Partial<Treatment>) {
    const t = this.study.treatments.find(x => x.id === id);
    if (!t) return;
    this.snap();
    Object.assign(t, patch);
    this.save();
  }

  removeTreatment(id: string) {
    this.snap();
    this.study.treatments = this.study.treatments.filter(t => t.id !== id);
    this.save();
  }

  // ── Annotations libres ───────────────────────
  addAnnotation(input: { date: string; text: string }): Annotation {
    this.snap();
    const a: Annotation = {
      id: uid(), date: input.date, text: input.text,
      order: this.study.annotations.length ? Math.max(...this.study.annotations.map(x => x.order)) + 1 : 0,
    };
    this.study.annotations.push(a);
    this.save();
    return a;
  }
  updateAnnotation(id: string, patch: Partial<Annotation>) {
    const a = this.study.annotations.find(x => x.id === id);
    if (!a) return;
    this.snap();
    Object.assign(a, patch);
    this.save();
  }
  removeAnnotation(id: string) {
    this.snap();
    this.study.annotations = this.study.annotations.filter(a => a.id !== id);
    this.save();
  }

  // ── Modèles de suivi réutilisables ───────────
  listTemplates(): Template[] {
    try {
      const raw = localStorage.getItem(TEMPLATES_KEY);
      return raw ? (JSON.parse(raw) as Template[]) : [];
    } catch {
      return [];
    }
  }
  private saveTemplates(list: Template[]) {
    try { localStorage.setItem(TEMPLATES_KEY, JSON.stringify(list)); } catch { /* ignore */ }
  }
  saveTemplate(name: string): Template {
    const tpl: Template = {
      id: uid(), name: name.trim(),
      parameters: [...this.study.parameters]
        .sort((a, b) => a.order - b.order)
        .map(p => ({ name: p.name, unit: p.unit, category: p.category, refLow: p.refLow ?? null, refHigh: p.refHigh ?? null, display: p.display })),
    };
    const list = this.listTemplates();
    list.push(tpl);
    this.saveTemplates(list);
    return tpl;
  }
  applyTemplate(id: string) {
    const tpl = this.listTemplates().find(t => t.id === id);
    if (!tpl) return;
    this.snap();
    for (const p of tpl.parameters) {
      if (!this.findParameterByName(p.name)) {
        this.addParameter({ name: p.name, unit: p.unit, category: p.category, refLow: p.refLow ?? null, refHigh: p.refHigh ?? null, display: p.display });
      }
    }
  }
  deleteTemplate(id: string) {
    this.saveTemplates(this.listTemplates().filter(t => t.id !== id));
  }

  // ── Confidentialité (préférences locales) ────
  clearOnExit = $state<boolean>(this.readClearOnExit());

  private readClearOnExit(): boolean {
    try { return localStorage.getItem('fastcurve.clearOnExit.v1') === '1'; } catch { return false; }
  }
  setClearOnExit(on: boolean) {
    this.clearOnExit = on;
    try { localStorage.setItem('fastcurve.clearOnExit.v1', on ? '1' : '0'); } catch { /* ignore */ }
    if (!on) { try { localStorage.removeItem(WIPE_PENDING_KEY); } catch { /* ignore */ } }
  }

  /**
   * À la fermeture de l'onglet, on ARME une purge (sans effacer tout de suite).
   * Un simple rechargement (F5) sera détecté au prochain démarrage et n'effacera
   * rien — seule une vraie fermeture déclenche la purge.
   */
  armExitWipe() {
    try { localStorage.setItem(WIPE_PENDING_KEY, '1'); } catch { /* ignore */ }
  }

  /** Au démarrage : purge seulement si la sortie précédente était une vraie fermeture. */
  private maybeWipeOnBoot() {
    try {
      if (localStorage.getItem(WIPE_PENDING_KEY) !== '1') return;
      localStorage.removeItem(WIPE_PENDING_KEY);
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      if (nav?.type === 'reload') return; // simple rechargement → on conserve le document
      this.wipeAll(); // la sortie précédente était une fermeture → purge
    } catch { /* ignore */ }
  }

  /** Efface le document de ce navigateur (option « effacer à la fermeture »). */
  wipeAll() {
    try {
      localStorage.removeItem(ETUDE_KEY);
      localStorage.removeItem(LEGACY_KEY);
      localStorage.removeItem(LEGACY_DOSSIERS);
      localStorage.removeItem(LEGACY_CURRENT);
    } catch { /* ignore */ }
  }

  // ── Réglages ─────────────────────────────────
  updateSettings(patch: Partial<Settings>) {
    Object.assign(this.study.settings, patch);
    this.save();
  }

  setPatientLabel(label: string) {
    this.study.patientLabel = label;
    this.save();
  }

  // ── Import / export JSON ─────────────────────
  exportJSON(): string {
    return JSON.stringify(this.study, null, 2);
  }

  /** Ouvre un fichier .json : il devient le document de travail. */
  importJSON(json: string): boolean {
    try {
      const parsed = JSON.parse(json) as StudyState;
      if (!parsed || !Array.isArray(parsed.parameters)) return false;
      this.study = this.mergeDefaults(parsed);
      this.history = []; this.future = [];
      this.save();
      return true;
    } catch {
      return false;
    }
  }

  clearAll() {
    this.snap();
    this.study = emptyStudy();
    this.save();
  }

  clearData() {
    this.snap();
    this.study.measurements = [];
    this.study.treatments = [];
    this.study.extraDates = [];
    this.save();
  }
}

export const store = new Store();
