<script lang="ts">
  import { store } from '../../lib/models/store.svelte';
  import { uiBus } from '../../lib/models/ui.svelte';
  import type { Parameter } from '../../lib/models/types';

  let { param, onClose }: { param: Parameter; onClose: () => void } = $props();

  const params = $derived([...store.study.parameters].sort((a, b) => a.order - b.order));

  function move(dir: -1 | 1) {
    const list = params;
    const i = list.findIndex(p => p.id === param.id);
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const a = list[i], b = list[j];
    const ao = a.order;
    store.updateParameter(a.id, { order: b.order });
    store.updateParameter(b.id, { order: ao });
  }

  function numOrNull(v: string): number | null {
    if (v.trim() === '') return null;
    const n = parseFloat(v.replace(',', '.'));
    return isNaN(n) ? null : n;
  }

  const idx = $derived(params.findIndex(p => p.id === param.id));
</script>

<div class="editor">
  <div class="row">
    <input class="color" type="color" value={param.color} onchange={(e) => store.updateParameter(param.id, { color: e.currentTarget.value })} title="Couleur" aria-label="Couleur du paramètre" />
    <input class="name grow" value={param.name} onchange={(e) => store.updateParameter(param.id, { name: e.currentTarget.value })} />
    <button class="icon" disabled={idx === 0} onclick={() => move(-1)} title="Monter" aria-label="Monter ce paramètre">↑</button>
    <button class="icon" disabled={idx === params.length - 1} onclick={() => move(1)} title="Descendre" aria-label="Descendre ce paramètre">↓</button>
    <button class="icon" onclick={onClose} title="Fermer" aria-label="Fermer l'éditeur du paramètre">✕</button>
  </div>
  <div class="fields">
    <label>Unité<input value={param.unit} onchange={(e) => store.updateParameter(param.id, { unit: e.currentTarget.value })} /></label>
    <label>Norme basse<input value={param.refLow ?? ''} onchange={(e) => store.updateParameter(param.id, { refLow: numOrNull(e.currentTarget.value) })} /></label>
    <label>Norme haute<input value={param.refHigh ?? ''} onchange={(e) => store.updateParameter(param.id, { refHigh: numOrNull(e.currentTarget.value) })} /></label>
    {#if param.category === 'efr'}
      <label>Affichage
        <select value={param.display} onchange={(e) => store.updateParameter(param.id, { display: e.currentTarget.value as any })}>
          <option value="absolute">Valeur absolue</option>
          <option value="percent">% théorique</option>
        </select>
      </label>
    {/if}
  </div>
  <div class="row end">
    <button class="del" onclick={() => { const n = param.name; store.removeParameter(param.id); onClose(); uiBus.toastAction(`« ${n} » supprimé.`, 'Annuler', () => store.undo()); }}>Supprimer ce paramètre</button>
  </div>
</div>

<style>
  .editor { background: var(--panel-2); border: 1px solid var(--border); border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
  .color { width: 30px; height: 30px; padding: 2px; border-radius: 8px; }
  .name { font-weight: 600; }
  .fields { display: flex; flex-wrap: wrap; gap: 10px; }
  .fields label { display: inline-flex; flex-direction: column; gap: 3px; font-size: 12px; }
  .fields input, .fields select { width: 96px; }
  .icon { padding: 5px 9px; }
  .row.end { justify-content: flex-end; }
  .del { color: var(--danger); border-color: #e3b6b0; background: transparent; font-size: 12.5px; }
  .del:hover { background: #fbecea; }
</style>
