<script lang="ts">
  // ──────────────────────────────────────────────────────────────
  // ÉCRAN D'IMPORT — il ne fait qu'une chose.
  //
  // On colle (Ctrl+V), la lecture part toute seule, le tableau s'affiche, les
  // cases dont la LECTURE est douteuse sont en jaune. Rien d'autre : pas de
  // dépliant d'options, pas de curseur de contraste, pas de bouton « Lire ».
  //
  // Le jaune ne dit jamais « ce patient va mal » : il dit « je ne suis pas sûr
  // d'avoir bien lu ». Une CRP à 96 mg/L correctement lue reste blanche.
  // L'anormalité clinique, elle, s'affiche sur la figure.
  // ──────────────────────────────────────────────────────────────
  import { store } from '../../lib/models/store.svelte';
  import { loadImage, type CropRect } from '../../lib/ocr/image';
  import { isPdf, pdfToCanvases, canvasToImage } from '../../lib/ocr/pdf';
  import { preheatOcr } from '../../lib/ocr/ocr';
  import { reconnaitreTableau, type TableauLu } from '../../lib/ocr/pipeline';
  import { parseReport, type ExtractedTreatment } from '../../lib/text/reportParser';
  import { todayISO, uid, formatDate, parseDateSouple } from '../../lib/models/types';
  import { matchCatalog } from '../../lib/models/catalog';
  import { learnAnalyte, lookupAnalyte, learnDrug, getKnownDrugs } from '../../lib/learn/memory';
  import { uiBus } from '../../lib/models/ui.svelte';

  let { initialMode = 'photo', onImported = () => {} }: { initialMode?: 'photo' | 'text'; onImported?: () => void } = $props();
  // svelte-ignore state_referenced_locally
  const importMode = initialMode;

  // Le premier import doit paraître instantané : on chauffe le moteur dès que
  // l'écran s'ouvre, pendant que le médecin cherche sa capture.
  preheatOcr();

  // Collage global d'image (Ctrl+V n'importe où) → traité ici
  $effect(() => {
    if (uiBus.pendingImage) {
      const f = uiBus.consumeImage();
      if (f) useFile(f);
    }
  });

  // ── Import texte (compte-rendu / carré bleu) ──
  type TRow = ExtractedTreatment & { include: boolean; origName: string };
  let reportText = $state('');
  let trows = $state<TRow[]>([]);
  let analyzed = $state(false);

  function analyzeText() {
    const list = parseReport(reportText, getKnownDrugs());
    trows = list.map(t => ({ ...t, include: true, origName: t.name }));
    analyzed = true;
  }

  /** Fin par défaut d'une décroissance repérée dans un compte-rendu. */
  function plusSixMois(iso: string): string {
    const d = new Date(iso);
    d.setMonth(d.getMonth() + 6);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function commitText() {
    const rows = [...trows].filter(r => r.include && r.name.trim())
      .sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999'));
    const openByName = new Map<string, string>(); // nom normalisé → id du traitement ouvert
    const nrm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    let added = 0, ended = 0;
    for (const r of rows) {
      if (r.isStop && r.date) {
        const id = openByName.get(nrm(r.name));
        if (id) { store.updateTreatment(id, { end: r.date }); ended++; continue; }
        continue; // arrêt sans traitement ouvert correspondant → ignoré
      }
      const t = store.addTreatment({
        name: r.name.trim(), dose: r.dose, kind: r.kind, start: r.date ?? todayISO(),
      });
      // « avec décroissance progressive » dans le compte-rendu : on amorce les
      // paliers à partir de la dose lue, plutôt que de détecter sans rien faire.
      if (r.taper && r.kind === 'continuous') {
        const n = (r.dose ?? '').match(/-?\d+(?:[.,]\d+)?/);
        const depart = n ? parseFloat(n[0].replace(',', '.')) : 0;
        if (depart > 0) {
          store.updateTreatment(t.id, {
            dosePoints: [{ date: t.start, dose: depart }, { date: plusSixMois(t.start), dose: 0 }],
            doseUnit: 'mg/j',
          });
        }
      }
      added++;
      learnDrug(r.origName, r.name); // apprentissage : retenir ce médicament
      if (r.kind === 'continuous') openByName.set(nrm(r.name), t.id);
    }
    trows = []; analyzed = false; reportText = '';
    uiBus.toast(`${added} traitement(s) ajouté(s)${ended ? `, ${ended} fin(s) de traitement` : ''}.`);
    onImported();
  }

  // ── Import d'une capture ─────────────────────────────────────

  type Shot = { id: string; img: HTMLImageElement; thumb: string; crop?: CropRect | null };
  let pending = $state<Shot[]>([]);
  let busy = $state(false);
  let etape = $state('');
  let progres = $state(0);
  let errorMsg = $state('');
  let annulee = false;
  let minuterie: ReturnType<typeof setTimeout> | null = null;

  /** Ligne du tableau de vérification. Le doute est un doute de LECTURE. */
  type VRow = {
    include: boolean;
    name: string;
    nameDoute: boolean;
    nameMotifs: string[];
    unit: string;             // hors écran : l'unité vient du catalogue
    values: string[];
    doutes: boolean[];
    motifs: string[][];
    thumb?: string;
    origName: string;
  };
  let vDates = $state<string[]>([]);
  let vDatesDoute = $state<boolean[]>([]);
  let vDatesMotifs = $state<string[][]>([]);
  let vRows = $state<VRow[]>([]);

  const normName = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

  function shotThumb(image: HTMLImageElement): string {
    const w = 120, scale = Math.min(1, w / image.naturalWidth);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(image.naturalWidth * scale));
    c.height = Math.max(1, Math.round(image.naturalHeight * scale));
    c.getContext('2d')!.drawImage(image, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  }

  /** Applique le recadrage de confidentialité (en-tête patient) avant lecture. */
  function recadrer(sh: Shot): HTMLCanvasElement | HTMLImageElement {
    if (!sh.crop) return sh.img;
    const { x, y, w, h } = sh.crop;
    const W = sh.img.naturalWidth, H = sh.img.naturalHeight;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * W));
    c.height = Math.max(1, Math.round(h * H));
    c.getContext('2d')!.drawImage(sh.img, Math.round(x * W), Math.round(y * H), c.width, c.height, 0, 0, c.width, c.height);
    return c;
  }

  async function useFile(file: File) {
    errorMsg = '';
    if (isPdf(file)) {
      busy = true; etape = 'Ouverture du PDF…';
      try {
        const { canvases } = await pdfToCanvases(file);
        if (!canvases.length) { errorMsg = 'Ce PDF ne contient aucune page lisible.'; return; }
        for (const cv of canvases) {
          const image = await canvasToImage(cv);
          pending = [...pending, { id: uid(), img: image, thumb: shotThumb(image) }];
        }
        planifierLecture();
      } catch (e: any) {
        errorMsg = 'Lecture du PDF impossible : ' + (e?.message || e);
      } finally {
        busy = false; etape = '';
      }
      return;
    }
    const src = URL.createObjectURL(file);
    try {
      const image = await loadImage(src);
      pending = [...pending, { id: uid(), img: image, thumb: shotThumb(image) }];
      planifierLecture();
    } catch {
      errorMsg = "Je n’ai pas su ouvrir cette image.";
    }
  }

  /**
   * Coller EST la commande : il n'y a pas de bouton « Lire ». On attend une
   * demi-seconde pour laisser le temps de coller la deuxième et la troisième
   * capture d'un bilan, puis on lit tout d'un coup.
   */
  function planifierLecture() {
    if (minuterie) clearTimeout(minuterie);
    minuterie = setTimeout(() => { minuterie = null; lireTout(); }, 500);
  }

  async function lireTout() {
    if (!pending.length || busy) return;
    busy = true; annulee = false; errorMsg = ''; progres = 0;
    // Le tableau de vérification d'un collage précédent, s'il y en a un, reste
    // affiché pendant la lecture : `fusionner` s'appuiera dessus pour ajouter
    // cette capture au lieu de l'effacer (voir son commentaire).
    const tableaux: { t: TableauLu; source: Shot }[] = [];
    const echecs: string[] = [];
    try {
      let n = 0;
      for (const sh of pending) {
        n++;
        const prefixe = pending.length > 1 ? `Capture ${n}/${pending.length} — ` : '';
        const t = await reconnaitreTableau(recadrer(sh), {
          vignettes: true,
          annule: () => annulee,
          onProgress: (fait, total, e) => {
            etape = prefixe + e;
            progres = total ? fait / total : 0;
          },
        });
        if (annulee) return;
        if (t.echec) echecs.push(t.message);
        else tableaux.push({ t, source: sh });
      }
      if (!tableaux.length) {
        errorMsg = echecs[0] ?? 'Je n’ai pas su lire cette capture.';
        return;
      }
      fusionner(tableaux.map(x => x.t));
      if (echecs.length) {
        errorMsg = `${echecs.length} capture(s) sur ${pending.length} n’ont pas pu être lues : ${echecs[0]}`;
      }
      pending = [];
    } catch (e: any) {
      errorMsg = 'La lecture a échoué : ' + (e?.message || e);
    } finally {
      busy = false; etape = ''; progres = 0;
    }
  }

  /**
   * Consolide de nouvelles captures dans le tableau de vérification.
   *
   * Coller EST la commande, sans écran intermédiaire : la deuxième capture
   * d'un bilan sur trois écrans doit s'ajouter au tableau déjà affiché, pas
   * l'effacer. On repart donc de l'état actuel (`vDates`/`vRows`, éventuel
   * fruit d'un collage précédent) plutôt que de tableaux vides — les captures
   * lues plus tôt gardent leurs colonnes et leurs éventuelles corrections
   * manuelles déjà faites par le médecin.
   */
  function fusionner(tableaux: TableauLu[]) {
    const colonnes: string[] = [...vDates];
    const douteCol: boolean[] = [...vDatesDoute];
    const motifsCol: string[][] = [...vDatesMotifs];
    const indexCol = new Map<string, number>();
    colonnes.forEach((iso, i) => { if (iso) indexCol.set('d:' + iso, i); });
    const parNom = new Map<string, VRow>();
    for (const r of vRows) {
      parNom.set(normName(r.name), { ...r, values: [...r.values], doutes: [...r.doutes], motifs: r.motifs.map(m => [...m]) });
    }
    let sansDate = 0;

    for (const t of tableaux) {
      const local: number[] = [];
      t.dates.forEach((d, i) => {
        const cle = d.iso ? 'd:' + d.iso : 'x:' + (sansDate++);
        if (!indexCol.has(cle)) {
          indexCol.set(cle, colonnes.length);
          colonnes.push(d.iso ?? '');
          douteCol.push(d.douteux);
          motifsCol.push(d.motifs);
        }
        local[i] = indexCol.get(cle)!;
      });
      for (const l of t.lignes) {
        const appris = lookupAnalyte(l.nom);
        const nom = appris ? appris.name : l.nom;
        const cle = normName(nom);
        let ligne = parNom.get(cle);
        if (!ligne) {
          ligne = {
            include: true, name: nom, nameDoute: l.nomDouteux, nameMotifs: l.nomMotifs,
            unit: appris && appris.unit ? appris.unit : l.unite,
            values: [], doutes: [], motifs: [], thumb: l.vignette, origName: l.nom,
          };
          parNom.set(cle, ligne);
        }
        l.cellules.forEach((c, i) => {
          const gi = local[i];
          if (gi === undefined) return;
          ligne!.values[gi] = c.texte;
          ligne!.doutes[gi] = c.douteux;
          ligne!.motifs[gi] = c.motifs;
        });
      }
    }

    vDates = colonnes;
    vDatesDoute = douteCol;
    vDatesMotifs = motifsCol;
    vRows = [...parNom.values()].map(r => ({
      ...r,
      values: colonnes.map((_, i) => r.values[i] ?? ''),
      doutes: colonnes.map((_, i) => r.doutes[i] ?? false),
      motifs: colonnes.map((_, i) => r.motifs[i] ?? []),
      include: colonnes.some((_, i) => (r.values[i] ?? '') !== ''),
    }));
  }

  function removeShot(id: string) {
    pending = pending.filter(s => s.id !== id);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    for (const f of Array.from(e.dataTransfer?.files ?? [])) {
      if (f.type.startsWith('image/')) useFile(f);
      else if (isPdf(f)) { useFile(f); break; }
    }
  }
  function onSelect(e: Event) {
    for (const f of Array.from((e.target as HTMLInputElement).files ?? [])) useFile(f);
  }

  // ── Recadrage de confidentialité (masquer l'en-tête patient) ──
  let cropShot = $state<Shot | null>(null);
  let cropCanvas = $state<HTMLCanvasElement>();
  let csDragStart: { x: number; y: number } | null = null;
  let csRect = $state<CropRect | null>(null);

  function openShotCrop(sh: Shot) { cropShot = sh; csRect = sh.crop ?? null; }
  $effect(() => {
    if (!cropShot || !cropCanvas) return;
    const im = cropShot.img;
    const maxW = 520, scale = Math.min(1, maxW / im.naturalWidth);
    cropCanvas.width = Math.round(im.naturalWidth * scale);
    cropCanvas.height = Math.round(im.naturalHeight * scale);
    cropCanvas.getContext('2d')!.drawImage(im, 0, 0, cropCanvas.width, cropCanvas.height);
  });
  function csDown(e: PointerEvent) {
    if (!cropCanvas) return;
    const r = cropCanvas.getBoundingClientRect();
    csDragStart = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
    csRect = { x: csDragStart.x, y: csDragStart.y, w: 0, h: 0 };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }
  function csMove(e: PointerEvent) {
    if (!csDragStart || !cropCanvas) return;
    const r = cropCanvas.getBoundingClientRect();
    const cx = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const cy = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    csRect = { x: Math.min(csDragStart.x, cx), y: Math.min(csDragStart.y, cy), w: Math.abs(cx - csDragStart.x), h: Math.abs(cy - csDragStart.y) };
  }
  function csUp() { csDragStart = null; }
  function applyShotCrop() {
    if (cropShot) {
      cropShot.crop = csRect && csRect.w > 0.02 && csRect.h > 0.02 ? { ...csRect } : null;
      pending = [...pending];
    }
    cropShot = null;
  }

  // ── Ajout au graphique ────────────────────────────────────────

  function catalogHint(name: string): string {
    const m = matchCatalog(name);
    return m ? `→ ${m.name} (${m.unit})` : '';
  }

  function commit() {
    let added = 0;
    for (const r of vRows) {
      if (!r.include || !r.name.trim()) continue;
      learnAnalyte(r.origName, r.name, r.unit); // apprentissage des corrections
      const param = store.resolveParameter(r.name.trim(), r.unit.trim());
      r.values.forEach((raw, i) => {
        const date = vDates[i];
        if (!date) return;
        const t = raw.trim();
        if (t === '') return;
        let qualifier: '<' | '>' | null = null;
        let rest = t;
        if (t[0] === '<' || t[0] === '>') { qualifier = t[0] as '<' | '>'; rest = t.slice(1); }
        const v = parseFloat(rest.replace(',', '.'));
        if (!isNaN(v)) { store.setMeasurement(param.id, date, v, qualifier); added++; }
      });
    }
    vRows = []; vDates = []; vDatesDoute = []; vDatesMotifs = []; pending = [];
    uiBus.toast(`${added} valeur(s) ajoutée(s) au graphique.`);
    onImported();
  }

  const hasValidation = $derived(vRows.length > 0);

  /** Colonnes qui portent une valeur (ligne incluse) mais dont la date est vide. */
  const missingDateCols = $derived.by(() => {
    const cols = new Set<number>();
    for (const r of vRows) {
      if (!r.include) continue;
      r.values.forEach((v, i) => { if (v.trim() !== '' && !vDates[i]) cols.add(i); });
    }
    return cols;
  });
  const hasMissingDate = $derived(missingDateCols.size > 0);
  const nbJaunes = $derived(
    vRows.reduce((s, r) => s + r.doutes.filter(Boolean).length + (r.nameDoute ? 1 : 0), 0)
    + vDatesDoute.filter(Boolean).length,
  );

  // Annulation réversible de la vérification (Échap global / bouton Annuler).
  function cancelValidation() {
    if (!vRows.length && !vDates.length) return;
    const rows = vRows, dates = vDates, dd = vDatesDoute, dm = vDatesMotifs;
    vRows = []; vDates = []; vDatesDoute = []; vDatesMotifs = [];
    uiBus.toastAction('Vérification annulée.', 'Annuler', () => {
      vRows = rows; vDates = dates; vDatesDoute = dd; vDatesMotifs = dm;
    });
  }

  // Entrée = Ajouter, mais jamais depuis un champ (là il faut Ctrl+Entrée).
  // Échap depuis un champ rend le focus ; Échap global annule (réversible).
  function onValidationKey(e: KeyboardEvent) {
    if (!hasValidation) return;
    const el = e.target as HTMLElement | null;
    const inField = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
    if (e.key === 'Enter') {
      const commitWanted = inField ? (e.ctrlKey || e.metaKey) : (!e.shiftKey && !e.ctrlKey && !e.metaKey);
      if (commitWanted && !hasMissingDate) { e.preventDefault(); commit(); }
    } else if (e.key === 'Escape') {
      if (inField) { (el as HTMLInputElement).blur(); return; }
      e.preventDefault();
      cancelValidation();
    }
  }

  const infobulle = (motifs: string[]) => (motifs.length ? 'À vérifier : ' + motifs.join(' ; ') : '');
