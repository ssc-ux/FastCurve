<script lang="ts">
  // Aide des raccourcis clavier : touche « ? » (hors champ) ou Réglages.
  import { uiBus } from '../lib/models/ui.svelte';
  import { RACCOURCIS } from '../lib/clavier';

  let dlg: HTMLDialogElement | undefined = $state();
  $effect(() => {
    if (!dlg) return;
    if (uiBus.aideClavier && !dlg.open) dlg.showModal();
    else if (!uiBus.aideClavier && dlg.open) dlg.close();
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<dialog bind:this={dlg} aria-labelledby="aide-clavier-titre" onclose={() => (uiBus.aideClavier = false)}
  onclick={(e) => { if (e.target === dlg) uiBus.aideClavier = false; }}>
  <h2 id="aide-clavier-titre">Raccourcis clavier</h2>
  <table>
    <tbody>
      {#each RACCOURCIS as r (r.touches)}
        <tr><td><span class="kbd">{r.touches}</span></td><td>{r.action}</td></tr>
      {/each}
    </tbody>
  </table>
  <p class="faint small">Sur Mac, Ctrl se lit ⌘.</p>
  <div class="row"><div class="spacer"></div><button class="primary" onclick={() => (uiBus.aideClavier = false)}>Fermer</button></div>
</dialog>

<style>
  dialog { border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--panel); color: var(--ink); padding: 18px 20px; max-width: min(560px, calc(100vw - 32px)); box-shadow: var(--shadow); }
  dialog::backdrop { background: rgba(10, 20, 35, 0.35); }
  h2 { margin: 0 0 10px; font-size: 16px; }
  table { border-collapse: collapse; width: 100%; margin-bottom: 8px; }
  td { padding: 5px 8px 5px 0; vertical-align: top; font-size: 13.5px; }
  td:first-child { white-space: nowrap; }
</style>
