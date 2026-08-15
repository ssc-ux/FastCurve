<script lang="ts">
  import { store } from '../../lib/models/store.svelte';
  import { CATALOG, type CatalogEntry, normalize } from '../../lib/models/catalog';
  import type { ParamCategory } from '../../lib/models/types';

  let query = $state('');
  let showFree = $state(false);
  let freeName = $state('');
  let freeUnit = $state('');
  let freeCat = $state<ParamCategory>('libre');

  const existingNames = $derived(new Set(store.study.parameters.map(p => p.name.toLowerCase())));

  const matches = $derived.by<CatalogEntry[]>(() => {
    const q = normalize(query);
    if (!q) return [];
    return CATALOG
      .filter(e => normalize(e.name).includes(q) || e.aliases.some(a => normalize(a).includes(q)))
      .slice(0, 8);
  });

  function add(e: CatalogEntry) {
    store.addFromCatalog(e);
    query = '';
  }

  function addFree() {
    if (!freeName.trim()) return;
    store.addParameter({ name: freeName.trim(), unit: freeUnit.trim(), category: freeCat });
    freeName = ''; freeUnit = ''; showFree = false;
  }

  const catLabel: Record<ParamCategory, string> = {
    biologie: 'Bio', efr: 'EFR', immunologie: 'Immuno', libre: 'Libre',
  };
</script>

<div class="card" style="padding:12px;">
  <div class="row" style="margin-bottom:8px;">
    <strong>Ajouter un paramètre</strong>
    <div class="spacer"></div>
    <button class="ghost small" onclick={() => (showFree = !showFree)}>{showFree ? '↩ Recherche' : '+ Paramètre libre'}</button>
  </div>

  {#if showFree}
    <div class="row wrap">
      <input class="grow" placeholder="Nom (ex. Anti-MOG)" bind:value={freeName} onkeydown={(e) => e.key === 'Enter' && addFree()} />
      <input style="width:90px;" placeholder="Unité" bind:value={freeUnit} onkeydown={(e) => e.key === 'Enter' && addFree()} />
      <select bind:value={freeCat}>
        <option value="libre">Libre</option>
        <option value="biologie">Biologie</option>
        <option value="efr">EFR</option>
        <option value="immunologie">Immuno</option>
      </select>
      <button class="primary" onclick={addFree}>Ajouter</button>
    </div>
  {:else}
    <input class="grow" style="width:100%;" placeholder="Rechercher (créatinine, VEMS, CRP, IgG…)" bind:value={query} />
    {#if matches.length}
      <div class="results">
        {#each matches as e (e.name)}
          <button class="res" disabled={existingNames.has(e.name.toLowerCase())} onclick={() => add(e)}>
            <span class="badge">{catLabel[e.category]}</span>
            <span class="res-name">{e.name}</span>
            <span class="faint small">{e.unit}</span>
            {#if existingNames.has(e.name.toLowerCase())}<span class="faint small">déjà ajouté</span>{/if}
          </button>
        {/each}
      </div>
    {:else if query}
      <p class="muted small" style="margin-top:6px;">Aucun résultat — utilisez « Paramètre libre ».</p>
    {/if}
  {/if}
</div>

<style>
  .results { display: flex; flex-direction: column; gap: 2px; margin-top: 6px; }
  .res { display: flex; align-items: center; gap: 8px; text-align: left; border: none; background: transparent; padding: 6px 8px; border-radius: 6px; }
  .res:hover:not(:disabled) { background: var(--panel-2); }
  .res-name { flex: 1; font-weight: 500; }
</style>
