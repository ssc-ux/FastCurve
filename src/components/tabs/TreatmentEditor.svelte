<script lang="ts">
  import { store } from '../../lib/models/store.svelte';
  import { uiBus } from '../../lib/models/ui.svelte';
  import { formatDate, lireDateSouple, type Treatment, type DosePoint } from '../../lib/models/types';
  import { getKnownDrugs } from '../../lib/learn/memory';

  let { treatment, onClose }: { treatment: Treatment; onClose: () => void } = $props();

  const taper = $derived(!!(treatment.dosePoints && treatment.dosePoints.length));
  const knownDrugs = getKnownDrugs();

  // #11 : générateur de décroissance (dose départ → cible, rythme mensuel)
  let genStart = $state('');
  let genTarget = $state('0');
  let genStep = $state('');
  let genEvery = $state<'month' | 'week'>('month');

  const genValid = $derived.by(() => {
    const s0 = parseFloat(genStart.replace(',', '.'));
    const target = parseFloat(genTarget.replace(',', '.'));
    const step = Math.abs(parseFloat(genStep.replace(',', '.')));
    if (isNaN(s0) || isNaN(target)) return { ok: false, why: 'Renseignez dose de départ et cible.' };
    if (isNaN(step) || step <= 0) return { ok: false, why: 'Indiquez une baisse par palier (> 0).' };
    if (s0 <= target) return { ok: false, why: 'La dose de départ doit être supérieure à la cible.' };
    return { ok: true, why: '' };
  });

  function generateTaper() {
    if (!genValid.ok) { uiBus.toast(genValid.why, 'error'); return; }
    const s0 = parseFloat(genStart.replace(',', '.'));
    const target = parseFloat(genTarget.replace(',', '.'));
    const step = Math.abs(parseFloat(genStep.replace(',', '.')));
    const pts: DosePoint[] = [];
    let dose = s0;
    let date = treatment.start;
    const advance = (iso: string) => genEvery === 'month' ? addMonths(iso, 1) : addDays(iso, 7);
    let guard = 0;
    while (dose > target && guard++ < 400) {
      pts.push({ date, dose });
      dose = Math.max(target, Math.round((dose - step) * 100) / 100);
      date = advance(date);
    }
    pts.push({ date, dose: target });
    set({ dosePoints: pts, doseUnit: treatment.doseUnit || 'mg/j' });
  }

  function addDays(iso: string, n: number): string {
    const d = new Date(iso);
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function set(patch: Partial<Treatment>) {
    store.updateTreatment(treatment.id, patch);
  }

  function addMonths(iso: string, m: number): string {
    const d = new Date(iso);
    d.setMonth(d.getMonth() + m);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function enableTaper(on: boolean) {
    if (on) {
      const end = treatment.end || addMonths(treatment.start, 6);
      // Amorce à partir de la dose déjà saisie en texte libre (« 60 mg/j » → 60)
      // pour que le coin soit tout de suite parlant ; sinon 0 (barre pleine).
      const m = (treatment.dose ?? '').match(/-?\d+(?:[.,]\d+)?/);
      const first = m ? parseFloat(m[0].replace(',', '.')) : 0;
      const seed: DosePoint[] = [
        { date: treatment.start, dose: first },
        { date: end, dose: 0 },
      ];
      set({ dosePoints: seed, doseUnit: treatment.doseUnit || 'mg/j' });
    } else {
      set({ dosePoints: undefined });
    }
  }

  function updatePoint(i: number, patch: Partial<DosePoint>) {
    const arr = (treatment.dosePoints || []).map((p, j) => (j === i ? { ...p, ...patch } : p));
    set({ dosePoints: arr });
  }
  function addPoint() {
    const arr = [...(treatment.dosePoints || [])];
    const last = arr[arr.length - 1];
    const date = last ? addMonths(last.date, 1) : treatment.start;
    arr.push({ date, dose: last ? last.dose : 0 });
    set({ dosePoints: arr });
  }
  function removePoint(i: number) {
    const arr = (treatment.dosePoints || []).filter((_, j) => j !== i);
    set({ dosePoints: arr });
  }

  function numVal(v: string): number {
    const n = parseFloat(v.replace(',', '.'));
    return isNaN(n) ? 0 : n;
  }

  /**
   * Champ de date en texte libre, toujours affiché JJ/MM/AAAA — comme la grille
   * de saisie (`DataTab`). Remplace le `<input type="date">` natif : celui-ci
   * enregistre au milieu de la frappe (dès que ses segments prennent une valeur
   * plausible) et s'affiche au format de la langue du navigateur
   * (`mm/dd/yyyy` vu ici en anglais) — le grief n°1 et l'irritant C du médecin,
   * rejoués dans cet onglet. Rien n'est enregistré avant `Entrée` / `Tab` /
   * perte du focus, et Échap annule la frappe en cours.
   */
  function dateFocus(e: FocusEvent) {
    (e.currentTarget as HTMLInputElement).select();
  }
  function dateKeydown(e: KeyboardEvent, iso: string) {
    if (e.key === 'Escape') {
      e.preventDefault();
      const t = e.currentTarget as HTMLInputElement;
      t.value = iso ? formatDate(iso) : '';
      t.blur();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      (e.currentTarget as HTMLInputElement).blur();
    }
  }
  function dateBlur(e: FocusEvent, iso: string, onChange: (iso: string) => void, allowEmpty = false) {
    const input = e.currentTarget as HTMLInputElement;
    const brut = input.value.trim();
    if (brut === '') {
      if (allowEmpty) { onChange(''); return; }
      input.value = iso ? formatDate(iso) : '';
      return;
    }
    const lu = lireDateSouple(brut);
    if (!lu) {
      uiBus.toast(`Date « ${brut} » non comprise : tapez par exemple 12/03/2024, 12032024 ou mars 2024.`, 'error', 6000);
      input.value = iso ? formatDate(iso) : '';
      return;
    }
    input.value = formatDate(lu.iso);
    onChange(lu.iso);
  }
</script>

<div class="editor">
  <div class="row">
    <input class="color" type="color" value={treatment.color} onchange={(e) => set({ color: e.currentTarget.value })} title="Couleur" />
    <input class="grow" list="druglist" value={treatment.name} onchange={(e) => set({ name: e.currentTarget.value })} placeholder="Nom" />
    <datalist id="druglist">
      {#each knownDrugs as d (d)}<option value={d}></option>{/each}
    </datalist>
    <button class="icon" onclick={onClose} title="Fermer">✕</button>
  </div>

  <div class="row wrap">
    <div class="seg">
      <button class:on={treatment.kind === 'continuous'} onclick={() => set({ kind: 'continuous' })}>Continu</button>
      <button class:on={treatment.kind === 'event'} onclick={() => set({ kind: 'event' })}>Événement</button>
    </div>
    <label class="fld">Début<input class="dateinput" type="text" inputmode="numeric" placeholder="JJ/MM/AAAA"
      value={formatDate(treatment.start)}
      onfocus={dateFocus}
      onkeydown={(e) => dateKeydown(e, treatment.start)}
      onblur={(e) => dateBlur(e, treatment.start, (iso) => set({ start: iso }))} /></label>
    {#if treatment.kind === 'continuous'}
      <label class="fld">Fin<input class="dateinput" type="text" inputmode="numeric" placeholder="en cours"
        value={treatment.end ? formatDate(treatment.end) : ''}
        onfocus={dateFocus}
        onkeydown={(e) => dateKeydown(e, treatment.end ?? '')}
        onblur={(e) => dateBlur(e, treatment.end ?? '', (iso) => set({ end: iso || null }), true)} /></label>
    {/if}
  </div>

  {#if treatment.kind === 'continuous'}
    <label class="taper-toggle">
      <input type="checkbox" checked={taper} onchange={(e) => enableTaper(e.currentTarget.checked)} />
      Décroissance de dose (coin qui s'affine)
    </label>

    {#if taper}
      <div class="gentaper">
        <div class="small muted" style="margin-bottom:6px;">Générer un schéma dégressif</div>
        <div class="genrow">
          <label class="fld inline">Départ<input class="gnum" inputmode="decimal" bind:value={genStart} placeholder="ex. 60" /></label>
          <label class="fld inline">Cible<input class="gnum" inputmode="decimal" bind:value={genTarget} /></label>
          <label class="fld inline">Baisse<input class="gnum" inputmode="decimal" bind:value={genStep} placeholder="ex. 10" /></label>
          <select bind:value={genEvery}>
            <option value="month">/ mois</option>
            <option value="week">/ semaine</option>
          </select>
          <button class="primary" disabled={!genValid.ok} title={genValid.ok ? '' : genValid.why} onclick={generateTaper}>Générer</button>
        </div>
        <p class="hint" style="margin-top:5px;">{genValid.ok || (!genStart && !genStep) ? `Depuis la date de début (${treatment.start}). Génère les paliers ci-dessous — ajustables ensuite.` : genValid.why}</p>
      </div>
      <div class="paliers">
        <div class="row" style="margin-bottom:4px;">
          <span class="small muted">Paliers — la hauteur suit la dose</span>
          <div class="spacer"></div>
          <label class="fld inline">Unité<input style="width:64px;" value={treatment.doseUnit ?? 'mg/j'} onchange={(e) => set({ doseUnit: e.currentTarget.value })} /></label>
        </div>
        {#each treatment.dosePoints ?? [] as p, i (i)}
          <div class="palier">
            <input class="dateinput" type="text" inputmode="numeric" placeholder="JJ/MM/AAAA"
              value={formatDate(p.date)}
              onfocus={dateFocus}
              onkeydown={(e) => dateKeydown(e, p.date)}
              onblur={(e) => dateBlur(e, p.date, (iso) => updatePoint(i, { date: iso }))} />
            <input class="dose" type="text" inputmode="decimal" value={p.dose || ''} placeholder="dose"
              onchange={(e) => updatePoint(i, { dose: numVal(e.currentTarget.value) })} />
            <span class="small faint">{treatment.doseUnit ?? 'mg/j'}</span>
            <button class="icon" onclick={() => removePoint(i)} title="Retirer">✕</button>
          </div>
        {/each}
        <button class="addp" onclick={addPoint}>+ Ajouter un palier</button>
        <p class="hint">Cas simple : mettez 2 paliers (dose de départ → dose finale). Schéma précis : ajoutez un palier par changement de dose.</p>
      </div>
    {:else}
      <label class="fld">Dose (texte libre)<input value={treatment.dose ?? ''} onchange={(e) => set({ dose: e.currentTarget.value })} placeholder="ex. 1 mg/kg" /></label>
    {/if}
  {:else}
    <label class="fld">Dose / précision<input value={treatment.dose ?? ''} onchange={(e) => set({ dose: e.currentTarget.value })} placeholder="ex. 375 mg/m²" /></label>
  {/if}

  <div class="row end">
    <button class="del" onclick={() => { const n = treatment.name; store.removeTreatment(treatment.id); onClose(); uiBus.toastAction(`« ${n} » supprimé.`, 'Annuler', () => store.undo()); }}>Supprimer</button>
  </div>
</div>

<style>
  .editor { background: var(--panel-2); border: 1px solid var(--border); border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
  .color { width: 30px; height: 30px; padding: 2px; border-radius: 8px; }
  .icon { padding: 4px 8px; }
  .seg { display: inline-flex; background: #eef1f4; border-radius: 8px; padding: 2px; }
  .seg button { border: none; background: transparent; border-radius: 6px; padding: 5px 11px; font-size: 12.5px; color: var(--muted); }
  .seg button.on { background: #fff; color: var(--ink); font-weight: 600; box-shadow: 0 1px 2px rgba(0,0,0,.12); }
  .fld { display: inline-flex; flex-direction: column; gap: 3px; font-size: 12px; }
  .fld.inline { flex-direction: row; align-items: center; gap: 5px; }
  .dateinput { width: 108px; text-align: left; font-variant-numeric: tabular-nums; }
  .palier .dateinput { width: 96px; }
  .taper-toggle { display: flex; align-items: center; gap: 7px; font-size: 13px; color: var(--ink); padding: 4px 0; }
  .gentaper { background: var(--panel); border: 1px solid var(--border); border-radius: 9px; padding: 9px 10px; }
  .genrow { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 8px; }
  .gnum { width: 62px; }
  .paliers { border-left: 2px solid var(--border); padding-left: 10px; display: flex; flex-direction: column; gap: 6px; }
  .palier { display: flex; align-items: center; gap: 6px; }
  .palier .dose { width: 70px; text-align: right; }
  .addp { align-self: flex-start; border: 1px dashed var(--border-strong); background: transparent; color: var(--muted); font-size: 12px; padding: 4px 10px; border-radius: 7px; }
  .addp:hover { color: var(--accent); border-color: var(--accent); }
  .hint { font-size: 12px; color: var(--faint); margin: 2px 0 0; }
  .row.end { justify-content: flex-end; }
  .del { color: var(--danger); border-color: #e3b6b0; background: transparent; font-size: 12.5px; }
  .del:hover { background: #fbecea; }
</style>