</script>

<svelte:window onkeydown={onValidationKey} />

<div class="col" style="gap:14px;">
  {#if importMode === 'text'}
    <div class="card" style="padding:12px;">
      <p class="faint small" style="margin-bottom:8px;">Collez le « carré bleu » (ou tout compte-rendu), ou dictez-le directement ici (Dragon). J'en extrais les <strong>lignes thérapeutiques</strong> — vous validez avant d'ajouter. 100% local.</p>
      <!-- svelte-ignore a11y_autofocus -->
      <textarea class="report" bind:value={reportText} placeholder="Collez ou dictez ici le texte du compte-rendu…" autofocus></textarea>
      <div class="row" style="margin-top:8px;">
        <div class="spacer"></div>
        <button class="primary" disabled={!reportText.trim()} onclick={analyzeText}>Analyser</button>
      </div>
    </div>

    {#if analyzed}
      {#if trows.length}
        <div class="card" style="padding:12px;">
          <div class="row" style="margin-bottom:8px;"><strong>Traitements détectés</strong><span class="faint small"> — décochez/corrigez avant d'ajouter.</span></div>
          <div style="overflow-x:auto;">
            <table class="grid vgrid">
              <thead>
                <tr><th></th><th style="text-align:left;">Traitement</th><th>Dose</th><th>Type</th><th>Date</th><th></th></tr>
              </thead>
              <tbody>
                {#each trows as r, ri (ri)}
                  <tr class:excluded={!r.include}>
                    <td><input type="checkbox" bind:checked={r.include} /></td>
                    <td class="name"><input class="ninp" bind:value={r.name} /></td>
                    <td><input class="uinp" bind:value={r.dose} /></td>
                    <td>
                      <select bind:value={r.kind}>
                        <option value="continuous">Continu</option>
                        <option value="event">Événement</option>
                      </select>
                    </td>
                    <td><input class="dinp" type="text" inputmode="numeric" placeholder="JJ/MM/AAAA" value={r.date ? formatDate(r.date) : ''}
                      onblur={(e) => { const brut = e.currentTarget.value; if (!brut.trim()) { r.date = null; return; } const iso = parseDateSouple(brut); if (iso) { r.date = iso; e.currentTarget.value = formatDate(iso); } }}
                      onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.currentTarget as HTMLInputElement).blur(); } }} /></td>
                    <td class="flags">
                      {#if r.isStop}<span class="flag stop">arrêt</span>{/if}
                      {#if r.taper}<span class="flag taper">↘ décroissance</span>{/if}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
          <p class="faint" style="font-size:12px;margin-top:6px;">« arrêt X » ferme la barre du traitement X (fin). « décroissance » : ajoutez les paliers dans l'onglet Repères après l'ajout.</p>
          <div class="row" style="margin-top:10px;">
            <span class="faint small">{trows.filter(r => r.include).length} sélectionné(s)</span>
            <div class="spacer"></div>
            <button onclick={() => { trows = []; analyzed = false; }}>Annuler</button>
            <button class="primary" onclick={commitText}>Ajouter au graphique</button>
          </div>
        </div>
      {:else}
        <div class="callout">Aucune ligne thérapeutique reconnue. Vérifiez que le texte contient des médicaments datés (ex. « Mai 2020 : CELLCEPT 3 g/jour »).</div>
      {/if}
    {/if}

  {:else}
    {#if !hasValidation && !pending.length && !busy}
      <div class="drop" role="button" tabindex="0"
           ondrop={onDrop} ondragover={(e) => e.preventDefault()}>
        <p class="drop-title"><strong>Collez une capture d'écran</strong> (Ctrl+V)</p>
        <p class="muted small">ou glissez une image / un PDF ici · <label class="filebtn">choisir un fichier<input type="file" accept="image/*,application/pdf" capture="environment" multiple onchange={onSelect} hidden /></label></p>
        <p class="local" style="margin-top:12px;">🔒 100% local — rien n'est envoyé.</p>
        <p class="faint small" style="margin-top:4px;">Plusieurs bilans ? Collez-les à la suite : ils formeront un seul tableau.</p>
      </div>
    {/if}

    {#if pending.length || busy}
      <div class="card" style="padding:12px;">
        <div class="row wrap" style="margin-bottom:8px;">
          <strong>{pending.length > 1 ? `${pending.length} captures` : 'Capture'}</strong>
          <span class="faint small">— lecture automatique.</span>
          <div class="spacer"></div>
          <span class="local small">🔒 100% local</span>
        </div>
        <div class="shots">
          {#each pending as sh (sh.id)}
            <div class="shot">
              <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
              <img src={sh.thumb} alt="capture" title="Cliquer pour recadrer (exclure l'en-tête patient)" onclick={() => openShotCrop(sh)} />
              {#if sh.crop}<span class="shot-crop" title="Recadrée">✂</span>{/if}
              {#if !busy}<button class="shot-x" title="Retirer" onclick={() => removeShot(sh.id)}>✕</button>{/if}
            </div>
          {/each}
          {#if !busy}
            <label class="shot add" title="Ajouter une capture">
              +<input type="file" accept="image/*" capture="environment" multiple onchange={onSelect} hidden />
            </label>
          {/if}
        </div>
        {#if busy}
          <div class="prog"><div class="bar" style="width:{Math.round(progres * 100)}%"></div></div>
          <p class="faint small">{etape}</p>
        {:else}
          <p class="faint small" style="margin-top:8px;">Cliquez une vignette pour la recadrer et exclure l'en-tête patient.</p>
        {/if}
      </div>
    {/if}

    {#if errorMsg}
      <div class="echec">
        <strong>Je n'ai pas su lire cette capture.</strong>
        <p>{errorMsg}</p>
        <p class="faint small">Essayez une capture plus large ou plus nette (le tableau entier, sans zoom arrière), ou collez le tableau depuis Excel dans la grille.</p>
      </div>
    {/if}

    {#if hasValidation}
      <div class="card" style="padding:12px;">
        <div class="row wrap" style="margin-bottom:8px;">
          <strong>Vérification</strong>
          <span class="faint small">— corrigez puis ajoutez.</span>
          <div class="spacer"></div>
          <span class="local small">🔒 100% local — rien n'est envoyé</span>
        </div>
        <p class="consigne">
          {#if nbJaunes}
            <span class="pastille"></span> Les cases en <strong>jaune</strong> sont à vérifier : je ne suis pas sûr de les avoir bien lues.
          {:else}
            Tout a été lu sans hésitation. Vérifiez d'un coup d'œil, puis ajoutez.
          {/if}
        </p>
        <div style="overflow-x:auto;">
          <table class="grid vgrid">
            <thead>
              <tr>
                <th></th>
                <th style="text-align:left;">Image</th>
                <th style="text-align:left;">Analyte</th>
                {#each vDates as _d, i (i)}
                  <th class:doute={vDatesDoute[i] || missingDateCols.has(i)}>
                    <input class="dinp" type="text" inputmode="numeric" placeholder="JJ/MM/AAAA" value={vDates[i] ? formatDate(vDates[i]) : ''}
                           onblur={(e) => { const brut = e.currentTarget.value; if (!brut.trim()) { vDates[i] = ''; return; } const iso = parseDateSouple(brut); if (iso) { vDates[i] = iso; e.currentTarget.value = formatDate(iso); } }}
                           onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.currentTarget as HTMLInputElement).blur(); } }}
                           title={missingDateCols.has(i) ? 'Date manquante : renseignez-la avant d’ajouter' : infobulle(vDatesMotifs[i] ?? [])} />
                  </th>
                {/each}
              </tr>
            </thead>
            <tbody>
              {#each vRows as row, ri (ri)}
                <tr class:excluded={!row.include}>
                  <td><input type="checkbox" bind:checked={row.include} /></td>
                  <td class="thumb">{#if row.thumb}<img src={row.thumb} alt="ligne d'origine" />{/if}</td>
                  <td class="name" class:doute={row.nameDoute}>
                    <input class="ninp" bind:value={row.name} title={infobulle(row.nameMotifs)} />
                    {#if catalogHint(row.name)}<div class="faint" style="font-size:12px;">{catalogHint(row.name)}</div>{/if}
                  </td>
                  {#each row.values as _v, ci (ci)}
                    <td class:doute={row.doutes[ci]}>
                      <input bind:value={row.values[ci]} title={infobulle(row.motifs[ci] ?? [])} />
                    </td>
                  {/each}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        {#if hasMissingDate}
          <div class="callout" style="background:var(--warn-bg);color:var(--warn-ink);border-color:#f0d9a8;margin-top:10px;">
            {missingDateCols.size} colonne(s) sans date. Renseignez chaque date avant d'ajouter — aucune date n'est devinée à votre place.
          </div>
        {/if}
        <div class="row" style="margin-top:10px;">
          <span class="faint small">{vRows.filter(r => r.include).length} ligne(s) · <span class="kbd">Ctrl+Entrée</span> pour ajouter</span>
          <div class="spacer"></div>
          <button onclick={cancelValidation}>Annuler</button>
          <button class="primary" disabled={hasMissingDate} onclick={commit} title={hasMissingDate ? 'Renseignez les dates manquantes' : ''}>Ajouter au graphique</button>
        </div>
      </div>
    {/if}
  {/if}
</div>

{#if cropShot}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="cs-overlay" onclick={() => (cropShot = null)}>
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="cs-modal" onclick={(e) => e.stopPropagation()}>
      <div class="cs-head">Confidentialité — glissez pour ne garder que le tableau (exclut l'en-tête patient).</div>
      <div class="cs-canvaswrap">
        <canvas bind:this={cropCanvas} style="touch-action:none;cursor:crosshair;"
                onpointerdown={csDown} onpointermove={csMove} onpointerup={csUp}></canvas>
        {#if csRect}
          <div class="croprect" style="left:{csRect.x * 100}%; top:{csRect.y * 100}%; width:{csRect.w * 100}%; height:{csRect.h * 100}%;"></div>
        {/if}
      </div>
      <div class="row" style="margin-top:10px;">
        <button class="ghost small" onclick={() => (csRect = null)}>Effacer le cadre</button>
        <div class="spacer"></div>
        <button onclick={() => (cropShot = null)}>Annuler</button>
        <button class="primary" onclick={() => { applyShotCrop(); planifierLecture(); }}>Valider</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .drop {
    border: 2px dashed var(--border-strong); border-radius: 12px; padding: 40px 16px;
    text-align: center; color: var(--muted); background: var(--panel-2);
  }
  .drop p { margin: 4px 0; }
  .drop-title { font-size: 16px; }
  .filebtn { color: var(--accent); text-decoration: underline; cursor: pointer; }
  .local { color: var(--ok, #14683e); font-weight: 600; font-size: 13px; }
  .local.small { font-size: 12px; }
  .kbd { display: inline-block; background: var(--panel-2); border: 1px solid var(--border); border-radius: 4px; padding: 0 5px; font-size: 11px; color: var(--muted); }

  .consigne { font-size: 13px; color: var(--ink); margin: 0 0 10px; }
  .pastille { display: inline-block; width: 12px; height: 12px; border-radius: 3px; background: var(--warn-bg); border: 1px solid #e0a33a; vertical-align: -1px; margin-right: 4px; }

  .echec { border: 1px solid #e3b6b0; background: #fbecea; color: #8a2b20; border-radius: 10px; padding: 12px 14px; }
  .echec p { margin: 6px 0 0; font-size: 13px; }

  .shots { display: flex; flex-wrap: wrap; gap: 8px; }
  .shot { position: relative; width: 96px; height: 68px; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; background: var(--panel-2); }
  .shot img { width: 100%; height: 100%; object-fit: cover; display: block; cursor: pointer; }
  .shot-x { position: absolute; top: 2px; right: 2px; width: 20px; height: 20px; padding: 0; border: none; border-radius: 50%; background: rgba(27,39,51,.75); color: #fff; font-size: 11px; line-height: 1; }
  .shot-x:hover { background: var(--danger); }
  .shot-crop { position: absolute; bottom: 2px; left: 2px; background: rgba(20,104,62,.9); color: #fff; font-size: 10px; padding: 1px 5px; border-radius: 6px; }
  .shot.add { display: flex; align-items: center; justify-content: center; font-size: 26px; color: var(--muted); border-style: dashed; cursor: pointer; }
  .shot.add:hover { color: var(--accent); border-color: var(--accent); }

  .cs-overlay { position: fixed; inset: 0; background: rgba(16,24,32,.5); z-index: 100; display: flex; align-items: center; justify-content: center; padding: 20px; }
  .cs-modal { background: var(--panel); border-radius: 14px; box-shadow: 0 20px 50px rgba(16,24,32,.35); padding: 14px; max-width: 92vw; }
  .cs-head { font-size: 13px; color: var(--muted); margin-bottom: 10px; max-width: 540px; }
  .cs-canvaswrap { position: relative; display: inline-block; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
  .cs-canvaswrap canvas { display: block; max-width: 100%; }
  .croprect { position: absolute; border: 2px solid var(--accent); background: rgba(42,111,176,.12); pointer-events: none; }

  .prog { height: 6px; background: #e6ebef; border-radius: 4px; overflow: hidden; margin-top: 10px; }
  .prog .bar { height: 100%; background: var(--accent); transition: width .2s; }

  .vgrid input { width: 62px; }
  .vgrid .ninp { width: 140px; text-align: left; }
  .vgrid .dinp { width: 128px; }
  /* UNE seule couleur de signalement : le jaune, et il ne dit qu'une chose —
     « je ne suis pas sûr d'avoir bien LU cette case ». */
  .vgrid td.doute, .vgrid th.doute { background: var(--warn-bg); box-shadow: inset 0 0 0 1.5px #e0a33a; }
  .vgrid tr.excluded { opacity: .45; }
  .vgrid td.thumb { padding: 2px; }
  .vgrid td.thumb img { display: block; max-height: 34px; max-width: 260px; border: 1px solid var(--border); border-radius: 3px; }

  .report { width: 100%; min-height: 260px; resize: vertical; font-size: 13px; line-height: 1.5; }
  .vgrid .flags { white-space: nowrap; }
  .flag { font-size: 12px; padding: 1px 6px; border-radius: 9px; margin-right: 3px; }
  .flag.stop { background: #eee; color: #666; }
  .flag.taper { background: #e6eff8; color: #2a6fb0; }
  .vgrid .uinp { width: 66px; }
</style>
