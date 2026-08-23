<script lang="ts">
  import { tick } from 'svelte';
  import { store } from '../../lib/models/store.svelte';
  import { CATALOG, type CatalogEntry, normalize } from '../../lib/models/catalog';
  import { formatDate, lireDateSouple, todayISO, type DateLue } from '../../lib/models/types';
  import { uiBus } from '../../lib/models/ui.svelte';
  import { parseGridPaste } from '../../lib/text/gridPaste';
  import ParamEditor from './ParamEditor.svelte';
  import ImportTab from './ImportTab.svelte';

  let selectedId = $state<string | null>(null);

  // Vue « Saisir » (grille) ou « Importer » (capture / dictée biologique)
  let mode = $state<'saisir' | 'importer'>('saisir');
  let importInitial = $state<'photo' | 'dictee'>('photo');
  function openImport(kind: 'photo' | 'dictee') { importInitial = kind; mode = 'importer'; }

  // Collage global d'image → bascule automatiquement en import
  $effect(() => {
    if (uiBus.pendingImage) { importInitial = 'photo'; mode = 'importer'; }
  });

  // ── Vérification d'un tableau collé (avant écriture) ──
  type PasteReview = {
    dates: string[]; // ISO éditables
    rows: { include: boolean; name: string; values: (number | null)[]; qualifiers: ('<' | '>' | null)[] }[];
  };
  let pasteReview = $state<PasteReview | null>(null);

  // Colonnes portant une valeur (ligne incluse) mais sans date → bloquent l'ajout
  const pasteMissingCols = $derived.by(() => {
    const cols = new Set<number>();
    if (!pasteReview) return cols;
    for (const r of pasteReview.rows) {
      if (!r.include) continue;
      r.values.forEach((v, i) => { if (v !== null && !pasteReview!.dates[i]) cols.add(i); });
    }
    return cols;
  });
  const pasteHasMissing = $derived(pasteMissingCols.size > 0);

  /**
   * Collage d'un tableau (Excel / texte).
   *
   * Si TOUTES les dates de l'en-tête ont été comprises, on écrit directement
   * dans la grille : l'écran de vérification n'apporte rien et coûte un geste
   * de plus à chaque collage (grief n°2, point 5). Un « Annuler » dans le
   * bandeau rattrape le collage du mauvais bloc. L'écran de vérification n'est
   * conservé que pour le cas où une date manque — c'est la seule chose que le
   * médecin doit alors corriger.
   */
  $effect(() => {
    if (!uiBus.pendingTableText) return;
    const text = uiBus.consumeTable();
    if (!text) return;
    const grid = parseGridPaste(text);
    if (!grid) { uiBus.toast("Collage non reconnu comme tableau. Copiez les cellules avec une ligne d'en-tête de dates.", 'error'); return; }
    mode = 'saisir';
    const toutesDates = grid.dates.length > 0 && grid.dates.every(d => !!d);
    if (toutesDates) {
      ecrireCollage(grid.rows.map(r => ({ ...r, include: true })), grid.dates, true);
      return;
    }
    pasteReview = {
      dates: [...grid.dates],
      rows: grid.rows.map(r => ({ include: true, name: r.name, values: r.values, qualifiers: r.qualifiers })),
    };
  });

  function cancelPaste() {
    if (!pasteReview) return;
    const kept = pasteReview;
    pasteReview = null;
    uiBus.toastAction('Collage annulé.', 'Annuler', () => { pasteReview = kept; });
  }

  // C8 : mêmes règles clavier sûres que l'écran OCR (Entrée hors champ / Ctrl+Entrée, Échap réversible).
  function onPasteReviewKey(e: KeyboardEvent) {
    if (!pasteReview) return;
    const el = e.target as HTMLElement | null;
    const inField = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
    if (e.key === 'Enter') {
      const commitWanted = inField ? (e.ctrlKey || e.metaKey) : (!e.shiftKey && !e.ctrlKey && !e.metaKey);
      if (commitWanted && !pasteHasMissing) { e.preventDefault(); commitPaste(); }
    } else if (e.key === 'Escape') {
      if (inField) { (el as HTMLInputElement).blur(); return; }
      e.preventDefault(); cancelPaste();
    }
  }

  type LigneCollee = { include: boolean; name: string; values: (number | null)[]; qualifiers: ('<' | '>' | null)[] };

  /** Écrit un tableau collé sous UN seul point d'annulation (voir store.groupe). */
  function ecrireCollage(rows: LigneCollee[], dates: string[], direct: boolean) {
    let added = 0;
    store.groupe(() => {
      for (const r of rows) {
        if (!r.include || !r.name.trim()) continue;
        const param = store.resolveParameter(r.name.trim());
        r.values.forEach((v, i) => {
          const d = dates[i];
          if (d && v !== null) { store.setMeasurement(param.id, d, v, r.qualifiers[i] ?? null); added++; }
        });
      }
    });
    uiBus.toastAction(
      direct
        ? `${added} valeur(s) ajoutée(s) depuis le tableau collé.`
        : `${added} valeur(s) ajoutée(s).`,
      'Annuler', () => store.undo(), 'success', 8000,
    );
  }

  function commitPaste() {
    if (!pasteReview || pasteHasMissing) return;
    const { rows, dates } = pasteReview;
    pasteReview = null;
    ecrireCollage(rows, dates, false);
  }

  const params = $derived([...store.study.parameters].sort((a, b) => a.order - b.order));
  const selected = $derived(params.find(p => p.id === selectedId) ?? null);

  // ── Identité stable des colonnes ──────────────────────────────
  // La date d'une colonne CHANGE pendant qu'on la saisit ; elle ne peut donc pas
  // servir de clé `{#each}`. Keyée par la date, la colonne était détruite puis
  // recréée à chaque modification : le champ perdait le focus au milieu de la
  // frappe et la suite des chiffres partait dans le vide (voir RAPPORT-GRILLE).
  // On donne donc à chaque colonne une clé qui lui survit : Svelte DÉPLACE le
  // nœud au lieu de le refabriquer, le focus et le curseur restent en place.
  let cleParDate = new Map<string, string>();
  let compteurCle = 0;
  const colonnes = $derived.by(() => {
    const dates = store.columnDates;
    const vivantes = new Map<string, string>();
    const liste = dates.map(d => {
      const cle = cleParDate.get(d) ?? `col${++compteurCle}`;
      vivantes.set(d, cle);
      return { cle, date: d };
    });
    cleParDate = vivantes; // les clés des dates disparues ne s'accumulent pas
    return liste;
  });
  const columns = $derived(colonnes.map(c => c.date));

  /** Transfère la clé d'une colonne vers sa nouvelle date, pour que le nœud DOM
   *  (et donc le focus) survive au déplacement. */
  function reporterCle(ancienne: string, nouvelle: string) {
    const cle = cleParDate.get(ancienne);
    if (!cle) return;
    cleParDate.delete(ancienne);
    cleParDate.set(nouvelle, cle); // écrase la clé de la colonne fusionnée : il n'en reste qu'une
  }

  function unitOf(p: { id: string }): string {
    const param = store.study.parameters.find(x => x.id === p.id)!;
    return param.category === 'efr' && param.display === 'percent' ? '% théo.' : param.unit;
  }

  function cellValue(pId: string, date: string): string {
    const m = store.valueAt(pId, date);
    if (!m) return '';
    return (m.qualifier ?? '') + m.value;
  }
  /** Écrit la cellule sans rien annoncer. Appelé à chaque frappe : le store
   *  regroupe les instantanés d'une même cellule en un seul point d'annulation. */
  function ecrireCellule(pId: string, date: string, raw: string) {
    const t = raw.trim();
    if (t === '') { store.setMeasurement(pId, date, null); return; }
    let qualifier: '<' | '>' | null = null;
    let rest = t;
    if (t[0] === '<' || t[0] === '>') { qualifier = t[0] as '<' | '>'; rest = t.slice(1); }
    const v = parseFloat(rest.replace(',', '.'));
    store.setMeasurement(pId, date, isNaN(v) ? null : v, qualifier);
  }

  // ── Cliquer dans une case = remplacer, comme dans un tableur ──
  // Sans cela, cliquer une cellule qui contient « 110 » et taper « 85 » donne
  // « 11850 » : le clic pose un curseur au milieu du nombre et la valeur est
  // corrompue sans qu'on le voie. Sélectionner au `focus` ne suffit pas — le
  // `mouseup` qui suit défait la sélection et repose le curseur. On retient
  // donc l'intention au `mousedown` (le champ était-il déjà actif ?) et on
  // resélectionne après le `mouseup`.
  let selectionAuClic = false;
  function champMouseDown(e: MouseEvent) {
    selectionAuClic = document.activeElement !== e.currentTarget;
  }
  function champMouseUp(e: MouseEvent) {
    if (!selectionAuClic) return;
    selectionAuClic = false;
    e.preventDefault();
    (e.currentTarget as HTMLInputElement).select();
  }

  // Valeur présente à la prise de focus : sert à savoir si l'utilisateur vient
  // d'effacer quelque chose, l'écriture au fil de la frappe ayant déjà eu lieu.
  let avantEdition: { pId: string; date: string; texte: string } | null = null;
  function cellFocus(e: FocusEvent, pId: string, date: string) {
    avantEdition = { pId, date, texte: cellValue(pId, date) };
    (e.currentTarget as HTMLInputElement).select(); // arrivée au clavier (Tab, flèches)
  }
  function cellInput(pId: string, date: string, raw: string) {
    // Enregistrer au fil de la frappe : sans cela, la dernière valeur tapée est
    // perdue si l'onglet est fermé sans avoir quitté le champ. C'est aussi ce
    // qui fait suivre la courbe en direct — le seul bon point relevé par le
    // médecin, à ne surtout pas casser.
    ecrireCellule(pId, date, raw);
  }
  function setCell(pId: string, date: string, raw: string) {
    ecrireCellule(pId, date, raw);
    // Effacer une valeur est silencieux alors que supprimer un paramètre ou un
    // traitement propose « Annuler » : on aligne les trois.
    if (raw.trim() === '' && avantEdition && avantEdition.pId === pId
        && avantEdition.date === date && avantEdition.texte !== '') {
      uiBus.toastAction(
        `Valeur ${avantEdition.texte} effacée (${formatDate(date)}).`,
        'Annuler', () => store.undo(),
      );
    }
    avantEdition = null;
  }

  function isoOf(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // ── Série de dates ──
  // Créer douze colonnes une par une demandait douze saisies : c'est le seul
  // poste de friction qui grandit avec la durée du suivi.
  let serieOuverte = $state(false);
  let serieDepart = $state(todayISO());
  let seriePas = $state<'1m' | '3m' | '6m' | '12m' | '7j'>('3m');
  let serieNb = $state(6);

  const PAS: Record<string, { libelle: string; mois: number; jours: number }> = {
    '7j': { libelle: 'semaine', mois: 0, jours: 7 },
    '1m': { libelle: 'mois', mois: 1, jours: 0 },
    '3m': { libelle: '3 mois', mois: 3, jours: 0 },
    '6m': { libelle: '6 mois', mois: 6, jours: 0 },
    '12m': { libelle: 'an', mois: 12, jours: 0 },
  };

  function ouvrirSerie() {
    // Une série prolonge le suivi : on part de la dernière colonne, pas
    // d'aujourd'hui — sinon un suivi rétrospectif repart systématiquement à
    // la mauvaise extrémité de l'axe.
    const dernieres = store.columnDates;
    serieDepart = dernieres.length ? dernieres[dernieres.length - 1] : todayISO();
    serieOuverte = !serieOuverte;
  }

  function ajouterSerie() {
    const n = Math.max(1, Math.min(40, Math.round(serieNb)));
    const pas = PAS[seriePas];
    const d = new Date(serieDepart);
    if (isNaN(d.getTime())) { uiBus.toast('Date de départ non comprise (JJ/MM/AAAA).', 'error'); return; }
    let ajoutees = 0;
    // Un seul point d'annulation pour toute la série (sinon « Annuler » ne
    // retire qu'une des douze colonnes).
    store.groupe(() => {
      for (let i = 0; i < n; i++) {
        const iso = isoOf(d);
        const avant = store.columnDates.length;
        store.addDateColumn(iso);
        if (store.columnDates.length > avant) ajoutees++;
        if (pas.mois) d.setMonth(d.getMonth() + pas.mois);
        else d.setDate(d.getDate() + pas.jours);
      }
    });
    serieOuverte = false;
    uiBus.toastAction(
      `${ajoutees} date(s) ajoutée(s), une tous les ${pas.libelle}.`,
      'Annuler', () => store.undo(),
    );
  }

  // ── Saisie des dates ──────────────────────────────────────────
  // Règle : on N'ENREGISTRE RIEN pendant la frappe. Le déplacement de la colonne
  // n'a lieu qu'à la validation (Entrée, Tab, ou sortie du champ). C'est
  // exactement le grief du médecin : « ça enregistre trop vite ».
  let validationEnCours = false;

  function changeDate(oldIso: string, newIso: string) {
    const fusion = oldIso !== newIso && store.columnDates.includes(newIso);
    reporterCle(oldIso, newIso);
    const perdues = store.moveDate(oldIso, newIso);
    if (perdues > 0) {
      uiBus.toastAction(
        `${perdues} valeur(s) écrasée(s) : le ${formatDate(newIso)} avait déjà une valeur pour ce(s) paramètre(s).`,
        'Annuler', () => store.undo(), 'error', 8000,
      );
    } else if (fusion) {
      // Aucune valeur perdue, mais deux colonnes n'en font plus qu'une : sans
      // un mot, la colonne semble avoir disparu.
      uiBus.toastAction(
        `Colonne fusionnée avec celle du ${formatDate(newIso)}.`,
        'Annuler', () => store.undo(), 'info', 6000,
      );
    }
  }

  /** Le médecin qui tape « 03/2024 » doit savoir où sa colonne a été rangée. */
  function annoncerPrecision(lu: DateLue) {
    if (lu.precision === 'mois') uiBus.toast(`Mois seul : colonne rangée au ${formatDate(lu.iso)}.`, 'info', 4000);
    else if (lu.precision === 'annee') uiBus.toast(`Année seule : colonne rangée au ${formatDate(lu.iso)}.`, 'info', 4000);
  }

  /**
   * Valide le texte tapé dans l'en-tête. Une saisie illisible NE déplace rien :
   * on remet la date précédente et on le dit. Deviner à la place du médecin
   * poserait des valeurs cliniques sur une date qu'il n'a pas choisie — c'est
   * ainsi que naissaient les dates de l'an 1.
   */
  function validerDate(cle: string, input: HTMLInputElement) {
    if (validationEnCours) return;
    validationEnCours = true;
    try {
      // On relit la date de la colonne dans l'état COURANT : valider par Entrée
      // déplace le focus, ce qui déclenche aussitôt le `blur` du même champ. Sur
      // une valeur figée à la construction du gestionnaire, ce second passage
      // rejouait le déplacement (deuxième message, point d'annulation en trop).
      const colDate = colonnes.find(c => c.cle === cle)?.date;
      if (colDate === undefined) return;
      const brut = input.value.trim();
      const lu = brut === '' ? null : lireDateSouple(brut);
      if (!lu || lu.iso === colDate) {
        input.value = formatDate(colDate); // on rétablit l'affichage normalisé
        if (brut !== '' && !lu) uiBus.toast(`Date « ${brut} » non comprise : tapez par exemple 12/03/2024, 12032024 ou mars 2024.`, 'error', 6000);
        return;
      }
      annoncerPrecision(lu);
      changeDate(colDate, lu.iso);
    } finally {
      validationEnCours = false;
    }
  }

  function dateFocus(e: FocusEvent) {
    (e.currentTarget as HTMLInputElement).select();
  }

  // ── Colonne vide permanente à droite ──────────────────────────
  // « Il y a toujours une colonne vide à l'extrême droite ; dès que j'y saisis
  // une date, une nouvelle colonne vide apparaît à sa droite. » Elle remplace
  // le bouton « + Date » (perdu à droite du tableau, et qui ajoutait toujours
  // la date du jour même pour un suivi rétrospectif).
  let compteurNeuve = 0;
  let cleNeuve = $state('neuve0');

  /** Valide la colonne vide. Retourne la clé de la colonne créée, ou null. */
  function validerNeuve(input: HTMLInputElement): string | null {
    const brut = input.value.trim();
    if (brut === '') return null;
    const lu = lireDateSouple(brut);
    if (!lu) {
      uiBus.toast(`Date « ${brut} » non comprise : tapez par exemple 12/03/2024, 12032024 ou mars 2024.`, 'error', 6000);
      return null;
    }
    input.value = '';
    if (store.columnDates.includes(lu.iso)) {
      uiBus.toast(`La colonne du ${formatDate(lu.iso)} existe déjà.`, 'info');
      return cleParDate.get(lu.iso) ?? null;
    }
    const cle = cleNeuve;
    cleParDate.set(lu.iso, cle);   // la colonne créée hérite de l'identité du champ
    cleNeuve = `neuve${++compteurNeuve}`; // ...et une nouvelle colonne vide naît à droite
    store.addDateColumn(lu.iso);
    annoncerPrecision(lu);
    return cle;
  }

  // ── Ligne vide permanente en bas ──────────────────────────────
  // « Je tape "Créatinine" dedans → la ligne se crée, une suggestion me propose
  // le paramètre du catalogue avec son unité. » Remplace le panneau « Ajouter
  // un paramètre » (quatre gestes, et il restait ouvert).
  let nomNeuf = $state('');
  let iSugg = $state(0);
  let suggMasquees = $state(false);

  const suggestions = $derived.by<CatalogEntry[]>(() => {
    const q = normalize(nomNeuf);
    if (!q || suggMasquees) return [];
    const deja = new Set(store.study.parameters.map(p => normalize(p.name)));
    return CATALOG
      .filter(e => !deja.has(normalize(e.name)))
      .filter(e => normalize(e.name).includes(q) || e.aliases.some(a => normalize(a).includes(q)))
      .slice(0, 6);
  });

  /**
   * Crée la ligne. Un libellé absent du catalogue est accepté TEL QUEL : c'est
   * une exigence explicite (« IgG4 sérique » ne doit pas devenir « IgG »), donc
   * on n'utilise pas ici la reconnaissance approximative de l'import.
   */
  function creerLigne(choix?: CatalogEntry): string | null {
    const nom = nomNeuf.trim();
    const entree = choix ?? (suggestions.length ? suggestions[Math.min(iSugg, suggestions.length - 1)] : null);
    if (!entree && !nom) return null;
    const p = entree
      ? store.addFromCatalog(entree)
      : (store.findParameterByName(nom) ?? store.addParameter({ name: nom, unit: '', category: 'libre' }));
    nomNeuf = ''; iSugg = 0; suggMasquees = false;
    return p.id;
  }

  async function creerPuisFocus(choix?: CatalogEntry) {
    const id = creerLigne(choix);
    if (!id) return;
    await tick();
    const r = params.findIndex(p => p.id === id);
    if (r >= 0 && colonnes.length) focusCellule(colonnes[0].cle, r);
    else focusCible({ t: 'neuveDate' });
  }

  function nouvelleLigneKey(e: KeyboardEvent) {
    const t = e.currentTarget as HTMLInputElement;
    if (e.key === 'ArrowDown' && suggestions.length) { e.preventDefault(); iSugg = Math.min(iSugg + 1, suggestions.length - 1); }
    else if (e.key === 'ArrowUp' && suggestions.length) { e.preventDefault(); iSugg = Math.max(iSugg - 1, 0); }
    else if (e.key === 'Escape') {
      e.preventDefault();
      if (suggestions.length) suggMasquees = true; // 1er Échap : garder mon libellé
      else { nomNeuf = ''; t.value = ''; }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      creerPuisFocus();
    } else if (e.key === 'Tab') {
      // Grille entièrement vide et rien de tapé : il n'y a rien à circuler
      // dedans. Piéger quand même le clavier ici rendrait le reste de la page
      // — bascule de mode, boutons du graphique — inatteignable sans souris.
      if (!params.length && !colonnes.length && !nomNeuf.trim()) return;
      e.preventDefault();
      const suite = () => deplacer({ t: 'neuveLigne' }, e.shiftKey);
      if (nomNeuf.trim()) { creerLigne(); tick().then(suite); } else suite();
    }
  }

  function nouvelleLigneBlur() {
    // Sortir du champ vaut validation, comme pour une date : sinon le nom tapé
    // disparaît au premier clic ailleurs.
    if (nomNeuf.trim()) creerLigne();
  }

  // ── Parcours clavier : le Tab ne sort jamais du tableau ────────
  // « Tab déplace le curseur à la cellule de droite ; en fin de ligne, il passe
  // à la première cellule de la ligne suivante, sans jamais sortir du tableau. »
  type Cible =
    | { t: 'entete'; cle: string }
    | { t: 'neuveDate' }
    | { t: 'cellule'; cle: string; r: number }
    | { t: 'neuveLigne' };

  const parcours = $derived.by<Cible[]>(() => {
    const l: Cible[] = colonnes.map(c => ({ t: 'entete', cle: c.cle } as Cible));
    l.push({ t: 'neuveDate' });
    for (let r = 0; r < params.length; r++) {
      for (const c of colonnes) l.push({ t: 'cellule', cle: c.cle, r });
    }
    l.push({ t: 'neuveLigne' });
    return l;
  });

  function memeCible(a: Cible, b: Cible): boolean {
    if (a.t !== b.t) return false;
    if (a.t === 'entete' && b.t === 'entete') return a.cle === b.cle;
    if (a.t === 'cellule' && b.t === 'cellule') return a.cle === b.cle && a.r === b.r;
    return true;
  }

  function selecteur(c: Cible): string {
    if (c.t === 'entete') return `.dateinput[data-cle="${c.cle}"]`;
    if (c.t === 'neuveDate') return '.dateinput.neuve';
    if (c.t === 'cellule') return `.cell[data-cle="${c.cle}"][data-r="${c.r}"]`;
    return '.newrow-inp';
  }

  function focusCible(c: Cible): boolean {
    const el = document.querySelector<HTMLInputElement>(selecteur(c));
    if (!el) return false;
    el.focus(); el.select();
    return true;
  }

  /** Voisin dans le parcours (bouclé) : on ne quitte jamais la grille. */
  function voisin(depart: Cible, arriere: boolean): Cible | null {
    const l = parcours;
    const i = l.findIndex(c => memeCible(c, depart));
    if (i < 0) return null;
    return l[(i + (arriere ? -1 : 1) + l.length) % l.length];
  }

  async function deplacer(depart: Cible, arriere: boolean) {
    const cible = voisin(depart, arriere);
    if (!cible) return;
    await tick();
    if (!focusCible(cible)) focusCible({ t: 'neuveDate' }); // filet : jamais de focus perdu
  }

  function focusEntete(cle: string) { focusCible({ t: 'entete', cle }); }
  function focusCellule(cle: string, r: number) { focusCible({ t: 'cellule', cle, r }); }

  /**
   * Valide puis pose le focus, APRÈS le rendu.
   * Déplacer un nœud dans le DOM le fait perdre le focus (le navigateur n'a pas
   * de « déplacer » : il retire puis réinsère). Comme valider une date réordonne
   * la grille, il faut attendre le rendu avant de reposer le curseur — sinon on
   * se retrouve sur `<body>` et les caractères suivants tombent dans le vide.
   */
  async function validerPuisFocus(cle: string, input: HTMLInputElement, cible: Cible | (() => void)) {
    validerDate(cle, input);
    await tick();
    if (typeof cible === 'function') cible();
    else if (!focusCible(cible)) focusEntete(cle);
  }

  function dateKey(e: KeyboardEvent, cle: string, colDate: string) {
    const t = e.currentTarget as HTMLInputElement;
    const auBout = t.selectionStart === t.value.length && t.selectionStart === t.selectionEnd;
    const auDebut = t.selectionStart === 0 && t.selectionEnd === 0;
    const toutSel = t.selectionStart === 0 && t.selectionEnd === t.value.length;
    if (e.key === 'Escape') {
      e.preventDefault();
      t.value = formatDate(colDate); // annule la frappe en cours, sans rien déplacer
      t.select();
    } else if (e.key === 'Enter' || e.key === 'ArrowDown') {
      e.preventDefault();
      validerPuisFocus(cle, t, params.length ? { t: 'cellule', cle, r: 0 } : { t: 'neuveLigne' });
    } else if (e.key === 'Tab') {
      // On calcule la destination AVANT la validation : le médecin qui remplit
      // une ligne de dates veut la colonne suivante de l'affichage qu'il a sous
      // les yeux, pas celle qui suivra le reclassement chronologique.
      e.preventDefault();
      const cible = voisin({ t: 'entete', cle }, e.shiftKey);
      if (cible) validerPuisFocus(cle, t, cible);
    } else if (e.key === 'ArrowRight' && (auBout || toutSel)) {
      e.preventDefault();
      const cible = voisin({ t: 'entete', cle }, false);
      if (cible) validerPuisFocus(cle, t, cible);
    } else if (e.key === 'ArrowLeft' && (auDebut || toutSel)) {
      e.preventDefault();
      const cible = voisin({ t: 'entete', cle }, true);
      if (cible) validerPuisFocus(cle, t, cible);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      removeDate(colDate);
    }
  }

  /** Même clavier sur la colonne vide de droite, à ceci près qu'elle CRÉE la colonne. */
  async function neuveKey(e: KeyboardEvent) {
    const t = e.currentTarget as HTMLInputElement;
    if (e.key === 'Escape') { e.preventDefault(); t.value = ''; return; }
    // Grille entièrement vide, rien de tapé ici : voir le commentaire jumeau
    // dans nouvelleLigneKey — piéger le clavier serait pire que le laisser sortir.
    if (e.key === 'Tab' && t.value.trim() === '' && !params.length && !colonnes.length) return;
    if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'Tab' || (e.key === 'ArrowRight' && t.value === '')) {
      e.preventDefault();
      const arriere = e.key === 'Tab' && e.shiftKey;
      if (arriere && t.value.trim() === '') { deplacer({ t: 'neuveDate' }, true); return; }
      const cle = validerNeuve(t);
      await tick();
      if (cle && (e.key === 'Enter' || e.key === 'ArrowDown')) {
        if (params.length) focusCellule(cle, 0); else focusCible({ t: 'neuveLigne' });
      } else if (cle && e.key === 'Tab' && !arriere) {
        focusCible({ t: 'neuveDate' }); // on enchaîne sur la colonne vide suivante
      } else {
        deplacer({ t: 'neuveDate' }, arriere);
      }
    } else if (e.key === 'ArrowLeft' && t.selectionStart === 0 && t.selectionEnd === 0) {
      e.preventDefault();
      deplacer({ t: 'neuveDate' }, true);
    }
  }

  // ── Suppression d'une colonne ─────────────────────────────────
  // « La suppression demande une action délibérée et non un survol. » La croix
  // n'est plus collée au champ de date, et une colonne qui porte des valeurs
  // demande une confirmation explicite avant de disparaître.
  let confirmSuppr = $state<string | null>(null); // clé de colonne

  function valeursDe(iso: string): number {
    return store.study.measurements.filter(m => m.date === iso).length;
  }

  function demanderSuppr(cle: string, iso: string) {
    if (valeursDe(iso) === 0) { removeDate(iso); return; }
    confirmSuppr = cle;
  }

  function removeDate(iso: string) {
    const valeurs = valeursDe(iso);
    confirmSuppr = null;
    store.removeDateColumn(iso);
    uiBus.toastAction(
      valeurs > 0
        ? `Colonne du ${formatDate(iso)} supprimée (${valeurs} valeur(s)).`
        : `Colonne du ${formatDate(iso)} supprimée.`,
      'Annuler', () => store.undo(), valeurs > 0 ? 'error' : 'info', valeurs > 0 ? 8000 : 5000,
    );
  }

  /** Ouvre le calendrier natif (le champ date caché sert uniquement à ça). */
  function ouvrirCalendrier(cle: string) {
    const el = document.querySelector<HTMLInputElement & { showPicker?: () => void }>(`.datepick[data-cle="${cle}"]`);
    if (!el) return;
    if (typeof el.showPicker === 'function') { el.showPicker(); return; }
    uiBus.toast('Le calendrier n’est pas disponible ici : tapez la date (JJ/MM/AAAA).', 'info');
  }

  function selectParam(id: string) {
    selectedId = selectedId === id ? null : id;
  }

  function cellKey(e: KeyboardEvent, pId: string, cle: string, colDate: string, r: number) {
    const t = e.currentTarget as HTMLInputElement;
    const auBout = t.selectionStart === t.value.length && t.selectionEnd === t.value.length;
    const auDebut = t.selectionStart === 0 && t.selectionEnd === 0;
    const toutSel = t.selectionStart === 0 && t.selectionEnd === t.value.length;
    if (e.key === 'Escape') {
      // Échap rend la cellule telle qu'elle était à la prise de focus : la
      // valeur a déjà été écrite au fil de la frappe (courbe en direct), il faut
      // donc défaire l'écriture, pas seulement le texte affiché.
      e.preventDefault();
      const texte = avantEdition && avantEdition.pId === pId && avantEdition.date === colDate ? avantEdition.texte : '';
      ecrireCellule(pId, colDate, texte);
      t.value = texte;
      t.select();
    } else if (e.key === 'Enter' || e.key === 'ArrowDown') {
      e.preventDefault();
      if (r + 1 < params.length) focusCellule(cle, r + 1);
      else focusCible({ t: 'neuveLigne' }); // sous la dernière ligne : la ligne vide
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (r > 0) focusCellule(cle, r - 1);
      else focusEntete(cle); // depuis la 1re ligne on remonte dans l'en-tête de date
    } else if (e.key === 'Tab') {
      e.preventDefault();
      deplacer({ t: 'cellule', cle, r }, e.shiftKey);
    } else if (e.key === 'ArrowRight' && (auBout || toutSel)) {
      // Navigation seulement si le curseur est en fin de champ ou tout
      // sélectionné (sinon on empêcherait de déplacer le caret dans « 12,5 »).
      e.preventDefault();
      deplacer({ t: 'cellule', cle, r }, false);
    } else if (e.key === 'ArrowLeft' && (auDebut || toutSel)) {
      e.preventDefault();
      deplacer({ t: 'cellule', cle, r }, true);
    }
  }

  // #10 : coller une colonne (ou un bloc) dans une cellule remplit vers le bas / la droite.
  function cellPaste(e: ClipboardEvent) {
    const t = e.currentTarget as HTMLInputElement;
    const text = e.clipboardData?.getData('text') ?? '';
    if (!text) return;
    const grid = text.replace(/\r/g, '').replace(/\n+$/, '').split('\n').map(l => l.split('\t'));
    if (grid.length === 1 && grid[0].length === 1) return; // valeur unique → collage normal
    e.preventDefault();
    const r0 = Number(t.dataset.r), c0 = Number(t.dataset.c);
    let count = 0, ignored = 0;
    store.groupe(() => {
      grid.forEach((line, ri) => line.forEach((val, ci) => {
        if (val.trim() === '') return;
        const p = params[r0 + ri];
        const date = columns[c0 + ci];
        if (p && date) { setCell(p.id, date, val.trim()); count++; }
        else ignored++;
      }));
    });
    if (count || ignored) {
      const extra = ignored ? ` · ${ignored} ignorée(s) (hors grille — ajoutez des lignes/dates)` : '';
      uiBus.toastAction(`${count} valeur(s) collée(s)${extra}.`, 'Annuler', () => store.undo(), ignored ? 'info' : 'success');
    }
  }

  // Date affichée dans l'écran de vérification (toujours JJ/MM/AAAA)
  function majDateCollee(i: number, brut: string, input: HTMLInputElement) {
    const t = brut.trim();
    if (!pasteReview) return;
    if (t === '') { pasteReview.dates[i] = ''; return; }
    const lu = lireDateSouple(t);
    if (!lu) { uiBus.toast(`Date « ${t} » non comprise : tapez par exemple 12/03/2024.`, 'error'); input.value = pasteReview.dates[i] ? formatDate(pasteReview.dates[i]) : ''; return; }
    pasteReview.dates[i] = lu.iso;
    input.value = formatDate(lu.iso);
  }
