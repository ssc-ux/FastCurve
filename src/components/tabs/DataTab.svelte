<script lang="ts">
  import { tick, onDestroy } from 'svelte';
  import { store } from '../../lib/models/store.svelte';
  import { CATALOG, type CatalogEntry, normalize } from '../../lib/models/catalog';
  import { formatDate, lireDateSouple, todayISO, type DateLue } from '../../lib/models/types';
  import { uiBus } from '../../lib/models/ui.svelte';
  import { parseGridPaste } from '../../lib/text/gridPaste';
  import ParamEditor from './ParamEditor.svelte';
  import ImportTab from './ImportTab.svelte';

  let selectedId = $state<string | null>(null);

  /**
   * Téléphone : la grille (paramètres en lignes × dates en colonnes) devient
   * illisible dès qu'on manque de largeur — trop de colonnes pour l'écran
   * (voir maquette « Direction 9 — Mobile »). En dessous de 640px, on affiche
   * à la place une LISTE d'une date à la fois (chips de dates en défilement
   * horizontal pour changer de date, une ligne par paramètre avec un grand
   * champ de saisie tactile). C'est la seule vue de l'appli qui justifie
   * deux balisages distincts plutôt qu'une media query sur le même
   * balisage : la façon d'interagir change vraiment (une date active plutôt
   * qu'un tableau), pas seulement la taille. Les DEUX vues appellent les
   * mêmes fonctions du store (`ecrireCellule`, `setCell`, `addDateColumn`
   * via `validerNeuve`…) : aucune logique n'est dupliquée, seul le
   * balisage l'est.
   */
  let isMobile = $state(false);
  if (typeof window !== 'undefined') {
    const mq = window.matchMedia('(max-width: 640px)');
    isMobile = mq.matches;
    const onMqChange = (e: MediaQueryListEvent) => { isMobile = e.matches; };
    mq.addEventListener('change', onMqChange);
    onDestroy(() => mq.removeEventListener('change', onMqChange));
  }

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

  /**
   * Mise en évidence hors-norme de la grille : réutilise exactement la
   * bascule et les bornes déjà exposées par le store/catalog (voir le menu
   * « Affichage ▾ » du graphique, `settings.markOutOfRange`, et
   * `Parameter.refLow/refHigh`) — aucune nouvelle logique métier, seulement
   * la lecture de ce qui existe déjà. Désactivée par défaut, comme sur le
   * graphique.
   *
   * ROUGE : valeur hors des bornes de normale.
   * VERT : valeur dans la norme dont la mesure précédente (chronologique,
   * même paramètre) était hors-norme — ce second signal n'existe nulle part
   * ailleurs dans le code : il est dérivé ici en comparant deux mesures
   * consécutives aux mêmes bornes déjà utilisées pour le rouge, rien de plus.
   */
  const outOfRangeMap = $derived.by(() => {
    const map = new Map<string, 'hi' | 'ok'>();
    if (!store.study.settings.markOutOfRange) return map;
    for (const p of params) {
      if (p.refLow == null && p.refHigh == null) continue;
      const isPct = p.category === 'efr' && p.display === 'percent';
      if (isPct) continue; // même exclusion que le graphique (render.ts collectPoints)
      const ms = store.study.measurements
        .filter(m => m.parameterId === p.id)
        .sort((a, b) => a.date.localeCompare(b.date));
      let precedentHorsNorme = false;
      for (const m of ms) {
        const oor = (p.refLow != null && m.value < p.refLow) || (p.refHigh != null && m.value > p.refHigh);
        if (oor) map.set(`${p.id}|${m.date}`, 'hi');
        else if (precedentHorsNorme) map.set(`${p.id}|${m.date}`, 'ok');
        precedentHorsNorme = oor;
      }
    }
    return map;
  });
  function celluleStatut(pId: string, date: string): 'hi' | 'ok' | undefined {
    return outOfRangeMap.get(`${pId}|${date}`);
  }

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

  /** Grille encore complètement vide (aucune variable, aucune date) et pas en
   *  train de vérifier un collage : c'est le tout premier écran du médecin. */
  const estDepart = $derived(params.length === 0 && columns.length === 0 && !pasteReview);

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

  // ── Vue mobile (liste verticale) ────────────────────────────────
  // Une seule date « active » à la fois, choisie parmi des chips en
  // défilement horizontal. `activeCle` retombe automatiquement sur la
  // dernière colonne (le dernier bilan saisi, ce qui intéresse le plus)
  // dès qu'elle est absente/obsolète (colonne supprimée, tout premier
  // rendu…) — pas d'effet à synchroniser, juste un `$derived` avec repli.
  let activeCle = $state<string | null>(null);
  const activeCol = $derived(colonnes.find(c => c.cle === activeCle) ?? colonnes[colonnes.length - 1] ?? null);

  /** Chip « + date » : même validation que la colonne vide du tableau
   *  (`validerNeuve`), la nouvelle colonne devient simplement la date active. */
  function mobileAjouterDate(input: HTMLInputElement) {
    const cle = validerNeuve(input);
    if (cle) activeCle = cle;
  }
  function mNeuveKey(e: KeyboardEvent) {
    const t = e.currentTarget as HTMLInputElement;
    if (e.key === 'Enter') { e.preventDefault(); t.blur(); }
    else if (e.key === 'Escape') { e.preventDefault(); t.value = ''; t.blur(); }
  }

  /** Ligne « + variable » de la liste mobile : crée le paramètre puis pose le
   *  focus sur son champ de valeur pour la date active (équivalent mobile de
   *  `creerPuisFocus`, qui vise une cellule de grille inexistante ici). */
  async function mobileCreerLigne(choix?: CatalogEntry) {
    const id = creerLigne(choix);
    if (!id) return;
    await tick();
    const el = document.querySelector<HTMLInputElement>(`.mval[data-pid="${id}"]`);
    if (el) { el.focus(); el.select(); }
  }
  function mNouvelleLigneKey(e: KeyboardEvent) {
    const t = e.currentTarget as HTMLInputElement;
    if (e.key === 'ArrowDown' && suggestions.length) { e.preventDefault(); iSugg = Math.min(iSugg + 1, suggestions.length - 1); }
    else if (e.key === 'ArrowUp' && suggestions.length) { e.preventDefault(); iSugg = Math.max(iSugg - 1, 0); }
    else if (e.key === 'Escape') {
      e.preventDefault();
      if (suggestions.length) suggMasquees = true;
      else { nomNeuf = ''; t.value = ''; }
    } else if (e.key === 'Enter') { e.preventDefault(); mobileCreerLigne(); }
  }

  /** Champ de valeur d'une ligne (liste mobile) : Entrée passe au paramètre
   *  suivant pour la même date (façon « tabulateur » d'un formulaire simple) ;
   *  Échap annule la frappe en cours — même geste que dans la grille. */
  function mValKey(e: KeyboardEvent, pId: string, date: string) {
    const t = e.currentTarget as HTMLInputElement;
    if (e.key === 'Escape') {
      e.preventDefault();
      const texte = avantEdition && avantEdition.pId === pId && avantEdition.date === date ? avantEdition.texte : '';
      ecrireCellule(pId, date, texte);
      t.value = texte;
      t.blur();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      t.blur();
      const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('.mval'));
      const i = inputs.indexOf(t);
      if (i >= 0 && i + 1 < inputs.length) { inputs[i + 1].focus(); inputs[i + 1].select(); }
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

  <!-- Suivi vide : ce bloc (tableau + « Série de dates ») est centré dans le
       reste de la hauteur disponible plutôt que collé en haut, laissant un
       grand vide au-dessus de la poignée de redimensionnement. Le sélecteur
       Saisir/Importer/Dicter, lui, reste ancré en haut — un repère de
       navigation ne doit pas se déplacer selon l'état du suivi. -->
  <div class="corps" class:centrer={estDepart}>

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

  {#if isMobile}
    <!-- ── Vue mobile : liste verticale, une date active à la fois ── -->
    <div class="mobilegrid">
      <div class="mchips" role="tablist" aria-label="Dates">
        {#each colonnes as c (c.cle)}
          <button class="mchip" class:on={activeCol?.cle === c.cle} role="tab"
                  aria-selected={activeCol?.cle === c.cle} onclick={() => (activeCle = c.cle)}>
            {formatDate(c.date)}
          </button>
        {/each}
        <input class="mchip madd" type="text" inputmode="numeric" placeholder="+ date"
               aria-label="Ajouter une date" title="Tapez une date (JJ/MM/AAAA) pour ajouter une colonne"
               onkeydown={mNeuveKey}
               onblur={(e) => mobileAjouterDate(e.currentTarget)} />
      </div>

      {#if !activeCol}
        <p class="mempty">Ajoutez une date (« + date » ci-dessus) pour commencer la saisie.</p>
      {:else}
        <div class="mdatebar">
          <span class="mdate-label">{formatDate(activeCol.date)}</span>
          <div class="spacer"></div>
          <button class="micon" title="Choisir dans un calendrier" aria-label="Choisir la date dans un calendrier"
                  onclick={() => ouvrirCalendrier(activeCol.cle)}>📅</button>
          <button class="micon" title="Supprimer cette date" aria-label="Supprimer la date du {formatDate(activeCol.date)}"
                  onclick={() => demanderSuppr(activeCol.cle, activeCol.date)}>✕</button>
        </div>
        <input class="datepick" type="date" tabindex="-1" aria-hidden="true"
               value={activeCol.date} onchange={(e) => { const v = e.currentTarget.value; if (v) changeDate(activeCol.date, v); }} />
        {#if confirmSuppr === activeCol.cle}
          <div class="mconfirm">
            <span>Supprimer {valeursDe(activeCol.date)} valeur(s) du {formatDate(activeCol.date)} ?</span>
            <button class="danger-btn" onclick={() => removeDate(activeCol.date)}>Supprimer</button>
            <button onclick={() => (confirmSuppr = null)}>Annuler</button>
          </div>
        {/if}

        <div class="mlist">
          {#each params as p (p.id)}
            <div class="mrow">
              <button class="mname" onclick={() => selectParam(p.id)} aria-expanded={selectedId === p.id}>
                <span class="dot" style="background:{p.color}"></span>
                <span class="mn">{p.name}</span>
                <span class="mu">{unitOf(p)}</span>
              </button>
              <input class="mval {celluleStatut(p.id, activeCol.date) ?? ''}" type="text" inputmode="decimal" data-pid={p.id}
                     aria-label="{p.name} au {formatDate(activeCol.date)}"
                     value={cellValue(p.id, activeCol.date)}
                     onfocus={(e) => cellFocus(e, p.id, activeCol.date)}
                     oninput={(e) => cellInput(p.id, activeCol.date, e.currentTarget.value)}
                     onchange={(e) => setCell(p.id, activeCol.date, e.currentTarget.value)}
                     onkeydown={(e) => mValKey(e, p.id, activeCol.date)} />
            </div>
            {#if selected && selected.id === p.id}
              <div class="aux mparamed"><ParamEditor param={selected} onClose={() => (selectedId = null)} /></div>
            {/if}
          {/each}

          <div class="mrow madd-row">
            <input class="mnew" placeholder="+ variable" aria-label="Nouvelle variable"
                   bind:value={nomNeuf} oninput={() => { iSugg = 0; suggMasquees = false; }}
                   onkeydown={mNouvelleLigneKey} onblur={nouvelleLigneBlur} />
            {#if suggestions.length}
              <div class="suggest mobile-suggest">
                {#each suggestions as s, i (s.name)}
                  <button class="sg" class:on={i === iSugg}
                          onmousedown={(e) => { e.preventDefault(); mobileCreerLigne(s); }}>
                    <span class="sg-n">{s.name}</span><span class="sg-u">{s.unit}</span>
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        </div>
      {/if}
    </div>
  {:else}
  <div class="tablecard" class:depart={estDepart}
       title={estDepart ? "Tapez le nom de la variable à gauche, la date en haut. Ctrl+V colle une capture ou un tableau de résultats." : undefined}>
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
                <td class={celluleStatut(p.id, c.date)}>
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
  {/if}

  {#if selected && !isMobile}
    <div class="aux"><ParamEditor param={selected} onClose={() => (selectedId = null)} /></div>
  {/if}

  <div class="pied">
    <button class="add-serie" onclick={ouvrirSerie}
            title="Ajouter plusieurs dates d’un coup (suivi régulier)">+ Série de dates</button>
    {#if params.length > 0}
      <span class="astuce">Astuce : <kbd>Ctrl</kbd>+<kbd>V</kbd> colle une capture d'écran ou un tableau de résultats.</span>
    {/if}
  </div>

  </div>

  {/if}
</div>

<style>
  .data { display: flex; flex-direction: column; gap: 14px; }
  /* Suivi vide (App.svelte pose `.tab-content.centrer`) : `.data` doit occuper
     toute la hauteur réservée par `.tab-content` pour que `.corps.centrer`,
     plus bas, ait un espace réel à centrer dans — sinon `flex: 1` sur `.corps`
     n'a rien à remplir, sa hauteur restant celle de son contenu. */
  :global(.tab-content.centrer) .data { flex: 1; min-height: 0; }

  .modeseg { display: inline-flex; background: var(--panel); border: 1px solid var(--border-strong); border-radius: 7px; padding: 3px; align-self: flex-start; }
  .modeseg button { border: none; background: transparent; border-radius: 5px; padding: 5px 14px; font-size: 12.5px; color: var(--muted); }
  .modeseg button.on { background: var(--accent-soft); color: var(--accent); font-weight: 700; }

  /* En bandes, la grille prend toute la largeur — mais pas les blocs qui n'en
     sont pas un : un formulaire étiré sur 1600 px est illisible. */
  .aux { max-width: 880px; }

  .corps { display: flex; flex-direction: column; gap: 14px; }
  /* Suivi vide : le tableau + « Série de dates » n'ont aucune raison de rester
     collés en haut d'une colonne bien plus haute qu'eux — ça laissait un grand
     vide au-dessus de la poignée de redimensionnement (grief du médecin). Le
     bloc est centré dans la hauteur qui lui est réservée ; `.tab-content.centrer`
     (App.svelte) est ce qui donne à `.data`/`.corps` une hauteur à remplir. */
  .corps.centrer { flex: 1; min-height: 0; justify-content: center; }

  .tablecard { background: var(--panel); border: 1px solid var(--border-strong); border-radius: var(--radius); box-shadow: none; overflow: hidden; }
  /* Suivi vide : c'est LE tableau à remplir, et il doit se voir tout de suite —
     pas se fondre dans le blanc de la barre latérale. Rien d'inventé : même
     anneau bleu que celui posé sur un champ actif au focus (`--accent` +
     `0 0 0 3px var(--accent-soft)`, voir la règle globale `input:focus`) —
     déjà, dans toute l'appli, le signal « c'est ici qu'on agit » — combiné à
     l'ombre de la carte du graphique (ChartPanel `.svg-host`) pour la
     détacher du blanc derrière elle. */
  .tablecard.depart {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft), 0 6px 24px rgba(16,24,32,.10);
  }
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
     défilent avec le contenu au lieu de rester collées à la colonne.
     Grille dense : bordures fines complètes (verticales comprises), pas
     seulement horizontales — voir `.datecol`/`.dgrid td` plus bas. */
  table.dgrid { border-collapse: separate; border-spacing: 0; width: 100%; font-size: 12.5px; }
  .dgrid th, .dgrid td { padding: 0; background: var(--panel); }

  /* Cellules figées : en-tête (haut) et noms de paramètres (gauche). */
  .dgrid thead th { position: sticky; top: 0; z-index: 2; }
  .dgrid .corner, .dgrid .rowname { position: sticky; left: 0; z-index: 3; }
  .dgrid .rowname { box-shadow: 5px 0 7px -6px rgba(16, 24, 32, .35); }
  .dgrid thead .corner { z-index: 4; box-shadow: 5px 0 7px -6px rgba(16, 24, 32, .35); }

  .corner { width: 1%; background: var(--panel-2); border-bottom: 1px solid var(--border-strong); border-right: 1px solid var(--border); }
  /* En-tête de colonne (date) : fond gris très clair et bordures fines
     complètes, comme les en-têtes de la maquette « Console clinique dense »
     — seule différence, la date elle-même reste éditable (input), donc pas
     de petites capitales dessus (ça rendrait la saisie illisible). */
  .datecol {
    padding: 2px 4px 6px 8px; position: relative; white-space: nowrap; vertical-align: top;
    background: var(--panel-2); border-bottom: 1px solid var(--border-strong); border-right: 1px solid var(--border);
  }
  /* Les commandes de colonne sont sur leur propre ligne, à l'écart du champ de
     date : viser la date ne doit jamais pouvoir supprimer la colonne. */
  .colbar { display: flex; justify-content: flex-end; align-items: center; gap: 2px; height: 22px; }
  .dateinput { border: none; background: transparent; font-size: 12px; font-weight: 700; color: #57657f; width: 88px; padding: 3px; text-align: center; font-variant-numeric: tabular-nums; }
  .dateinput:focus { background: #fff; border-radius: 5px; box-shadow: inset 0 0 0 2px rgba(42,111,176,.25); color: var(--ink); }
  .dateinput.neuve { color: var(--faint); font-weight: 500; }
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

  .rowname { text-align: left; border-bottom: 1px solid var(--border); border-right: 1px solid var(--border-strong); position: relative; }
  tr.sel .rowname { background: var(--accent-soft); }
  .namebtn { display: flex; align-items: center; gap: 7px; border: none; background: transparent; padding: 7px 10px; width: 100%; cursor: pointer; }
  .namebtn:hover { background: var(--panel-2); }
  .dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
  .pname { font-weight: 700; font-size: 12.5px; white-space: nowrap; }
  .punit { font-size: 10.5px; color: var(--faint); white-space: nowrap; }

  /* Ligne vide permanente : elle doit se voir comme une invitation, pas comme
     une ligne de données. */
  .newrow .rowname { border-bottom: none; }
  .newrow-inp { border: none; background: transparent; font-size: 12.5px; color: var(--faint); padding: 7px 10px; width: 150px; }
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

  /* Bordures fines complètes (verticales comprises), pas seulement
     horizontales, comme dans la maquette « Console clinique dense ». */
  .dgrid td { border-bottom: 1px solid var(--border); border-right: 1px solid var(--border); }
  .cell { width: 80px; text-align: center; border: none; background: transparent; padding: 7px 4px; font-size: 12.5px; font-variant-numeric: tabular-nums; }
  .cell:focus { background: #fff; box-shadow: inset 0 0 0 2px rgba(42,111,176,.25); border-radius: 4px; }

  /* Mise en évidence hors-norme (bascule « Marquer les valeurs hors-norme »,
     désactivée par défaut — voir celluleStatut ci-dessus). */
  td.hi { background: var(--hi-bg); }
  td.hi .cell { color: var(--hi-ink); font-weight: 700; }
  td.ok .cell { color: var(--ok-ink); font-weight: 700; }
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

  /* ────────────────────────────────────────────────────────────────
     Vue mobile (liste verticale) — voir `isMobile` dans le script.
     Chips de dates en défilement horizontal, une ligne par paramètre avec
     un grand champ de saisie tactile (`min-height: 44px`, 16px pour ne pas
     déclencher le zoom automatique de Safari iOS à la prise de focus).
     ──────────────────────────────────────────────────────────────── */
  .mobilegrid { display: flex; flex-direction: column; gap: 10px; }
  .mchips {
    display: flex; gap: 8px; overflow-x: auto; padding: 2px 2px 6px;
    -webkit-overflow-scrolling: touch;
  }
  .mchip {
    flex: 0 0 auto; min-height: 44px; padding: 0 16px; border-radius: 999px;
    background: var(--panel-2); border: 1px solid var(--border-strong); color: var(--muted);
    font-size: 13.5px; font-weight: 700; display: flex; align-items: center;
    font-variant-numeric: tabular-nums; white-space: nowrap;
  }
  .mchip.on { background: var(--accent); color: #fff; border-color: var(--accent); }
  input.mchip.madd {
    color: var(--faint); font-weight: 600; text-align: center; width: 96px;
    font-variant-numeric: initial;
  }
  input.mchip.madd:focus { color: var(--ink); outline: none; box-shadow: 0 0 0 3px var(--accent-soft); }

  .mdatebar { display: flex; align-items: center; gap: 6px; padding: 0 2px; }
  .mdate-label { font-size: 13px; font-weight: 700; color: var(--muted); font-variant-numeric: tabular-nums; }
  .micon {
    min-width: 44px; min-height: 44px; border: none; background: transparent; color: var(--faint);
    font-size: 15px; display: inline-flex; align-items: center; justify-content: center; padding: 0;
  }
  .micon:hover { color: var(--accent); background: var(--panel-2); }

  .mconfirm {
    display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
    background: var(--warn-bg); color: var(--warn-ink); border: 1px solid #f0d9a8;
    border-radius: 8px; padding: 10px 12px; font-size: 13px;
  }

  .mempty { color: var(--faint); font-size: 13.5px; padding: 20px 4px; text-align: center; }

  .mlist { display: flex; flex-direction: column; background: var(--panel); border: 1px solid var(--border-strong); border-radius: var(--radius); overflow: hidden; }
  .mrow {
    display: flex; align-items: center; gap: 10px; padding: 4px 12px;
    border-bottom: 1px solid var(--border); min-height: 60px;
  }
  .mrow:last-child { border-bottom: none; }
  .mname {
    flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 8px;
    border: none; background: transparent; padding: 8px 4px; text-align: left; min-height: 44px;
  }
  .mname:hover { background: var(--panel-2); }
  .mn { font-size: 14.5px; font-weight: 700; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mu { font-size: 11.5px; color: var(--faint); white-space: nowrap; }
  .mval {
    width: 108px; flex: 0 0 auto; text-align: right; font-size: 16px;
    min-height: 44px; padding: 8px 12px; font-variant-numeric: tabular-nums;
  }
  /* Mise en évidence hors-norme (même bascule/logique que la grille desktop —
     `celluleStatut`), portée directement par le champ ici (pas de `<td>`
     séparé dans une liste). */
  .mval.hi { background: var(--hi-bg); color: var(--hi-ink); font-weight: 700; border-color: #e3b6b0; }
  .mval.ok { color: var(--ok-ink); font-weight: 700; }

  .madd-row { position: relative; padding: 8px 12px 12px; }
  .mnew { width: 100%; min-height: 44px; font-size: 15px; color: var(--faint); }
  .mnew:focus { color: var(--ink); }
  .mobile-suggest { position: absolute; top: 100%; left: 12px; right: 12px; }
  .mobile-suggest .sg { min-height: 44px; }
  .mparamed { margin: 0 0 4px; }

  /* L'astuce Ctrl+V n'a pas de sens au doigt : le collage de tableau reste
     accessible (long-appui → coller, selon le clavier du téléphone), mais
     l'indice visuel ne concerne que le clavier physique. */
  @media (max-width: 640px) {
    .astuce { display: none; }
    .modeseg { align-self: stretch; width: 100%; }
    .modeseg button { flex: 1; min-height: 44px; font-size: 13.5px; }
    .add-serie { min-height: 44px; padding: 8px 14px; }
  }
</style>
