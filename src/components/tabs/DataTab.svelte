<script lang="ts">
  import { tick } from 'svelte';
  import { store } from '../../lib/models/store.svelte';
  import { formatDate, parseDateSouple, todayISO } from '../../lib/models/types';
  import { uiBus } from '../../lib/models/ui.svelte';
  import { parseGridPaste } from '../../lib/text/gridPaste';
  import AddParameter from './AddParameter.svelte';
  import ParamEditor from './ParamEditor.svelte';
  import ImportTab from './ImportTab.svelte';

  let selectedId = $state<string | null>(null);
  let showAdd = $state(false);

  // Vue « Saisir » (grille) ou « Importer » (capture / compte-rendu)
  let mode = $state<'saisir' | 'importer'>('saisir');
  let importInitial = $state<'photo' | 'text'>('photo');
  function openImport(kind: 'photo' | 'text') { importInitial = kind; mode = 'importer'; }

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

  // Collage d'un tableau (Excel / texte) → écran de vérification (pas d'écriture directe)
  $effect(() => {
    if (!uiBus.pendingTableText) return;
    const text = uiBus.consumeTable();
    if (!text) return;
    const grid = parseGridPaste(text);
    if (!grid) { uiBus.toast("Collage non reconnu comme tableau. Copiez les cellules avec une ligne d'en-tête de dates.", 'error'); return; }
    mode = 'saisir';
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

  function commitPaste() {
    if (!pasteReview || pasteHasMissing) return;
    let added = 0;
    for (const r of pasteReview.rows) {
      if (!r.include || !r.name.trim()) continue;
      const param = store.resolveParameter(r.name.trim());
      r.values.forEach((v, i) => {
        const d = pasteReview!.dates[i];
        if (d && v !== null) { store.setMeasurement(param.id, d, v, r.qualifiers[i] ?? null); added++; }
      });
    }
    pasteReview = null;
    uiBus.toast(`${added} valeur(s) ajoutée(s) depuis le tableau collé.`);
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

  // Valeur présente à la prise de focus : sert à savoir si l'utilisateur vient
  // d'effacer quelque chose, l'écriture au fil de la frappe ayant déjà eu lieu.
  let avantEdition: { pId: string; date: string; texte: string } | null = null;
  function cellFocus(e: FocusEvent, pId: string, date: string) {
    avantEdition = { pId, date, texte: cellValue(pId, date) };
    // Sélectionner à la prise de focus : sans cela, cliquer une cellule qui
    // contient « 10 » et taper « 77 » donne « 1770 » — le clic pose un curseur
    // au lieu de sélectionner, et la valeur est corrompue sans qu'on le voie.
    (e.currentTarget as HTMLInputElement).select();
  }
  function cellInput(pId: string, date: string, raw: string) {
    // Enregistrer au fil de la frappe : sans cela, la dernière valeur tapée est
    // perdue si l'onglet est fermé sans avoir quitté le champ.
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
  function nextFreeDate(): string {
    const set = new Set(columns);
    const d = new Date(todayISO());
    while (set.has(isoOf(d))) d.setDate(d.getDate() + 1);
    return isoOf(d);
  }
  async function addDate() {
    const iso = nextFreeDate();
    store.addDateColumn(iso);
    // On enchaîne sur la saisie de la date : ajouter une colonne, c'est vouloir
    // taper sa date tout de suite, pas la chercher à la souris.
    await tick();
    const cle = cleParDate.get(iso);
    if (cle) focusEntete(cle);
  }

  // ── Série de dates ──
  // Créer douze colonnes une par une demandait douze clics puis douze saisies :
  // c'est le seul poste de friction qui grandit avec la durée du suivi.
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

  function ajouterSerie() {
    const n = Math.max(1, Math.min(40, Math.round(serieNb)));
    const pas = PAS[seriePas];
    const d = new Date(serieDepart);
    if (isNaN(d.getTime())) return;
    let ajoutees = 0;
    for (let i = 0; i < n; i++) {
      const iso = isoOf(d);
      const avant = store.columnDates.length;
      store.addDateColumn(iso);
      if (store.columnDates.length > avant) ajoutees++;
      if (pas.mois) d.setMonth(d.getMonth() + pas.mois);
      else d.setDate(d.getDate() + pas.jours);
    }
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

  /**
   * Valide le texte tapé dans l'en-tête. Une saisie illisible NE déplace rien :
   * on remet la date précédente et on le dit. Deviner à la place du médecin
   * poserait des valeurs cliniques sur une date qu'il n'a pas choisie.
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
      const iso = brut === '' ? null : parseDateSouple(brut);
      if (iso === colDate || (brut !== '' && !iso) || brut === '') {
        input.value = formatDate(colDate); // on rétablit l'affichage normalisé
        if (brut !== '' && !iso) uiBus.toast(`Date « ${brut} » non comprise : format attendu JJ/MM/AAAA.`, 'error');
        return;
      }
      changeDate(colDate, iso!);
    } finally {
      validationEnCours = false;
    }
  }

  function dateFocus(e: FocusEvent) {
    (e.currentTarget as HTMLInputElement).select();
  }

  /**
   * Valide puis rend le focus, APRÈS le rendu.
   * Déplacer un nœud dans le DOM le fait perdre le focus (le navigateur n'a pas
   * de « déplacer » : il retire puis réinsère). Comme valider une date réordonne
   * la grille, il faut attendre le rendu avant de reposer le curseur — sinon on
   * se retrouve sur `<body>` et les caractères suivants tombent dans le vide.
   */
  async function validerPuisFocus(cle: string, input: HTMLInputElement, cible: () => void) {
    validerDate(cle, input);
    await tick();
    cible();
  }

  function dateKey(e: KeyboardEvent, cle: string, colDate: string) {
    const t = e.currentTarget as HTMLInputElement;
    const i = colonnes.findIndex(c => c.cle === cle);
    const auBout = t.selectionStart === t.value.length && t.selectionStart === t.selectionEnd;
    const auDebut = t.selectionStart === 0 && t.selectionEnd === 0;
    if (e.key === 'Escape') {
      e.preventDefault();
      t.value = formatDate(colDate); // annule la frappe en cours, sans rien déplacer
      t.select();
    } else if (e.key === 'Enter' || e.key === 'ArrowDown') {
      e.preventDefault();
      validerPuisFocus(cle, t, () => (params.length ? focusCellule(cle, 0) : focusEntete(cle)));
    } else if (e.key === 'Tab') {
      // Tab enchaîne d'en-tête en en-tête : remplir une ligne de dates ne doit
      // pas traverser les boutons « calendrier » et « ✕ » à chaque colonne.
      const cible = colonnes[i + (e.shiftKey ? -1 : 1)];
      if (!cible) return; // bord de grille : on laisse le Tab naturel sortir
      e.preventDefault();
      validerPuisFocus(cle, t, () => focusEntete(cible.cle));
    } else if (e.key === 'ArrowRight' && auBout && colonnes[i + 1]) {
      const cible = colonnes[i + 1];
      e.preventDefault();
      validerPuisFocus(cle, t, () => focusEntete(cible.cle));
    } else if (e.key === 'ArrowLeft' && auDebut && colonnes[i - 1]) {
      const cible = colonnes[i - 1];
      e.preventDefault();
      validerPuisFocus(cle, t, () => focusEntete(cible.cle));
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      removeDate(colDate);
    }
  }

  function removeDate(iso: string) {
    const valeurs = store.study.measurements.filter(m => m.date === iso).length;
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

  // ── Navigation clavier (en-têtes ↔ cellules) ──────────────────
  // On cible par clé de colonne, jamais par index : au moment où l'on demande le
  // focus, le DOM n'a pas encore été réordonné par Svelte, et un index viserait
  // la colonne voisine.
  function focusEntete(cle: string) {
    const el = document.querySelector<HTMLInputElement>(`.dateinput[data-cle="${cle}"]`);
    if (el) { el.focus(); el.select(); }
  }
  function focusCellule(cle: string, r: number) {
    const el = document.querySelector<HTMLInputElement>(`.cell[data-cle="${cle}"][data-r="${r}"]`);
    if (el) { el.focus(); el.select(); }
  }

  function selectParam(id: string) {
    selectedId = selectedId === id ? null : id;
  }

  /** Déplacement d'une cellule vers une autre, en colonnes (0 = à gauche/droite). */
  function versCellule(cle: string, dc: number, r: number) {
    const i = colonnes.findIndex(c => c.cle === cle);
    const cible = colonnes[i + dc];
    if (!cible) return false;
    if (r < 0 || r >= params.length) return false;
    focusCellule(cible.cle, r);
    return true;
  }

  function cellKey(e: KeyboardEvent, pId: string, cle: string, colDate: string, r: number) {
    const t = e.currentTarget as HTMLInputElement;
    const auBout = t.selectionStart === t.value.length && t.selectionEnd === t.value.length;
    const auDebut = t.selectionStart === 0 && t.selectionEnd === 0;
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
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (r > 0) focusCellule(cle, r - 1);
      else focusEntete(cle); // depuis la 1re ligne on remonte dans l'en-tête de date
    } else if (e.key === 'Tab') {
      // Tab suit la ligne, puis passe au début de la suivante (comme un tableur).
      const i = colonnes.findIndex(c => c.cle === cle);
      if (e.shiftKey) {
        if (i > 0) { e.preventDefault(); versCellule(cle, -1, r); }
        else if (r > 0) { e.preventDefault(); focusCellule(colonnes[colonnes.length - 1].cle, r - 1); }
      } else if (i < colonnes.length - 1) { e.preventDefault(); versCellule(cle, 1, r); }
      else if (r + 1 < params.length) { e.preventDefault(); focusCellule(colonnes[0].cle, r + 1); }
    } else if (e.key === 'ArrowRight' && auBout) {
      // Navigation seulement si le curseur est en fin de champ (sinon on déplace le caret)
      e.preventDefault(); versCellule(cle, 1, r);
    } else if (e.key === 'ArrowLeft' && auDebut) {
      e.preventDefault(); versCellule(cle, -1, r);
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
    grid.forEach((line, ri) => line.forEach((val, ci) => {
      if (val.trim() === '') return;
      const p = params[r0 + ri];
      const date = columns[c0 + ci];
      if (p && date) { setCell(p.id, date, val.trim()); count++; }
      else ignored++;
    }));
    if (count || ignored) {
      const extra = ignored ? ` · ${ignored} ignorée(s) (hors grille — ajoutez des lignes/dates)` : '';
      uiBus.toast(`${count} valeur(s) collée(s)${extra}.`, ignored ? 'info' : 'success');
    }
  }
</script>

<svelte:window onkeydown={onPasteReviewKey} />

<div class="data">
  <div class="modeseg">
    <button class:on={mode === 'saisir'} onclick={() => (mode = 'saisir')}>⌨️ Saisir</button>
    <button class:on={mode === 'importer'} onclick={() => openImport('photo')}>📥 Importer</button>
  </div>

  {#if mode === 'importer'}
    <div class="aux"><ImportTab initialMode={importInitial} onImported={() => (mode = 'saisir')} /></div>
  {:else}

  {#if pasteReview}
    <div class="tablecard aux" style="padding:12px;">
      <div class="row" style="margin-bottom:8px; gap:6px; align-items:baseline;">
        <strong>Vérifier le tableau collé</strong>
        <span class="faint" style="font-size:12px;">— corrigez les dates puis ajoutez.</span>
      </div>
      {#if pasteHasMissing}
        <div class="pastewarn">⚠️ Aucune date n'est devinée. Renseignez la (les) date(s) surlignée(s) avant d'ajouter.</div>
      {/if}
      <div class="tablescroll">
        <table class="dgrid">
          <thead>
            <tr>
              <th class="corner"></th>
              {#each pasteReview.dates as _d, i (i)}
                <th class="datecol">
                  <input class="dateinput" class:datemissing={pasteMissingCols.has(i)} type="date" bind:value={pasteReview.dates[i]} />
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

  {#if params.length === 0 && !showAdd && !pasteReview}
    <div class="empty">
      <div class="empty-emoji">📈</div>
      <p class="empty-title">Commencez votre courbe</p>
      <p class="empty-sub">Choisissez comment ajouter des données :</p>
      <div class="quickstarts">
        <button class="qs" onclick={() => openImport('photo')}>
          <span class="qs-emoji">📷</span><span class="qs-t">Coller une capture</span>
          <span class="qs-d">Ctrl+V d'une capture d'écran de résultats</span>
        </button>
        <button class="qs" onclick={() => (showAdd = true)}>
          <span class="qs-emoji">⌨️</span><span class="qs-t">Saisir à la main</span>
          <span class="qs-d">Créer un paramètre et taper les valeurs</span>
        </button>
        <button class="qs" onclick={() => openImport('text')}>
          <span class="qs-emoji">📄</span><span class="qs-t">Coller un compte-rendu</span>
          <span class="qs-d">Extraire les traitements du « carré bleu »</span>
        </button>
      </div>
    </div>
  {/if}

  {#if serieOuverte}
    <div class="card aux serie">
      <div class="row wrap">
        <label class="fld">1<sup>re</sup> date<input type="date" bind:value={serieDepart} /></label>
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

  {#if params.length > 0}
    <div class="tablecard">
      <div class="tablescroll">
        <table class="dgrid">
          <thead>
            <tr>
              <th class="corner"></th>
              {#each colonnes as c (c.cle)}
                <th class="datecol">
                  <!-- Champ texte (et non `type="date"`) : le champ date natif
                       enregistre dès que ses trois segments sont remplis, donc
                       au milieu de la frappe. Ici rien n'est enregistré avant
                       Entrée / Tab / sortie du champ. -->
                  <input class="dateinput" type="text" inputmode="numeric"
                    data-cle={c.cle} aria-label="Date de la colonne {formatDate(c.date)}"
                    value={formatDate(c.date)}
                    onfocus={dateFocus}
                    onkeydown={(e) => dateKey(e, c.cle, c.date)}
                    onblur={(e) => validerDate(c.date, e.currentTarget)} />
                  <input class="datepick" type="date" tabindex="-1" aria-hidden="true" data-cle={c.cle}
                    value={c.date} onchange={(e) => { const v = e.currentTarget.value; if (v) changeDate(c.date, v); }} />
                  <button class="colicon" tabindex="-1" title="Choisir dans un calendrier"
                    onclick={() => ouvrirCalendrier(c.cle)} aria-label="Calendrier">📅</button>
                  <button class="colx" tabindex="-1" title="Supprimer cette date (Ctrl+Suppr depuis le champ)"
                    onclick={() => removeDate(c.date)}>✕</button>
                </th>
              {/each}
              <th class="addcol">
                <button class="add-date" onclick={addDate} title="Ajouter une date">+ Date</button>
                <button class="add-serie" onclick={() => (serieOuverte = !serieOuverte)}
                        title="Ajouter plusieurs dates d’un coup (suivi régulier)">+ Série</button>
              </th>
            </tr>
          </thead>
          <tbody>
            {#each params as p, ri (p.id)}
              <tr class:sel={selectedId === p.id}>
                <th class="rowname">
                  <button class="namebtn" onclick={() => selectParam(p.id)}>
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
                <td class="pad"></td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>

    {#if selected}
      <div class="aux"><ParamEditor param={selected} onClose={() => (selectedId = null)} /></div>
    {/if}
  {/if}

  {#if showAdd}
    <div class="aux"><AddParameter /></div>
    <button class="link" onclick={() => (showAdd = false)}>Fermer</button>
  {:else if params.length > 0}
    <div class="pied">
      <button class="add-param" onclick={() => (showAdd = true)}>+ Ajouter un paramètre</button>
      <!-- Le raccourci n'est annoncé que sur l'écran d'accueil : une fois le
           tableau rempli, plus personne ne sait qu'il existe. -->
      <span class="astuce">Astuce : <kbd>Ctrl</kbd>+<kbd>V</kbd> colle une capture d'écran ou un tableau de résultats.</span>
    </div>
  {/if}

  {/if}
</div>

<style>
  .data { display: flex; flex-direction: column; gap: 14px; }

  .modeseg { display: inline-flex; background: #eef1f5; border-radius: 10px; padding: 3px; align-self: flex-start; }
  .modeseg button { border: none; background: transparent; border-radius: 7px; padding: 6px 16px; font-size: 13px; color: var(--muted); }
  .modeseg button.on { background: #fff; color: var(--ink); font-weight: 600; box-shadow: 0 1px 2px rgba(16,24,32,.12); }

  /* En bandes, la grille prend toute la largeur — mais pas les blocs qui n'en
     sont pas un : un formulaire ou un écran d'accueil étiré sur 1600 px est
     illisible. On les garde dans une colonne de largeur confortable. */
  .aux { max-width: 880px; }
  .empty { text-align: center; padding: 22px 4px 6px; color: var(--muted); max-width: 620px; margin-inline: auto; }
  .empty-emoji { font-size: 32px; }
  .empty-title { font-size: 17px; font-weight: 650; color: var(--ink); margin: 8px 0 2px; }
  .empty-sub { font-size: 13px; }
  .quickstarts { display: flex; flex-direction: column; gap: 10px; margin-top: 18px; text-align: left; }
  .qs {
    display: grid; grid-template-columns: 34px 1fr; grid-template-rows: auto auto;
    column-gap: 12px; align-items: center; padding: 14px 16px; border-radius: 12px;
    border: 1px solid var(--border); background: var(--panel); box-shadow: var(--shadow-sm);
    transition: border-color .15s, box-shadow .15s, transform .06s;
  }
  .qs:hover { border-color: var(--accent); box-shadow: var(--shadow); }
  .qs-emoji { grid-row: 1 / 3; font-size: 24px; }
  .qs-t { font-size: 14.5px; font-weight: 600; color: var(--ink); }
  .qs-d { font-size: 12px; color: var(--muted); }

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

  /* Cellules figées : en-tête (haut), noms de paramètres (gauche), « + Date » (droite). */
  .dgrid thead th { position: sticky; top: 0; z-index: 2; }
  .dgrid .corner, .dgrid .rowname { position: sticky; left: 0; z-index: 3; }
  .dgrid .rowname { box-shadow: 5px 0 7px -6px rgba(16, 24, 32, .35); }
  .dgrid thead .corner { z-index: 4; box-shadow: 5px 0 7px -6px rgba(16, 24, 32, .35); }
  .dgrid thead .addcol { position: sticky; right: 0; z-index: 4; box-shadow: -5px 0 7px -6px rgba(16, 24, 32, .35); }

  .corner { width: 1%; }
  .datecol { padding: 6px 4px 6px 8px; position: relative; white-space: nowrap; border-bottom: 1px solid var(--border); }
  .dateinput { border: none; background: transparent; font-size: 12px; color: var(--muted); width: 84px; padding: 2px 3px; text-align: center; font-variant-numeric: tabular-nums; }
  .dateinput:focus { background: #fff; border-radius: 5px; box-shadow: inset 0 0 0 2px rgba(42,111,176,.25); color: var(--ink); }
  /* Le champ date natif ne sert qu'à ouvrir le calendrier du système : il reste
     dans la page (sinon `showPicker()` est refusé) mais hors du flux visuel. */
  .datepick { position: absolute; left: 8px; bottom: 0; width: 1px; height: 1px; opacity: 0; pointer-events: none; border: none; padding: 0; }
  .colx, .colicon { opacity: 0; border: none; background: transparent; color: var(--faint); font-size: 10px; padding: 2px 3px; cursor: pointer; }
  .colicon { font-size: 11px; filter: grayscale(1); }
  .datecol:hover .colx, .datecol:hover .colicon,
  .datecol:focus-within .colx, .datecol:focus-within .colicon { opacity: 1; }
  /* Sans survol possible (tablette, écran tactile) la suppression d'une colonne
     serait inatteignable : on l'affiche en permanence. */
  @media (hover: none) { .colx, .colicon { opacity: .7; } }
  .colx:hover { color: var(--danger); }
  .colicon:hover { filter: none; }

  .addcol { padding: 6px 10px; border-bottom: 1px solid var(--border); }
  .add-date, .add-serie { border: 1px dashed var(--border-strong); background: transparent; color: var(--muted); font-size: 12px; padding: 5px 10px; border-radius: 7px; white-space: nowrap; }
  .add-date:hover, .add-serie:hover { color: var(--accent); border-color: var(--accent); }
  .add-serie { margin-left: 4px; }
  .serie { padding: 10px 12px; }
  .serie .fld { display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; color: var(--muted); }
  .serie .nb { width: 62px; }

  .rowname { text-align: left; border-bottom: 1px solid var(--panel-2); border-right: 1px solid var(--border); }
  tr.sel .rowname { background: #eef4fb; }
  .namebtn { display: flex; align-items: center; gap: 7px; border: none; background: transparent; padding: 7px 12px 7px 12px; width: 100%; cursor: pointer; }
  .namebtn:hover { background: var(--panel-2); }
  .dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
  .pname { font-weight: 600; font-size: 13px; white-space: nowrap; }
  .punit { font-size: 12px; color: var(--faint); white-space: nowrap; }

  .dgrid td { border-bottom: 1px solid var(--panel-2); }
  .cell { width: 74px; text-align: center; border: none; background: transparent; padding: 7px 4px; font-size: 13px; }
  .cell:focus { background: #fff; box-shadow: inset 0 0 0 2px rgba(42,111,176,.25); border-radius: 4px; }
  .pad { width: 100%; }

  /* Panneau en bas d'écran (mobile) : la grille ne doit pas manger toute la hauteur. */
  @media (max-width: 820px) {
    .tablescroll { max-height: var(--grille-max-h, 34vh); }
  }

  .add-param { align-self: flex-start; border: none; background: transparent; color: var(--accent); font-weight: 500; padding: 6px 4px; }
  .add-param:hover { text-decoration: underline; background: transparent; }
  .pied { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
  .astuce { font-size: 11.5px; color: var(--faint); }
  .astuce kbd {
    font-family: inherit; font-size: 10.5px; background: var(--panel-2);
    border: 1px solid var(--border); border-radius: 4px; padding: 1px 4px;
  }
  .link { align-self: flex-start; border: none; background: transparent; color: var(--muted); font-size: 12.5px; }
</style>