</script>

<svelte:window onkeydown={onPasteReviewKey} />

<div class="data">
  <div class="modeseg">
    <button class:on={mode === 'saisir'} onclick={() => (mode = 'saisir')}>⌨️ Saisir</button>
    <button class:on={mode === 'importer' && importInitial !== 'dictee'} onclick={() => openImport('photo')}>📥 Importer</button>
    <button class:on={mode === 'importer' && importInitial === 'dictee'} onclick={() => openImport('dictee')}>🎙️ Dicter</button>
  </div>

  {#if mode === 'importer'}
    <div class="aux"><ImportTab initialMode={importInitial} onImported={() => (mode = 'saisir')} /></div>
  {:else}

  {#if pasteReview}
    <div class="tablecard aux" style="padding:12px;">
      <div class="row" style="margin-bottom:8px; gap:6px; align-items:baseline;">
        <strong>Vérifier le tableau collé</strong>
        <span class="faint" style="font-size:12px;">— une date n'a pas été reconnue : complétez-la puis ajoutez.</span>
      </div>
      {#if pasteHasMissing}
        <div class="pastewarn">⚠️ Date manquante. Renseignez la (les) date(s) surlignée(s) avant d'ajouter.</div>
      {/if}
      <div class="tablescroll">
        <table class="dgrid">
          <thead>
            <tr>
              <th class="corner"></th>
              {#each pasteReview.dates as d, i (i)}
                <th class="datecol">
                  <input class="dateinput" class:datemissing={pasteMissingCols.has(i)} type="text"
                    aria-label="Date de la colonne collée {i + 1}" placeholder="JJ/MM/AAAA"
                    value={d ? formatDate(d) : ''}
                    onchange={(e) => majDateCollee(i, e.currentTarget.value, e.currentTarget)} />
                </th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each pasteReview.rows as r, ri (ri)}
              <tr class:excluded={!r.include}>
                <th class="rowname">
                  <label class="prow"><input type="checkbox" bind:checked={r.include} /> <input class="pname-inp" bind:value={r.name} /></label>
                </th>
                {#each r.values as v, ci (ci)}
                  <td class="pcell">{v === null ? '' : (r.qualifiers[ci] ?? '') + v}</td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <div class="row" style="margin-top:10px;">
        <span class="faint" style="font-size:12px;">{pasteReview.rows.filter(r => r.include).length} ligne(s)</span>
        <div class="spacer"></div>
        <button onclick={cancelPaste}>Annuler</button>
        <button class="primary" disabled={pasteHasMissing} onclick={commitPaste}>Ajouter au graphique</button>
      </div>
    </div>
  {/if}

  {#if params.length === 0 && columns.length === 0 && !pasteReview}
    <!-- Écran de départ : la grille doit rester visible et utilisable tout de
         suite, pas être poussée hors de l'écran. Les autres façons d'entrer
         des résultats (capture, dictée) sont déjà juste au-dessus, dans la
         barre Saisir/Importer/Dicter — pas la peine de les répéter ici. -->
    <div class="depart">
      <p class="depart-t">Tapez directement dans le tableau : le nom de la variable à gauche, la date en haut.</p>
      <p class="astuce"><kbd>Ctrl</kbd>+<kbd>V</kbd> colle une capture depuis n'importe où.</p>
    </div>
  {/if}

  {#if serieOuverte}
    <div class="card aux serie">
      <div class="row wrap">
        <label class="fld">1<sup>re</sup> date<input class="serie-date" type="text" value={formatDate(serieDepart)}
          onchange={(e) => { const lu = lireDateSouple(e.currentTarget.value); if (lu) { serieDepart = lu.iso; } e.currentTarget.value = formatDate(serieDepart); }} /></label>
        <label class="fld">une tous les
          <select bind:value={seriePas}>
            <option value="7j">7 jours</option>
            <option value="1m">mois</option>
            <option value="3m">3 mois</option>
            <option value="6m">6 mois</option>
            <option value="12m">ans</option>
          </select>
        </label>
        <label class="fld">nombre<input class="nb" type="number" min="1" max="40" bind:value={serieNb} /></label>
        <div class="spacer"></div>
        <button onclick={() => (serieOuverte = false)}>Annuler</button>
        <button class="primary" onclick={ajouterSerie}>Ajouter les dates</button>
      </div>
    </div>
  {/if}

  <div class="tablecard">
    <div class="tablescroll">
      <table class="dgrid">
        <thead>
          <tr>
            <th class="corner"></th>
            {#each colonnes as c (c.cle)}
              <th class="datecol">
                <div class="colbar">
                  <button class="colicon" tabindex="-1" title="Choisir dans un calendrier"
                    onclick={() => ouvrirCalendrier(c.cle)} aria-label="Calendrier">📅</button>
                  <button class="colx" tabindex="-1" title="Supprimer cette colonne"
                    onclick={() => demanderSuppr(c.cle, c.date)} aria-label="Supprimer la colonne du {formatDate(c.date)}">✕</button>
                </div>
                <!-- Champ texte (et non `type="date"`) : le champ date natif
                     enregistre dès que ses trois segments sont remplis, donc
                     au milieu de la frappe, et il s'affiche au format de la
                     langue du navigateur (08/14/0001 en anglais). Ici rien
                     n'est enregistré avant Entrée / Tab / sortie du champ, et
                     l'affichage est toujours JJ/MM/AAAA. -->
                <input class="dateinput" type="text" inputmode="numeric"
                  data-cle={c.cle} aria-label="Date de la colonne {formatDate(c.date)}"
                  value={formatDate(c.date)}
                  onfocus={dateFocus}
                  onkeydown={(e) => dateKey(e, c.cle, c.date)}
                  onblur={(e) => validerDate(c.cle, e.currentTarget)} />
                <input class="datepick" type="date" tabindex="-1" aria-hidden="true" data-cle={c.cle}
                  value={c.date} onchange={(e) => { const v = e.currentTarget.value; if (v) changeDate(c.date, v); }} />
                {#if confirmSuppr === c.cle}
                  <div class="confirm">
                    <span>Supprimer {valeursDe(c.date)} valeur(s) ?</span>
                    <button class="danger-btn" onclick={() => removeDate(c.date)}>Supprimer</button>
                    <button onclick={() => (confirmSuppr = null)}>Annuler</button>
                  </div>
                {/if}
              </th>
            {/each}
            <th class="datecol neuvecol">
              <div class="colbar"></div>
              <input class="dateinput neuve" type="text" inputmode="numeric"
                placeholder="+ date" title="Tapez une date (JJ/MM/AAAA) pour ajouter une colonne"
                aria-label="Nouvelle colonne de date"
                onkeydown={neuveKey}
                onblur={(e) => validerNeuve(e.currentTarget)} />
            </th>
            <th class="pad"></th>
          </tr>
        </thead>
        <tbody>
          {#each params as p, ri (p.id)}
            <tr class:sel={selectedId === p.id}>
              <th class="rowname">
                <button class="namebtn" tabindex="-1" onclick={() => selectParam(p.id)}>
                  <span class="dot" style="background:{p.color}"></span>
                  <span class="pname">{p.name}</span>
                  <span class="punit">{unitOf(p)}</span>
                </button>
              </th>
              {#each colonnes as c, ci (c.cle)}
                <td>
                  <input class="cell" type="text" inputmode="decimal"
                    data-r={ri} data-c={ci} data-cle={c.cle}
                    aria-label="{p.name} au {formatDate(c.date)}"
                    value={cellValue(p.id, c.date)}
                    onkeydown={(e) => cellKey(e, p.id, c.cle, c.date, ri)}
                    onpaste={cellPaste}
                    onfocus={(e) => cellFocus(e, p.id, c.date)}
                    oninput={(e) => cellInput(p.id, c.date, e.currentTarget.value)}
                    onchange={(e) => setCell(p.id, c.date, e.currentTarget.value)} />
                </td>
              {/each}
              <td class="ghostcell"></td>
              <td class="pad"></td>
            </tr>
          {/each}
          <tr class="newrow">
            <th class="rowname">
              <input class="newrow-inp" placeholder="+ variable" aria-label="Nouvelle variable"
                bind:value={nomNeuf} oninput={() => { iSugg = 0; suggMasquees = false; }}
                onkeydown={nouvelleLigneKey} onblur={nouvelleLigneBlur} />
              {#if suggestions.length}
                <div class="suggest">
                  {#each suggestions as s, i (s.name)}
                    <button class="sg" class:on={i === iSugg}
                      onmousedown={(e) => { e.preventDefault(); creerPuisFocus(s); }}>
                      <span class="sg-n">{s.name}</span><span class="sg-u">{s.unit}</span>
                    </button>
                  {/each}
                </div>
              {/if}
            </th>
            {#each colonnes as c (c.cle)}
              <td class="ghostcell"></td>
            {/each}
            <td class="ghostcell"></td>
            <td class="pad"></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  {#if selected}
    <div class="aux"><ParamEditor param={selected} onClose={() => (selectedId = null)} /></div>
  {/if}

  <div class="pied">
    <button class="add-serie" onclick={ouvrirSerie}
            title="Ajouter plusieurs dates d’un coup (suivi régulier)">+ Série de dates</button>
    {#if params.length > 0}
      <span class="astuce">Astuce : <kbd>Ctrl</kbd>+<kbd>V</kbd> colle une capture d'écran ou un tableau de résultats.</span>
    {/if}
  </div>

  {/if}
</div>

<style>
  .data { display: flex; flex-direction: column; gap: 14px; }

  .modeseg { display: inline-flex; background: #eef1f5; border-radius: 10px; padding: 3px; align-self: flex-start; }
  .modeseg button { border: none; background: transparent; border-radius: 7px; padding: 6px 16px; font-size: 13px; color: var(--muted); }
  .modeseg button.on { background: #fff; color: var(--ink); font-weight: 600; box-shadow: 0 1px 2px rgba(16,24,32,.12); }

  /* En bandes, la grille prend toute la largeur — mais pas les blocs qui n'en
     sont pas un : un formulaire étiré sur 1600 px est illisible. */
  .aux { max-width: 880px; }

  /* Écran de départ : au-dessus d'une grille déjà utilisable. */
  .depart { display: flex; flex-direction: column; gap: 6px; }
  .depart-t { font-size: 13.5px; color: var(--muted); margin: 0; }

  .tablecard { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow); overflow: hidden; }
  /* Grille de saisie : défile dans les deux sens, en-tête de dates et colonne
     des noms restant visibles (sinon on saisit à l'aveugle dès 3-4 dates). */
  .tablescroll { overflow: auto; max-height: var(--grille-max-h, min(56vh, 460px)); }

  .pastewarn { background: #fff5e6; color: #8a5a12; border: 1px solid #f0d9a8; border-radius: 8px; padding: 8px 10px; font-size: 12.5px; margin-bottom: 10px; line-height: 1.4; }
  .datemissing { background: #fff0d6; box-shadow: inset 0 0 0 1.5px #e0a33a; border-radius: 4px; }
  .prow { display: flex; align-items: center; gap: 6px; padding: 4px 8px; }
  .pname-inp { border: none; background: transparent; font-weight: 600; font-size: 13px; width: 130px; }
  .pname-inp:focus { background: #fff; border-radius: 5px; }
  .pcell { text-align: center; font-size: 13px; color: var(--muted); padding: 6px 10px; white-space: nowrap; }
  tr.excluded { opacity: .45; }
  /* `separate` (et non `collapse`) : sinon les bordures des cellules figées
     défilent avec le contenu au lieu de rester collées à la colonne. */
  table.dgrid { border-collapse: separate; border-spacing: 0; width: 100%; }
  .dgrid th, .dgrid td { padding: 0; background: var(--panel); }

  /* Cellules figées : en-tête (haut) et noms de paramètres (gauche). */
  .dgrid thead th { position: sticky; top: 0; z-index: 2; }
  .dgrid .corner, .dgrid .rowname { position: sticky; left: 0; z-index: 3; }
  .dgrid .rowname { box-shadow: 5px 0 7px -6px rgba(16, 24, 32, .35); }
  .dgrid thead .corner { z-index: 4; box-shadow: 5px 0 7px -6px rgba(16, 24, 32, .35); }

  .corner { width: 1%; }
  .datecol { padding: 2px 4px 6px 8px; position: relative; white-space: nowrap; border-bottom: 1px solid var(--border); vertical-align: top; }
  /* Les commandes de colonne sont sur leur propre ligne, à l'écart du champ de
     date : viser la date ne doit jamais pouvoir supprimer la colonne. */
  .colbar { display: flex; justify-content: flex-end; align-items: center; gap: 2px; height: 24px; }
  .dateinput { border: none; background: transparent; font-size: 13px; color: var(--muted); width: 90px; padding: 3px; text-align: center; font-variant-numeric: tabular-nums; }
  .dateinput:focus { background: #fff; border-radius: 5px; box-shadow: inset 0 0 0 2px rgba(42,111,176,.25); color: var(--ink); }
  .dateinput.neuve { color: var(--faint); }
  .dateinput.neuve:focus { color: var(--ink); }
  .neuvecol { border-left: 1px dashed var(--border); }
  /* Le champ date natif ne sert qu'à ouvrir le calendrier du système : il reste
     dans la page (sinon `showPicker()` est refusé) mais hors du flux visuel. */
  .datepick { position: absolute; left: 8px; bottom: 0; width: 1px; height: 1px; opacity: 0; pointer-events: none; border: none; padding: 0; }
  .colx, .colicon {
    border: none; background: transparent; color: var(--faint); font-size: 10px; cursor: pointer; line-height: 1;
    min-width: 24px; min-height: 24px; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;
  }
  .colicon { font-size: 11px; filter: grayscale(1); }
  .colx:hover { color: var(--danger); }
  .colicon:hover { filter: none; }
  .confirm {
    position: absolute; top: 100%; left: 4px; z-index: 6; display: flex; align-items: center; gap: 6px;
    background: var(--panel); border: 1px solid var(--border-strong); border-radius: 8px;
    box-shadow: var(--shadow); padding: 6px 8px; font-size: 12px; white-space: nowrap;
  }
  .confirm button { font-size: 12px; padding: 3px 8px; }
  .danger-btn { color: var(--danger); font-weight: 600; }

  .serie { padding: 10px 12px; }
  .serie .fld { display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; color: var(--muted); }
  .serie .nb { width: 62px; }
  .serie-date { width: 100px; text-align: center; font-variant-numeric: tabular-nums; }

  .rowname { text-align: left; border-bottom: 1px solid var(--panel-2); border-right: 1px solid var(--border); position: relative; }
  tr.sel .rowname { background: #eef4fb; }
  .namebtn { display: flex; align-items: center; gap: 8px; border: none; background: transparent; padding: 9px 12px; width: 100%; cursor: pointer; }
  .namebtn:hover { background: var(--panel-2); }
  .dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
  .pname { font-weight: 600; font-size: 14px; white-space: nowrap; }
  .punit { font-size: 12.5px; color: var(--faint); white-space: nowrap; }

  /* Ligne vide permanente : elle doit se voir comme une invitation, pas comme
     une ligne de données. */
  .newrow .rowname { border-bottom: none; }
  .newrow-inp { border: none; background: transparent; font-size: 14px; color: var(--faint); padding: 9px 12px; width: 150px; }
  .newrow-inp:focus { background: #fff; color: var(--ink); box-shadow: inset 0 0 0 2px rgba(42,111,176,.25); border-radius: 4px; }
  .suggest {
    position: absolute; top: 100%; left: 6px; z-index: 8; min-width: 210px;
    background: var(--panel); border: 1px solid var(--border-strong); border-radius: 9px;
    box-shadow: var(--shadow); padding: 4px; display: flex; flex-direction: column;
  }
  .sg { display: flex; align-items: baseline; gap: 8px; border: none; background: transparent; text-align: left; padding: 5px 8px; border-radius: 6px; }
  .sg.on, .sg:hover { background: #eef4fb; }
  .sg-n { font-size: 13px; font-weight: 500; }
  .sg-u { font-size: 11.5px; color: var(--faint); }

  .dgrid td { border-bottom: 1px solid var(--panel-2); }
  .cell { width: 80px; text-align: center; border: none; background: transparent; padding: 9px 4px; font-size: 14px; }
  .cell:focus { background: #fff; box-shadow: inset 0 0 0 2px rgba(42,111,176,.25); border-radius: 4px; }
  .ghostcell { min-width: 90px; }
  .pad { width: 100%; }

  /* Panneau en bas d'écran (mobile) : la grille ne doit pas manger toute la hauteur. */
  @media (max-width: 820px) {
    .tablescroll { max-height: var(--grille-max-h, 34vh); }
  }

  .pied { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
  .add-serie { border: 1px dashed var(--border-strong); background: transparent; color: var(--muted); font-size: 12px; padding: 5px 10px; border-radius: 7px; }
  .add-serie:hover { color: var(--accent); border-color: var(--accent); }
  .astuce { font-size: 11.5px; color: var(--faint); }
  .astuce kbd {
    font-family: inherit; font-size: 10.5px; background: var(--panel-2);
    border: 1px solid var(--border); border-radius: 4px; padding: 1px 4px;
  }
</style>
