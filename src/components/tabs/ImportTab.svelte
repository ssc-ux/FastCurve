<script lang="ts">
  import { store } from '../../lib/models/store.svelte';
  import { loadImage, orientedCanvas, processImage, defaultProcessOptions, type ProcessOptions, type CropRect } from '../../lib/ocr/image';
  import { isPdf, pdfToCanvases, canvasToImage } from '../../lib/ocr/pdf';
  import { runOcr } from '../../lib/ocr/ocr';
  import { parseTable, type ParsedTable, type BBox } from '../../lib/ocr/tableParser';
  import { parseReport, type ExtractedTreatment } from '../../lib/text/reportParser';
  import { formatDate, todayISO, uid } from '../../lib/models/types';
  import { matchCatalog } from '../../lib/models/catalog';
  import { learnAnalyte, lookupAnalyte, learnDrug, getKnownDrugs } from '../../lib/learn/memory';
  import { uiBus } from '../../lib/models/ui.svelte';

  let { initialMode = 'photo', onImported = () => {} }: { initialMode?: 'photo' | 'text'; onImported?: () => void } = $props();
  // Volontaire : `initialMode` ne sert qu'à choisir l'onglet d'entrée. Ensuite
  // c'est l'utilisateur qui pilote `importMode`, sans être ramené en arrière.
  // svelte-ignore state_referenced_locally
  let importMode = $state<'photo' | 'text'>(initialMode);

  // Collage global d'image (Ctrl+V n'importe où) → traité ici
  $effect(() => {
    if (uiBus.pendingImage) {
      const f = uiBus.consumeImage();
      if (f) { importMode = 'photo'; useFile(f); }
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

  let img = $state<HTMLImageElement | null>(null);
  let opts = $state<ProcessOptions>(defaultProcessOptions());
  let showProcessed = $state(false);
  let showAdvanced = $state(false);
  let previewCanvas = $state<HTMLCanvasElement>();

  let ocrBusy = $state(false);
  let progress = $state(0);
  let progressLabel = $state('');
  let errorMsg = $state('');
  let ocrCancelled = false;        // annulation douce : on ignore le résultat en cours
  let triedAutoRotate = false;     // #3 : redressement auto déjà tenté sur cette image

  // Validation éditable
  type VRow = { include: boolean; name: string; unit: string; values: string[]; conf: number[]; thumb?: string; origName: string };
  let vDates = $state<string[]>([]);
  let vRows = $state<VRow[]>([]);
  let singleColumn = $state(false);
  let ocrCanvas: HTMLCanvasElement | null = null; // canvas traité (pour vignettes)
  let autoBusy = $state(false);
  // Comparaison image ↔ valeurs activée d'office : c'est l'outil qui rattrape
  // une lecture fausse mais plausible (un « 96 » lu « 26 » ne déclenche aucune
  // alerte). Le laisser en second plan revient à ne pas l'avoir.
  let showThumbs = $state(true);

  // ── Crop (glisser un rectangle sur l'aperçu) ──
  let cropping = $state(false);
  let dragStart: { x: number; y: number } | null = null;
  let dragRect = $state<CropRect | null>(null);

  function redrawPreview() {
    if (!img || !previewCanvas) return;
    const src = showProcessed
      ? processImage(img, { ...opts, crop: null, targetWidth: 1200 })
      : orientedCanvas(img, opts.rotation, null);
    const maxW = 520;
    const scale = Math.min(1, maxW / src.width);
    previewCanvas.width = Math.round(src.width * scale);
    previewCanvas.height = Math.round(src.height * scale);
    const ctx = previewCanvas.getContext('2d')!;
    ctx.drawImage(src, 0, 0, previewCanvas.width, previewCanvas.height);
  }

  $effect(() => {
    // Redessine quand image/rotation/traitement change
    opts.rotation; opts.contrast; opts.binarize; opts.grayscale; showProcessed; img;
    redrawPreview();
  });

  // Pages d'un PDF importé (canvases), pour laisser choisir la page à lire.
  let pdfPages = $state<HTMLCanvasElement[]>([]);
  let pdfPageIndex = $state(0);
  let pdfBusy = $state(false);
  let pdfNote = $state('');

  async function usePdfPage(i: number) {
    if (!pdfPages[i]) return;
    pdfPageIndex = i;
    img = await canvasToImage(pdfPages[i]);
    opts = defaultProcessOptions();
    dragRect = null;
    vRows = []; vDates = [];
    triedAutoRotate = false;
    launchOcr(); // #1 : lecture automatique
  }

  // ── File d'attente multi-captures (#4) ──
  type Shot = { id: string; img: HTMLImageElement; thumb: string; crop?: CropRect | null };
  let pending = $state<Shot[]>([]);
  let batchBusy = $state(false);
  const batchMode = $derived(pending.length >= 2);

  // C3 : recadrage rapide d'une capture du lot (confidentialité en-tête patient)
  let cropShot = $state<Shot | null>(null);
  let cropShotCanvas = $state<HTMLCanvasElement>();
  let csDragStart: { x: number; y: number } | null = null;
  let csRect = $state<CropRect | null>(null);

  function openShotCrop(sh: Shot) { cropShot = sh; csRect = sh.crop ?? null; }
  function drawShotCrop() {
    if (!cropShot || !cropShotCanvas) return;
    const im = cropShot.img;
    const maxW = 520, scale = Math.min(1, maxW / im.naturalWidth);
    cropShotCanvas.width = Math.round(im.naturalWidth * scale);
    cropShotCanvas.height = Math.round(im.naturalHeight * scale);
    cropShotCanvas.getContext('2d')!.drawImage(im, 0, 0, cropShotCanvas.width, cropShotCanvas.height);
  }
  $effect(() => { if (cropShot && cropShotCanvas) drawShotCrop(); });
  function csDown(e: PointerEvent) {
    if (!cropShotCanvas) return;
    const r = cropShotCanvas.getBoundingClientRect();
    csDragStart = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
    csRect = { x: csDragStart.x, y: csDragStart.y, w: 0, h: 0 };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }
  function csMove(e: PointerEvent) {
    if (!csDragStart || !cropShotCanvas) return;
    const r = cropShotCanvas.getBoundingClientRect();
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

  function shotThumb(image: HTMLImageElement): string {
    const w = 120, scale = Math.min(1, w / image.naturalWidth);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(image.naturalWidth * scale));
    c.height = Math.max(1, Math.round(image.naturalHeight * scale));
    c.getContext('2d')!.drawImage(image, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  }

  function removeShot(id: string) {
    pending = pending.filter(s => s.id !== id);
    if (pending.length === 1) { // retour au mode simple sur la capture restante
      img = pending[0].img; opts = defaultProcessOptions(); dragRect = null; vRows = []; vDates = []; triedAutoRotate = false;
    } else if (pending.length === 0) {
      img = null; vRows = []; vDates = [];
    }
  }

  /** Lit toutes les captures en attente et consolide en un seul écran de vérification. */
  async function readBatch() {
    if (!pending.length) return;
    batchBusy = true; errorMsg = ''; img = null;
    try {
      const tables: { table: ParsedTable; canvas: HTMLCanvasElement }[] = [];
      let n = 0;
      for (const shot of pending) {
        n++;
        progressLabel = `Lecture ${n}/${pending.length}…`;
        let o = { ...defaultProcessOptions(), crop: shot.crop ?? null };
        let canvas = processImage(shot.img, o);
        let table = parseTable((await runOcr(canvas)).words);
        if (!table.rows.length) { // redressement auto par capture
          let best = o.rotation, bestScore = -1;
          for (const r of [0, 90, 180, 270] as const) {
            const c = processImage(shot.img, { ...o, rotation: r, binarize: false, targetWidth: 900, maxWidth: 1100 });
            const t2 = parseTable((await runOcr(c)).words);
            const sc = t2.dates.filter(Boolean).length * 3 + t2.rows.length;
            if (sc > bestScore) { bestScore = sc; best = r; }
          }
          o = { ...o, rotation: best };
          canvas = processImage(shot.img, o);
          table = parseTable((await runOcr(canvas)).words);
        }
        await secondPassFill(shot.img, o, table); // récupère aussi les valeurs fléchées en lot
        tables.push({ table, canvas });
      }
      mergeIntoValidation(tables);
      if (!vRows.length) errorMsg = "Aucune ligne détectée dans les captures. Réessayez avec des images plus nettes.";
      else pending = [];
    } catch (e: any) {
      errorMsg = 'Échec de la lecture par lot : ' + (e?.message || e);
    } finally {
      batchBusy = false; progressLabel = '';
    }
  }

  const normName = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

  /** Fusionne plusieurs tableaux OCR en une grille de vérification unique. */
  function mergeIntoValidation(tables: { table: ParsedTable; canvas: HTMLCanvasElement }[]) {
    const dateCols: string[] = [];
    const colIndex = new Map<string, number>();
    const rowMap = new Map<string, VRow>();
    let emptySeq = 0;
    for (const { table: t, canvas } of tables) {
      const local: number[] = [];
      t.dates.forEach((d, i) => {
        const key = d ? 'd:' + d : 'e:' + (emptySeq++);
        if (!colIndex.has(key)) { colIndex.set(key, dateCols.length); dateCols.push(d || ''); }
        local[i] = colIndex.get(key)!;
      });
      for (const r of t.rows) {
        const learned = lookupAnalyte(r.name);
        const nm = learned ? learned.name : r.name;
        const key = normName(nm);
        let vr = rowMap.get(key);
        if (!vr) {
          vr = { include: true, name: nm, unit: learned && learned.unit ? learned.unit : r.unit, values: [], conf: [], origName: r.name, thumb: thumbFrom(canvas, r.bbox) };
          rowMap.set(key, vr);
        }
        r.values.forEach((v, i) => {
          if (v === null) return;
          const gi = local[i];
          vr!.values[gi] = String(v);
          vr!.conf[gi] = r.conf[i] ?? 100;
        });
      }
    }
    vDates = dateCols.map(d => d || '');
    vRows = [...rowMap.values()].map(vr => {
      const values = dateCols.map((_, i) => vr.values[i] ?? '');
      const conf = dateCols.map((_, i) => vr.conf[i] ?? 100);
      return { ...vr, values, conf, include: values.some(v => v !== '') };
    });
    singleColumn = false;
  }

  async function useFile(file: File) {
    errorMsg = '';
    if (isPdf(file)) {
      pdfBusy = true;
      pdfNote = '';
      try {
        const { canvases, total } = await pdfToCanvases(file);
        pdfPages = canvases;
        if (!pdfPages.length) { errorMsg = 'PDF vide ou illisible.'; return; }
        if (total > pdfPages.length) pdfNote = `PDF de ${total} pages : seules les ${pdfPages.length} premières sont affichées.`;
        await usePdfPage(0);
      } catch (e: any) {
        errorMsg = 'Lecture du PDF impossible : ' + (e?.message || e);
      } finally {
        pdfBusy = false;
      }
      return;
    }
    const src = URL.createObjectURL(file);
    try {
      pdfPages = [];
      const image = await loadImage(src);
      const shot: Shot = { id: uid(), img: image, thumb: shotThumb(image) };
      pending = [...pending, shot];
      if (pending.length === 1) {
        // 1re capture : mode simple habituel (aperçu, recadrage, OCR auto)
        img = image;
        opts = defaultProcessOptions();
        dragRect = null;
        vRows = []; vDates = [];
        triedAutoRotate = false;
        launchOcr(); // #1 : lecture automatique
      } else {
        // 2e capture → mode lot : annule l'OCR simple en cours, masque l'éditeur
        ocrCancelled = true; ocrBusy = false;
        img = null; vRows = []; vDates = [];
      }
    } catch {
      errorMsg = "Impossible de lire l'image.";
    }
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

  function rotate(dir: 1 | -1) {
    const seq = [0, 90, 180, 270] as const;
    let i = seq.indexOf(opts.rotation);
    i = (i + dir + 4) % 4;
    opts = { ...opts, rotation: seq[i] };
    dragRect = null;
    triedAutoRotate = true; // rotation manuelle : ne pas ré-imposer un redressement auto
  }

  // Crop drag handlers
  function cropDown(e: PointerEvent) {
    if (!cropping || !previewCanvas) return;
    const r = previewCanvas.getBoundingClientRect();
    dragStart = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
    dragRect = { x: dragStart.x, y: dragStart.y, w: 0, h: 0 };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }
  function cropMove(e: PointerEvent) {
    if (!cropping || !dragStart || !previewCanvas) return;
    const r = previewCanvas.getBoundingClientRect();
    const cx = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const cy = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    dragRect = {
      x: Math.min(dragStart.x, cx), y: Math.min(dragStart.y, cy),
      w: Math.abs(cx - dragStart.x), h: Math.abs(cy - dragStart.y),
    };
  }
  function cropUp() {
    dragStart = null;
    if (dragRect && dragRect.w > 0.02 && dragRect.h > 0.02) {
      opts = { ...opts, crop: { ...dragRect } };
    }
  }
  function clearCrop() { dragRect = null; opts = { ...opts, crop: null }; }

  function cancelOcr() {
    if (!ocrBusy) return;
    ocrCancelled = true;
    ocrBusy = false;
    progressLabel = '';
  }

  // Lecture faible : rien trouvé, ou aucune date reconnue.
  function weakTable(t: ParsedTable): boolean {
    return t.rows.length === 0 || t.dates.filter(Boolean).length === 0;
  }
  // « b est-il meilleur que a ? » — seul un tableau avec PLUS de dates valides
  // (ou autant de dates ≥1 mais plus de lignes) l'emporte. Une lecture pivotée
  // parasite (0 date, plein de fausses lignes) ne peut donc JAMAIS gagner :
  // on ne fait jamais pivoter une capture d'écran par erreur.
  function betterTable(b: ParsedTable, a: ParsedTable): boolean {
    const db = b.dates.filter(Boolean).length, da = a.dates.filter(Boolean).length;
    if (db !== da) return db > da;
    if (db === 0) return false;
    return b.rows.length > a.rows.length;
  }

  /**
   * Seconde lecture « canal minimum » : les valeurs anormales de Sillage sont
   * en ORANGE (chiffres + flèche ↑) et échappent souvent à la première passe.
   * On relit l'image ENTIÈRE avec un gris par canal minimum (l'orange devient
   * aussi sombre que le noir) puis on FUSIONNE par analyte + date : seules les
   * cases encore vides sont complétées (jamais d'écrasement), marquées
   * « faible confiance » pour la vérification.
   */
  async function secondPassFill(image: HTMLImageElement, baseOpts: ProcessOptions, main: ParsedTable) {
    if (!main.rows.length || main.dates.filter(Boolean).length < 2) return;
    const c2 = processImage(image, { ...baseOpts, minChannel: true, grayscale: false, binarize: false, contrast: 0.25 });
    const t2 = parseTable((await runOcr(c2)).words);
    if (ocrCancelled) return;
    // Colonnes : correspondance PAR DATE (jamais par position)
    const colOf = new Map<string, number>();
    main.dates.forEach((d, i) => { if (d) colOf.set(d, i); });
    const sameRow = (a: string, b: string) => {
      const na = normName(a), nb = normName(b);
      return na.length >= 2 && nb.length >= 2 && (na.startsWith(nb) || nb.startsWith(na));
    };
    for (const r2 of t2.rows) {
      const r1 = main.rows.find(r => sameRow(r.name, r2.name));
      if (!r1) continue;
      r2.values.forEach((v, j) => {
        if (v === null) return;
        const iso = t2.dates[j];
        const i = iso ? colOf.get(iso) : undefined;
        if (i === undefined) return;
        if (r1.values[i] !== null) return; // jamais d'écrasement d'une valeur déjà lue
        r1.values[i] = v;
        r1.raw[i] = r2.raw[j] || String(v);
        r1.conf[i] = 55; // surlignée « faible confiance » → à vérifier
      });
    }
  }

  async function launchOcr() {
    if (!img) return;
    ocrBusy = true; ocrCancelled = false; progress = 0; progressLabel = 'Initialisation…'; errorMsg = '';
    try {
      let canvas = processImage(img, opts);
      let table: ParsedTable = parseTable((await runOcr(canvas, (p, s) => { progress = p; progressLabel = s; })).words);
      if (ocrCancelled) return;
      let best: { table: ParsedTable; canvas: HTMLCanvasElement; opts: ProcessOptions } = { table, canvas, opts };

      // Auto-réparation : si la lecture est faible, on tente des prétraitements et on
      // garde le meilleur — mais uniquement s'il a PLUS de dates valides (jamais de
      // bascule vers une lecture parasite). Image nette → aucune tentative.
      if (weakTable(table) && !triedAutoRotate) {
        triedAutoRotate = true;
        progressLabel = 'Amélioration automatique…';
        const attempts: Partial<ProcessOptions>[] = [
          { grayscale: true, contrast: 0.4 },
          { grayscale: true, contrast: 0.3, binarize: true },
        ];
        // Rotation UNIQUEMENT si rien n'a été lu à plat (probable photo de travers) —
        // jamais pour une capture qui a déjà produit des lignes.
        if (table.rows.length === 0) {
          const rot = await findBestRotation();
          if (ocrCancelled) return;
          if (rot !== opts.rotation) attempts.unshift({ rotation: rot });
        }
        for (const a of attempts) {
          if (ocrCancelled) return;
          const o = { ...opts, ...a };
          const c = processImage(img, o);
          const t = parseTable((await runOcr(c)).words);
          if (betterTable(t, best.table)) best = { table: t, canvas: c, opts: o };
        }
        opts = best.opts;
      }

      // Seconde lecture : récupère les valeurs anormales en orange (« 11↑ »)
      if (best.table.rows.length) {
        progressLabel = 'Seconde lecture (valeurs signalées)…';
        await secondPassFill(img, best.opts, best.table);
        if (ocrCancelled) return;
      }

      ocrCanvas = best.canvas;
      loadValidation(best.table);
      if (!best.table.rows.length) errorMsg = "Aucune ligne détectée. Recadrez sur le tableau, pivotez l'image, ou activez le N&B, puis relancez.";
    } catch (e: any) {
      if (!ocrCancelled) errorMsg = 'Échec de la reconnaissance : ' + (e?.message || e);
    } finally {
      ocrBusy = false;
      progressLabel = '';
    }
  }

  /** Teste les 4 rotations (rapide, basse résolution) et renvoie la meilleure. */
  async function findBestRotation(): Promise<0 | 90 | 180 | 270> {
    const rots: (0 | 90 | 180 | 270)[] = [0, 90, 180, 270];
    let best = opts.rotation, bestScore = -1;
    for (const r of rots) {
      if (ocrCancelled) return best;
      const c = processImage(img!, { ...opts, rotation: r, crop: opts.crop, binarize: false, targetWidth: 900, maxWidth: 1100 });
      const res = await runOcr(c);
      const t = parseTable(res.words);
      const score = t.dates.filter(Boolean).length * 3 + t.rows.length;
      if (score > bestScore) { bestScore = score; best = r; }
    }
    return best;
  }

  /** Redressement manuel (bouton) : teste les 4 rotations et applique la meilleure. */
  async function autoRotate() {
    if (!img) return;
    autoBusy = true; errorMsg = '';
    try {
      opts = { ...opts, rotation: await findBestRotation() };
    } catch (e: any) {
      errorMsg = 'Redressement auto impossible : ' + (e?.message || e);
    } finally {
      autoBusy = false;
    }
  }

  function thumbFrom(src: HTMLCanvasElement | null, bbox: BBox | undefined): string | undefined {
    if (!bbox || !src) return undefined;
    const padY = 4, padX = 4;
    const x = Math.max(0, bbox.x0 - padX);
    const y = Math.max(0, bbox.y0 - padY);
    const w = Math.min(src.width - x, bbox.x1 - bbox.x0 + padX * 2);
    const h = Math.min(src.height - y, bbox.y1 - bbox.y0 + padY * 2);
    if (w <= 2 || h <= 2) return undefined;
    const scale = Math.min(2, Math.max(1, 34 / h));
    const c = document.createElement('canvas');
    c.width = Math.round(w * scale); c.height = Math.round(h * scale);
    c.getContext('2d')!.drawImage(src, x, y, w, h, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  }
  function makeThumb(bbox: BBox | undefined): string | undefined {
    return thumbFrom(ocrCanvas, bbox);
  }

  function loadValidation(t: ParsedTable) {
    singleColumn = t.singleColumn;
    // Une date non lue reste VIDE (jamais « aujourd'hui ») : le médecin doit la renseigner.
    vDates = t.dates.map(d => d || '');
    vRows = t.rows.map(r => {
      const learned = lookupAnalyte(r.name); // correction apprise ?
      return {
        include: r.values.some(v => v !== null),
        name: learned ? learned.name : r.name,
        unit: learned && learned.unit ? learned.unit : r.unit,
        values: r.values.map(v => (v === null ? '' : String(v))),
        conf: r.conf,
        thumb: makeThumb(r.bbox),
        origName: r.name,
      };
    });
  }

  function parseCell(raw: string): number | null {
    const t = raw.trim().replace(/^[<>]/, '');
    if (t === '') return null;
    const n = parseFloat(t.replace(',', '.'));
    return isNaN(n) ? null : n;
  }

  /**
   * Valeur suspecte : soit très éloignée des autres de la ligne, soit — même
   * pour une valeur unique — hors de la norme catalogue d'un ordre de grandeur
   * (×10 / ÷10), signe d'une virgule mal lue.
   */
  function isSuspect(row: VRow, i: number): boolean {
    const v = parseCell(row.values[i]);
    if (v === null || v === 0) return false;

    // 1) Cohérence temporelle (si ≥2 autres valeurs sur la ligne)
    const others = row.values.map(parseCell).filter((x, j): x is number => x !== null && j !== i && x !== 0);
    if (others.length >= 2) {
      others.sort((a, b) => a - b);
      const med = others[Math.floor(others.length / 2)];
      if (med !== 0) {
        const ratio = v / med;
        if (ratio >= 8 || ratio <= 1 / 8) return true;
      }
    }

    // 2) Ordre de grandeur vs norme catalogue (fonctionne même sur une valeur unique)
    const m = matchCatalog(row.name);
    if (m) {
      const av = Math.abs(v);
      if (m.refHigh != null && m.refHigh > 0 && av >= m.refHigh * 10) return true;
      if (m.refLow != null && m.refLow > 0 && av > 0 && av <= m.refLow / 10) return true;
    }
    return false;
  }

  /** Hors des normes usuelles connues (via le catalogue). */
  function isOutOfRange(row: VRow, i: number): boolean {
    const v = parseCell(row.values[i]);
    if (v === null) return false;
    const m = matchCatalog(row.name);
    if (!m) return false;
    if (m.refLow != null && v < m.refLow) return true;
    if (m.refHigh != null && v > m.refHigh) return true;
    return false;
  }

  function cellClass(row: VRow, i: number): string {
    const raw = row.values[i];
    if (raw === '') return '';
    if (isSuspect(row, i)) return 'suspect';
    const c = row.conf[i] ?? 100;
    if (c > 0 && c < 65) return 'low';
    if (isOutOfRange(row, i)) return 'oor';
    return '';
  }

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
    vRows = []; vDates = []; img = null; pdfPages = []; pending = [];
    uiBus.toast(`${added} valeur(s) ajoutée(s) au graphique.`);
    onImported();
  }

  const hasValidation = $derived(vRows.length > 0);
  const hasThumbs = $derived(vRows.some(r => !!r.thumb));

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

  // Annulation réversible de la vérification (Échap global / bouton Annuler).
  function cancelValidation() {
    if (!vRows.length && !vDates.length) return;
    const rows = vRows, dates = vDates;
    vRows = []; vDates = [];
    uiBus.toastAction('Vérification annulée.', 'Annuler', () => { vRows = rows; vDates = dates; });
  }

  // #5 / C2 : Entrée = Ajouter, mais jamais depuis un champ (là il faut Ctrl+Entrée).
  // Échap depuis un champ rend le focus (ne détruit rien) ; Échap global annule (réversible).
  function onValidationKey(e: KeyboardEvent) {
    if (!hasValidation) return;
    const el = e.target as HTMLElement | null;
    const inField = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
    if (e.key === 'Enter') {
      const commitWanted = inField ? (e.ctrlKey || e.metaKey) : (!e.shiftKey && !e.ctrlKey && !e.metaKey);
      if (commitWanted && !hasMissingDate) { e.preventDefault(); commit(); }
    } else if (e.key === 'Escape') {
      if (inField) { (el as HTMLInputElement).blur(); return; } // rend le focus au document
      e.preventDefault();
      cancelValidation();
    }
  }
</script>

<svelte:window onkeydown={onValidationKey} />

<div class="col" style="gap:14px;">
  <div class="modeseg">
    <button class:on={importMode === 'photo'} onclick={() => (importMode = 'photo')}>📷 Photo / capture</button>
    <button class:on={importMode === 'text'} onclick={() => (importMode = 'text')}>📄 Compte-rendu (texte)</button>
  </div>

  {#if importMode === 'text'}
    <div class="card" style="padding:12px;">
      <p class="faint small" style="margin-bottom:8px;">Collez le « carré bleu » (ou tout compte-rendu). J'en extrais les <strong>lignes thérapeutiques</strong> — vous validez avant d'ajouter. 100% local.</p>
      <textarea class="report" bind:value={reportText} placeholder="Collez ici le texte du compte-rendu…"></textarea>
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
                    <td><input class="dinp" type="date" value={r.date ?? ''} onchange={(e) => (r.date = e.currentTarget.value || null)} /></td>
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

  {#if batchMode}
    <div class="card" style="padding:12px;">
      <div class="row" style="margin-bottom:8px;"><strong>{pending.length} captures en attente</strong><span class="faint small"> — lecture groupée, une seule vérification.</span></div>
      <div class="shots">
        {#each pending as sh (sh.id)}
          <div class="shot">
            <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
            <img src={sh.thumb} alt="capture" title="Cliquer pour recadrer (exclure l'en-tête patient)" onclick={() => openShotCrop(sh)} />
            {#if sh.crop}<span class="shot-crop" title="Recadrée">✂</span>{/if}
            <button class="shot-x" title="Retirer" onclick={() => removeShot(sh.id)}>✕</button>
          </div>
        {/each}
        <label class="shot add" title="Ajouter une capture">
          +<input type="file" accept="image/*" capture="environment" multiple onchange={onSelect} hidden />
        </label>
      </div>
      <div class="row" style="margin-top:10px;">
        <span class="faint small">🔒 Cliquez une vignette pour la recadrer (exclure l'en-tête patient). Astuce : collez (Ctrl+V) plusieurs captures à la suite.</span>
        <div class="spacer"></div>
        {#if batchBusy}<span class="faint small">{progressLabel}</span>{/if}
        <button class="primary big" disabled={batchBusy} onclick={readBatch}>{batchBusy ? 'Lecture…' : `🔍 Lire les ${pending.length} captures`}</button>
      </div>
    </div>
  {:else if !img}
    <div class="drop" role="button" tabindex="0"
         ondrop={onDrop} ondragover={(e) => e.preventDefault()}>
      <p class="drop-title"><strong>Collez une capture d'écran</strong> (Ctrl+V)</p>
      {#if pdfBusy}
        <p class="muted small">Lecture du PDF…</p>
      {:else}
        <p class="muted small">ou glissez une image / un PDF ici · <label class="filebtn">choisir un fichier<input type="file" accept="image/*,application/pdf" capture="environment" multiple onchange={onSelect} hidden /></label></p>
      {/if}
      <p class="faint small" style="margin-top:10px;">100% local — rien n'est envoyé. Vous vérifierez chaque valeur avant de l'ajouter.</p>
      <p class="faint small" style="margin-top:4px;">🔒 Astuce confidentialité : recadrez pour <strong>exclure l'en-tête patient</strong> (nom, date de naissance) — l'outil n'a besoin que du tableau de valeurs. Plusieurs bilans ? Collez-les à la suite.</p>
    </div>
  {:else}
    <div class="card" style="padding:12px;">
      <div class="row wrap" style="margin-bottom:8px;">
        <button onclick={() => rotate(-1)} title="Pivoter à gauche">⟲</button>
        <button onclick={() => rotate(1)} title="Pivoter à droite">⟳</button>
        <button disabled={autoBusy} onclick={autoRotate} title="Détecte automatiquement le bon sens">{autoBusy ? '…' : 'Redresser auto'}</button>
        <button class:active-btn={cropping} onclick={() => (cropping = !cropping)}>{cropping ? '✓ Recadrer' : 'Recadrer'}</button>
        {#if opts.crop}<button class="ghost small" onclick={clearCrop}>Effacer cadre</button>{/if}
        <div class="spacer"></div>
        <button class="ghost small" onclick={() => { img = null; vRows = []; pdfPages = []; pdfNote = ''; pending = []; }}>Autre fichier</button>
      </div>

      {#if pdfNote}<div class="callout" style="margin-bottom:8px;">{pdfNote}</div>{/if}

      {#if pdfPages.length > 1}
        <div class="pdfpages">
          <span class="faint small">Page du PDF :</span>
          {#each pdfPages as _pg, i (i)}
            <button class="pgbtn" class:on={pdfPageIndex === i} onclick={() => usePdfPage(i)}>{i + 1}</button>
          {/each}
        </div>
      {/if}

      <div class="preview">
        <canvas bind:this={previewCanvas}
                style="touch-action:none; cursor:{cropping ? 'crosshair' : 'default'};"
                onpointerdown={cropDown} onpointermove={cropMove} onpointerup={cropUp}></canvas>
        {#if dragRect}
          <div class="croprect" style="left:{dragRect.x * 100}%; top:{dragRect.y * 100}%; width:{dragRect.w * 100}%; height:{dragRect.h * 100}%;"></div>
        {/if}
      </div>

      <div class="row" style="margin-top:10px;">
        <button class="ghost small" onclick={() => (showAdvanced = !showAdvanced)}>{showAdvanced ? '▴ Options' : '▾ Options'}</button>
        <div class="spacer"></div>
        {#if ocrBusy}
          <button onclick={cancelOcr}>Annuler</button>
        {/if}
        <button class="primary big" disabled={ocrBusy} onclick={launchOcr}>
          {ocrBusy ? 'Lecture…' : (hasValidation ? '↻ Relire' : '🔍 Lire les valeurs')}
        </button>
      </div>

      {#if showAdvanced}
        <div class="advanced">
          <label class="chk"><input type="checkbox" bind:checked={opts.binarize} /> Noir & blanc (photos difficiles)</label>
          <label class="chk"><input type="checkbox" bind:checked={showProcessed} /> Aperçu du traitement</label>
          <label class="small" style="display:flex;align-items:center;gap:6px;">Contraste
            <input type="range" min="0" max="1.5" step="0.05" bind:value={opts.contrast} />
          </label>
        </div>
      {/if}

      {#if ocrBusy}
        <div class="prog"><div class="bar" style="width:{Math.round(progress * 100)}%"></div></div>
        <p class="faint small">{progressLabel} — {Math.round(progress * 100)}%</p>
      {/if}
    </div>
  {/if}

  {#if errorMsg}<div class="callout" style="background:#fbecea;color:#8a2b20;border-color:#e3b6b0;">{errorMsg}</div>{/if}

  {#if hasValidation}
    <div class="card" style="padding:12px;">
      <div class="row wrap" style="margin-bottom:8px;">
        <strong>Vérification</strong>
        <span class="faint small">— corrigez puis ajoutez.</span>
        <div class="spacer"></div>
        {#if hasThumbs}
          <button class="ghost small" onclick={() => (showThumbs = !showThumbs)} title="Afficher la portion d'image d'origine en regard de chaque ligne">
            {showThumbs ? '✓ Image' : 'Comparer à l’image'}
          </button>
        {/if}
        <span class="lg lg-low">faible confiance</span>
        <span class="lg lg-oor">hors-norme</span>
        <span class="lg lg-sus">incohérent</span>
      </div>
      <div style="overflow-x:auto;">
        <table class="grid vgrid">
          <thead>
            <tr>
              <th></th>
              {#if showThumbs}<th style="text-align:left;">Image</th>{/if}
              <th style="text-align:left;">Analyte</th>
              <th>Unité</th>
              {#each vDates as _d, i (i)}
                <th><input class="dinp" class:datemissing={missingDateCols.has(i)} type="date" bind:value={vDates[i]} title={missingDateCols.has(i) ? 'Date manquante : renseignez-la avant d’ajouter' : ''} /></th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each vRows as row, ri (ri)}
              <tr class:excluded={!row.include}>
                <td><input type="checkbox" bind:checked={row.include} /></td>
                {#if showThumbs}<td class="thumb">{#if row.thumb}<img src={row.thumb} alt="ligne" />{/if}</td>{/if}
                <td class="name">
                  <input class="ninp" bind:value={row.name} />
                  {#if catalogHint(row.name)}<div class="faint" style="font-size:12px;">{catalogHint(row.name)}</div>{/if}
                </td>
                <td><input class="uinp" bind:value={row.unit} /></td>
                {#each row.values as _v, ci (ci)}
                  <td class={cellClass(row, ci)}><input bind:value={row.values[ci]} /></td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      {#if hasMissingDate}
        <div class="callout" style="background:#fff5e6;color:#8a5a12;border-color:#f0d9a8;margin-top:10px;">
          ⚠️ {missingDateCols.size} colonne(s) sans date. Renseignez chaque date (surlignée en orange) avant d'ajouter — aucune date n'est devinée automatiquement.
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
      <div class="cs-head">Recadrer — glissez pour ne garder que le tableau (exclut l'en-tête patient)</div>
      <div class="cs-canvaswrap">
        <canvas bind:this={cropShotCanvas} style="touch-action:none;cursor:crosshair;"
                onpointerdown={csDown} onpointermove={csMove} onpointerup={csUp}></canvas>
        {#if csRect}
          <div class="croprect" style="left:{csRect.x * 100}%; top:{csRect.y * 100}%; width:{csRect.w * 100}%; height:{csRect.h * 100}%;"></div>
        {/if}
      </div>
      <div class="row" style="margin-top:10px;">
        <button class="ghost small" onclick={() => (csRect = null)}>Effacer le cadre</button>
        <div class="spacer"></div>
        <button onclick={() => (cropShot = null)}>Annuler</button>
        <button class="primary" onclick={applyShotCrop}>Valider</button>
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
  .big { padding: 9px 20px; font-size: 14px; font-weight: 600; }
  .advanced { display: flex; flex-wrap: wrap; gap: 14px; align-items: center; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border); }
  .preview { position: relative; display: inline-block; max-width: 100%; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
  .preview canvas { display: block; max-width: 100%; }
  .croprect { position: absolute; border: 2px solid var(--accent); background: rgba(42,111,176,.12); pointer-events: none; }
  .active-btn { background: var(--accent); color: #fff; border-color: var(--accent); }
  .kbd { display: inline-block; background: var(--panel-2); border: 1px solid var(--border); border-radius: 4px; padding: 0 5px; font-size: 11px; color: var(--muted); }
  .shots { display: flex; flex-wrap: wrap; gap: 8px; }
  .shot { position: relative; width: 96px; height: 68px; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; background: var(--panel-2); }
  .shot img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .shot-x { position: absolute; top: 2px; right: 2px; width: 20px; height: 20px; padding: 0; border: none; border-radius: 50%; background: rgba(27,39,51,.75); color: #fff; font-size: 11px; line-height: 1; }
  .shot-x:hover { background: var(--danger); }
  .shot img { cursor: pointer; }
  .shot-crop { position: absolute; bottom: 2px; left: 2px; background: rgba(20,104,62,.9); color: #fff; font-size: 10px; padding: 1px 5px; border-radius: 6px; }
  .shot.add { display: flex; align-items: center; justify-content: center; font-size: 26px; color: var(--muted); border-style: dashed; cursor: pointer; }
  .shot.add:hover { color: var(--accent); border-color: var(--accent); }

  .cs-overlay { position: fixed; inset: 0; background: rgba(16,24,32,.5); z-index: 100; display: flex; align-items: center; justify-content: center; padding: 20px; }
  .cs-modal { background: var(--panel); border-radius: 14px; box-shadow: 0 20px 50px rgba(16,24,32,.35); padding: 14px; max-width: 92vw; }
  .cs-head { font-size: 13px; color: var(--muted); margin-bottom: 10px; max-width: 540px; }
  .cs-canvaswrap { position: relative; display: inline-block; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
  .cs-canvaswrap canvas { display: block; max-width: 100%; }
  .pdfpages { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
  .pgbtn { border: 1px solid var(--border); background: var(--panel); border-radius: 7px; padding: 4px 10px; font-size: 12.5px; min-width: 30px; }
  .pgbtn.on { background: var(--accent); color: #fff; border-color: var(--accent); }
  .chk { display: inline-flex; align-items: center; gap: 4px; font-size: 12.5px; }
  .prog { height: 6px; background: #e6ebef; border-radius: 4px; overflow: hidden; margin-top: 8px; }
  .prog .bar { height: 100%; background: var(--accent); transition: width .2s; }
  .vgrid input { width: 60px; }
  .vgrid .ninp { width: 130px; text-align: left; }
  .vgrid .uinp { width: 66px; }
  .vgrid .dinp { width: 128px; }
  .vgrid .dinp.datemissing { background: #fff0d6; box-shadow: inset 0 0 0 1.5px #e0a33a; border-radius: 4px; }
  .vgrid td.low { background: var(--warn-bg); }
  .vgrid td.oor { background: #fde7e4; }
  .vgrid td.suspect { background: #f6dcff; box-shadow: inset 0 0 0 1.5px #b048c8; }
  .vgrid tr.excluded { opacity: .45; }
  .vgrid td.thumb { padding: 2px; }
  .vgrid td.thumb img { display: block; max-height: 34px; max-width: 220px; border: 1px solid var(--border); border-radius: 3px; }
  .lg { font-size: 12px; padding: 1px 7px; border-radius: 10px; }
  .lg-low { background: var(--warn-bg); color: var(--warn-ink); }
  .lg-oor { background: #fde7e4; color: #8a2b20; }
  .lg-sus { background: #f6dcff; color: #7a2b8f; }

  .modeseg { display: inline-flex; background: #eef1f4; border-radius: 9px; padding: 3px; align-self: flex-start; }
  .modeseg button { border: none; background: transparent; border-radius: 6px; padding: 6px 14px; font-size: 13px; color: var(--muted); }
  .modeseg button.on { background: #fff; color: var(--ink); font-weight: 600; box-shadow: 0 1px 2px rgba(0,0,0,.12); }
  .report { width: 100%; min-height: 190px; resize: vertical; font-size: 13px; line-height: 1.5; }
  .vgrid .flags { white-space: nowrap; }
  .flag { font-size: 12px; padding: 1px 6px; border-radius: 9px; margin-right: 3px; }
  .flag.stop { background: #eee; color: #666; }
  .flag.taper { background: #e6eff8; color: #2a6fb0; }
</style>
