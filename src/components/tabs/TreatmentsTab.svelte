<script lang="ts">
  import Icon from '../Icon.svelte';
  import { store } from '../../lib/models/store.svelte';
  import { todayISO, formatDate, lireDateSouple } from '../../lib/models/types';
  import type { TreatmentKind } from '../../lib/models/types';
  import { getKnownDrugs, learnDrug } from '../../lib/learn/memory';
  import { uiBus } from '../../lib/models/ui.svelte';
  import { posologiesPour, datesDuSchema, type SchemaPosologie } from '../../lib/models/posologies';
  import { parseReport, type ExtractedTreatment } from '../../lib/text/reportParser';
  import TreatmentEditor from './TreatmentEditor.svelte';

  const knownDrugs = getKnownDrugs();

  let name = $state('');
  let kind = $state<TreatmentKind>('continuous');
  let start = $state(todayISO());
  let openId = $state<string | null>(null);

  // Puces de posologie standard (#12) : proposées dès que le nom tapé
  // correspond à un médicament dont on connaît un schéma sûr — cliquer en
  // choisit un plutôt que de taper la dose (et, pour un schéma à plusieurs
  // prises, crée directement les événements aux bonnes dates).
  const schemasProposes = $derived(posologiesPour(name));

  function choisirPosologie(schema: SchemaPosologie) {
    const n = name.trim();
    if (!n) return;
    const dates = datesDuSchema(start, schema);
    let premier: string | null = null;
    for (const d of dates) {
      const t = store.addTreatment({ name: n, kind: schema.kind, start: d, dose: schema.dose });
      if (premier === null) premier = t.id;
    }
    uiBus.toast(
      dates.length > 1
        ? `${dates.length} événements créés — ${schema.libelle}.`
        : `« ${n} » ajouté — ${schema.libelle}.`,
    );
    name = '';
    kind = 'continuous';
    openId = premier;
  }

  // Annotations
  let annText = $state('');
  let annDate = $state(todayISO());

  const treatments = $derived([...store.study.treatments].sort((a, b) => a.start.localeCompare(b.start)));
  const annotations = $derived([...store.study.annotations].sort((a, b) => a.date.localeCompare(b.date)));

  function addAnnotation() {
    if (!annText.trim()) return;
    store.addAnnotation({ date: annDate, text: annText.trim() });
    annText = '';
  }

  function add() {
    if (!name.trim()) return;
    const t = store.addTreatment({ name: name.trim(), kind, start });
    name = '';
    // Le formulaire repart à l'état par défaut : garder « Événement » alors que
    // le nom vient d'être vidé fait créer un événement sans s'en apercevoir.
    kind = 'continuous';
    openId = t.id; // ouvre l'éditeur pour préciser dose / décroissance
  }

  // ── Import depuis un compte-rendu (« carré bleu ») ──────────────
  // La zone traitement d'un compte-rendu ne concerne QUE les traitements :
  // ce geste vit ici, pas dans Biologie/EFR.
  type TRow = ExtractedTreatment & { include: boolean; origName: string };
  // Trois façons de renseigner les traitements, comme pour la biologie :
  // saisie manuelle, collage du « carré bleu » d'un compte-rendu, ou dictée
  // (Dragon écrit dans la zone de texte comme un clavier).
  type ModeTraitement = 'saisir' | 'coller' | 'dicter';
  let mode = $state<ModeTraitement>('saisir');
  let reportText = $state('');
  let zoneTexte = $state<HTMLTextAreaElement | undefined>();

  function choisirMode(m: ModeTraitement) {
    if (m !== mode) { reportText = ''; trows = []; analyzed = false; }
    mode = m;
    // La dictée écrit là où est le curseur : on l'y place d'emblée.
    if (m !== 'saisir') setTimeout(() => zoneTexte?.focus(), 0);
  }

  // Dictée : Dragon tape par rafales ; on analyse après une pause d'une
  // seconde et demie, ce qui montre le résultat pendant qu'on dicte.
  let minuteurDictee: ReturnType<typeof setTimeout> | undefined;
  function surSaisieDictee() {
    if (mode !== 'dicter') return;
    clearTimeout(minuteurDictee);
    minuteurDictee = setTimeout(() => { if (reportText.trim()) analyzeText(); }, 1500);
  }
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
    trows = []; analyzed = false; reportText = ''; mode = 'saisir';
    uiBus.toast(`${added} traitement(s) ajouté(s)${ended ? `, ${ended} fin(s) de traitement` : ''}.`);
  }

  /**
   * Champ de date en texte libre, toujours affiché JJ/MM/AAAA — même logique
   * que dans la grille de saisie (`DataTab`) et `TreatmentEditor` : un
   * `<input type="date">` natif enregistre au milieu de la frappe et
   * s'affiche au format de la langue du navigateur (irritant C, grief n°1).
   * Rien n'est enregistré avant `Entrée` / `Tab` / perte du focus.
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
  function dateBlur(e: FocusEvent, iso: string, onChange: (iso: string) => void) {
    const input = e.currentTarget as HTMLInputElement;
    const brut = input.value.trim();
    if (brut === '') { input.value = iso ? formatDate(iso) : ''; return; }
    const lu = lireDateSouple(brut);
    if (!lu) {
      uiBus.toast(`Date « ${brut} » non comprise : tapez par exemple 12/03/2024, 12032024 ou mars 2024.`, 'error', 6000);
      input.value = iso ? formatDate(iso) : '';
      return;
    }
    input.value = formatDate(lu.iso);
    onChange(lu.iso);
  }

  function doseSummary(t: typeof treatments[number]): string {
    // Paliers encore vides (toutes doses à 0) : ne pas afficher un « 0 → 0 » trompeur.
    if (t.dosePoints && t.dosePoints.some(p => p.dose > 0)) {
      const doses = t.dosePoints.map(p => p.dose);
      return `${doses[0]} → ${doses[doses.length - 1]} ${t.doseUnit ?? ''}`.trim();
    }
    return t.dose ?? '';
  }
</script>

<div class="col" style="gap:14px;">
  <div class="modeseg" role="group" aria-label="Façon de renseigner les traitements">
    <button class:on={mode === 'saisir'} onclick={() => choisirMode('saisir')}><Icon name="keyboard" size={14} inline /> Saisir</button>
    <button class:on={mode === 'coller'} onclick={() => choisirMode('coller')}><Icon name="file-text" size={14} inline /> Coller</button>
    <button class:on={mode === 'dicter'} onclick={() => choisirMode('dicter')}><Icon name="mic" size={14} inline /> Dicter</button>
  </div>

  {#if mode === 'saisir'}
  <div class="card" style="padding:12px;">
    <div class="row wrap">
      <input class="grow" list="druglist-add" placeholder="Nom (Prednisone, Rituximab, Chirurgie…)" bind:value={name} onkeydown={(e) => e.key === 'Enter' && add()} />
      <datalist id="druglist-add">
        {#each knownDrugs as d (d)}<option value={d}></option>{/each}
      </datalist>
      <div class="seg">
        <button class:on={kind === 'continuous'} onclick={() => (kind = 'continuous')} title="Barre (traitement continu)">Continu</button>
        <button class:on={kind === 'event'} onclick={() => (kind = 'event')} title="Flèche (événement ponctuel)">Événement</button>
      </div>
      <input class="dateinput" type="text" inputmode="numeric" placeholder="JJ/MM/AAAA"
        value={formatDate(start)}
        onfocus={dateFocus}
        onkeydown={(e) => dateKeydown(e, start)}
        onblur={(e) => dateBlur(e, start, (iso) => (start = iso))} />
      <button class="primary" onclick={add} aria-label="Ajouter le traitement">Ajouter</button>
    </div>
    {#if schemasProposes.length}
      <div class="schemas">
        <span class="small muted">Schéma standard :</span>
        {#each schemasProposes as s (s.libelle)}
          <button class="chip" onclick={() => choisirPosologie(s)} title="Remplit la dose{s.joursSuivants?.length ? ` et crée les ${s.joursSuivants.length + 1} événements` : ''}">{s.libelle}</button>
        {/each}
      </div>
    {/if}
    <p class="hint">Après l'ajout, précisez la dose ou la <strong>décroissance</strong> dans l'éditeur qui s'ouvre.</p>
  </div>
  {:else}
    <div class="card" style="padding:12px;">
      {#if mode === 'coller'}
        <p class="faint small" style="margin-bottom:8px;">Copiez le <strong>carré bleu</strong> (zone traitements) du compte-rendu et collez-le ci-dessous (<span class="kbd">Ctrl+V</span>), retouchez le texte si besoin, puis <strong>Analyser</strong> : vous validez chaque ligne avant d'ajouter. <Icon name="lock" size={12} inline /> 100 % local.</p>
      {:else}
        <p class="faint small" style="margin-bottom:8px;">Le curseur est dans la zone : <strong>dictez avec Dragon</strong> (« cellcept un virgule cinq grammes matin et soir… »). Les traitements reconnus s'affichent dès que vous marquez une pause ; vous validez avant d'ajouter. <Icon name="lock" size={12} inline /> 100 % local.</p>
      {/if}
      <textarea class="report" bind:this={zoneTexte} bind:value={reportText}
        oninput={surSaisieDictee}
        aria-label={mode === 'coller' ? 'Texte du carré bleu' : 'Texte dicté'}
        placeholder={mode === 'coller' ? 'Collez ici le carré bleu du compte-rendu…' : 'Dictez ici (Dragon)…'}></textarea>
      <div class="row" style="margin-top:8px;">
        <button onclick={() => { reportText = ''; trows = []; analyzed = false; zoneTexte?.focus(); }}>Effacer</button>
        <div class="spacer"></div>
        <button class="primary" disabled={!reportText.trim()} onclick={analyzeText}>Analyser</button>
      </div>

      {#if analyzed}
        {#if trows.length}
          <div style="margin-top:12px; overflow-x:auto;">
            <table class="grid vgrid">
              <thead>
                <tr><th></th><th style="text-align:left;">Traitement</th><th>Dose</th><th>Type</th><th>Date</th><th></th></tr>
              </thead>
              <tbody>
                {#each trows as r, ri (ri)}
                  <tr class:excluded={!r.include}>
                    <td><input type="checkbox" bind:checked={r.include} aria-label="Inclure {r.name}" /></td>
                    <td class="name"><input class="ninp" bind:value={r.name} aria-label="Nom du traitement" /></td>
                    <td><input class="uinp" bind:value={r.dose} aria-label="Dose de {r.name}" /></td>
                    <td>
                      <select bind:value={r.kind} aria-label="Type de {r.name}">
                        <option value="continuous">Continu</option>
                        <option value="event">Événement</option>
                      </select>
                    </td>
                    <td><input class="dinp" type="text" inputmode="numeric" placeholder="JJ/MM/AAAA" aria-label="Date de {r.name}" value={r.date ? formatDate(r.date) : ''}
                      onfocus={dateFocus}
                      onkeydown={(e) => dateKeydown(e, r.date ?? '')}
                      onblur={(e) => dateBlur(e, r.date ?? '', (iso) => (r.date = iso))} /></td>
                    <td class="flags">
                      {#if r.isStop}<span class="flag stop">arrêt</span>{/if}
                      {#if r.taper}<span class="flag taper">↘ décroissance</span>{/if}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
          <p class="faint" style="font-size:12px;margin-top:6px;">« arrêt X » ferme la barre du traitement X (fin). « décroissance » : ajoutez les paliers dans l'éditeur après l'ajout.</p>
          <div class="row" style="margin-top:10px;">
            <span class="faint small">{trows.filter(r => r.include).length} sélectionné(s)</span>
            <div class="spacer"></div>
            <button onclick={() => { trows = []; analyzed = false; }}>Annuler la lecture</button>
            <button class="primary" onclick={commitText}>Ajouter au graphique</button>
          </div>
        {:else}
          <div class="callout" style="margin-top:12px;">Aucune ligne thérapeutique reconnue. Vérifiez que le texte contient des médicaments datés (ex. « Mai 2020 : CELLCEPT 3 g/jour »).</div>
        {/if}
      {/if}
    </div>
  {/if}

  {#if treatments.length}
    <div class="col" style="gap:8px;">
      {#each treatments as t (t.id)}
        <div class="trow card">
          <button class="head" onclick={() => (openId = openId === t.id ? null : t.id)}>
            <span class="dot" style="background:{t.color}"></span>
            <span class="grow txt">
              <strong>{t.name}</strong>
              {#if doseSummary(t)}<span class="muted small"> · {doseSummary(t)}</span>{/if}
              <span class="faint small">
                — {t.kind === 'continuous' ? 'continu' : 'événement'} · {formatDate(t.start)}{#if t.kind === 'continuous' && t.end} → {formatDate(t.end)}{/if}
              </span>
            </span>
            <span class="chev">{openId === t.id ? '▴' : '▾'}</span>
          </button>
          {#if openId === t.id}
            <div style="padding:0 10px 10px;">
              <TreatmentEditor treatment={t} onClose={() => (openId = null)} />
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {:else}
    <p class="muted small">Aucun traitement. Les traitements continus s'affichent en barres sous le graphique (avec décroissance possible), les événements en flèches.</p>
  {/if}

  <!-- ── Annotations libres ── -->
  <div class="sect-title">Annotations sur la courbe</div>
  <div class="card" style="padding:12px;">
    <div class="row wrap">
      <input class="grow" placeholder="Texte (ex. rechute, biopsie…)" bind:value={annText} onkeydown={(e) => e.key === 'Enter' && addAnnotation()} />
      <input class="dateinput" type="text" inputmode="numeric" placeholder="JJ/MM/AAAA"
        value={formatDate(annDate)}
        onfocus={dateFocus}
        onkeydown={(e) => dateKeydown(e, annDate)}
        onblur={(e) => dateBlur(e, annDate, (iso) => (annDate = iso))} />
      <button class="primary" onclick={addAnnotation} aria-label="Ajouter l’annotation">Ajouter</button>
    </div>
  </div>
  {#if annotations.length}
    <div class="col" style="gap:6px;">
      {#each annotations as a (a.id)}
        <div class="card mini">
          <span class="tag">◆</span>
          <input class="grow flat" value={a.text} onchange={(e) => store.updateAnnotation(a.id, { text: e.currentTarget.value })} />
          <input class="dateinput" type="text" inputmode="numeric" placeholder="JJ/MM/AAAA"
            value={formatDate(a.date)}
            onfocus={dateFocus}
            onkeydown={(e) => dateKeydown(e, a.date)}
            onblur={(e) => dateBlur(e, a.date, (iso) => store.updateAnnotation(a.id, { date: iso }))} />
          <button class="danger small" onclick={() => store.removeAnnotation(a.id)} title="Supprimer cette annotation" aria-label="Supprimer l'annotation « {a.text} »">✕</button>
        </div>
      {/each}
    </div>
  {/if}

</div>

<style>
  /* Même sélecteur de mode que l'onglet Biologie/EFR. */
  .modeseg { display: inline-flex; background: var(--panel); border: 1px solid var(--border-strong); border-radius: 7px; padding: 3px; align-self: flex-start; }
  .modeseg button { border: none; background: transparent; border-radius: 5px; padding: 5px 14px; font-size: 12.5px; color: var(--muted); display: inline-flex; align-items: center; gap: 5px; }
  .modeseg button.on { background: var(--accent-soft); color: var(--accent-text); font-weight: 700; }
  @media (max-width: 700px) {
    .modeseg { align-self: stretch; width: 100%; }
    .modeseg button { flex: 1; justify-content: center; min-height: 44px; font-size: 13.5px; }
  }
  .dateinput { width: 108px; text-align: left; font-variant-numeric: tabular-nums; }
  .seg { display: inline-flex; background: #eef1f4; border-radius: 8px; padding: 2px; }
  .seg button { border: none; background: transparent; border-radius: 6px; padding: 5px 11px; font-size: 12.5px; color: var(--muted); }
  .seg button.on { background: #fff; color: var(--ink); font-weight: 600; box-shadow: 0 1px 2px rgba(0,0,0,.12); }
  .hint { font-size: 11.5px; color: var(--faint); margin: 8px 0 0; }
  .schemas { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 9px; }
  .chip { border: 1px solid var(--border-strong); background: var(--panel); color: var(--ink); font-size: 12px; padding: 4px 10px; border-radius: 999px; }
  .chip:hover { background: var(--accent-weak, #eaf2fb); border-color: var(--accent); color: var(--accent); }

  .report { width: 100%; min-height: 220px; resize: vertical; font-size: 13px; line-height: 1.5; }
  .vgrid .ninp { width: 160px; text-align: left; }
  .vgrid .uinp { width: 74px; }
  .vgrid .dinp { width: 128px; }
  .vgrid .flags { white-space: nowrap; }
  .flag { font-size: 12px; padding: 1px 6px; border-radius: 9px; margin-right: 3px; }
  .flag.stop { background: #eee; color: #666; }
  .flag.taper { background: #e6eff8; color: #2a6fb0; }

  .trow { overflow: hidden; }
  .head { display: flex; align-items: center; gap: 9px; width: 100%; border: none; background: transparent; padding: 10px 12px; text-align: left; }
  .head:hover { background: var(--panel-2); }
  .dot { width: 11px; height: 11px; border-radius: 3px; flex-shrink: 0; }
  .txt { min-width: 0; overflow: hidden; }
  .chev { color: var(--faint); }
  .sect-title { font-size: 12px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; margin-top: 6px; }
  .mini { display: flex; align-items: center; gap: 8px; padding: 7px 10px; }
  .flat { border: none; background: transparent; }
  .flat:focus { background: #fff; }
  .tag { color: #2a6fb0; font-size: 12px; }
  .danger.small { padding: 3px 8px; }
</style>
