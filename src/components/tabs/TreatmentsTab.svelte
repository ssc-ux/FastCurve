<script lang="ts">
  import { store } from '../../lib/models/store.svelte';
  import { todayISO, formatDate, lireDateSouple } from '../../lib/models/types';
  import type { TreatmentKind } from '../../lib/models/types';
  import { getKnownDrugs } from '../../lib/learn/memory';
  import { uiBus } from '../../lib/models/ui.svelte';
  import TreatmentEditor from './TreatmentEditor.svelte';

  const knownDrugs = getKnownDrugs();

  let name = $state('');
  let kind = $state<TreatmentKind>('continuous');
  let start = $state(todayISO());
  let openId = $state<string | null>(null);

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
      <button class="primary" onclick={add}>Ajouter</button>
    </div>
    <p class="hint">Après l'ajout, précisez la dose ou la <strong>décroissance</strong> dans l'éditeur qui s'ouvre.</p>
  </div>

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
      <button class="primary" onclick={addAnnotation}>Ajouter</button>
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
  .dateinput { width: 108px; text-align: left; font-variant-numeric: tabular-nums; }
  .seg { display: inline-flex; background: #eef1f4; border-radius: 8px; padding: 2px; }
  .seg button { border: none; background: transparent; border-radius: 6px; padding: 5px 11px; font-size: 12.5px; color: var(--muted); }
  .seg button.on { background: #fff; color: var(--ink); font-weight: 600; box-shadow: 0 1px 2px rgba(0,0,0,.12); }
  .hint { font-size: 11.5px; color: var(--faint); margin: 8px 0 0; }
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
