<script lang="ts">
  import { uiBus } from '../lib/models/ui.svelte';
  const icon = (k: string) => (k === 'error' ? '⚠️' : k === 'info' ? 'ℹ️' : '✓');
</script>

<div class="host" aria-live="polite">
  {#each uiBus.toasts as t (t.id)}
    <div class="toast {t.kind}" role="status">
      <span class="ic">{icon(t.kind)}</span>
      <span class="tx">{t.text}</span>
      {#if t.action}
        <button class="act" onclick={() => t.action!.run()}>{t.action.label}</button>
      {/if}
      <button class="x" onclick={() => uiBus.dismissToast(t.id)} aria-label="Fermer">✕</button>
    </div>
  {/each}
</div>

<style>
  .host {
    position: fixed; bottom: 18px; left: 50%; transform: translateX(-50%);
    z-index: 200; display: flex; flex-direction: column; gap: 8px; align-items: center;
    pointer-events: none; width: max-content; max-width: 92vw;
  }
  .toast {
    pointer-events: auto; display: flex; align-items: center; gap: 10px;
    background: #1b2733; color: #fff; padding: 11px 14px; border-radius: 12px;
    box-shadow: 0 8px 28px rgba(16,24,32,.28); font-size: 13.5px; max-width: 460px;
    animation: rise .18s ease-out;
  }
  .toast.success { background: #14683e; }
  .toast.error { background: #8a1c12; }
  .toast.info { background: #1b2733; }
  .ic { font-size: 15px; }
  .tx { line-height: 1.35; }
  .act { border: 1px solid rgba(255,255,255,.5); background: transparent; color: #fff; font-size: 12.5px; font-weight: 600; padding: 4px 12px; border-radius: 999px; }
  .act:hover { background: rgba(255,255,255,.18); }
  .x {
    border: none; background: transparent; color: rgba(255,255,255,.7); font-size: 13px;
    padding: 2px 4px; border-radius: 6px; min-width: 24px; min-height: 24px;
    display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;
  }
  .x:hover { background: rgba(255,255,255,.15); color: #fff; }
  @keyframes rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }

  /* Téléphone : la barre de navigation du bas (voir App.svelte, ~56-72px
     selon la zone d'encoche) occuperait sinon le même espace que les
     notifications — un toast qui recouvre la navigation la rend
     inutilisable tant qu'il est affiché. */
  @media (max-width: 640px) {
    .host { bottom: calc(72px + env(safe-area-inset-bottom, 0px)); max-width: 94vw; }
  }
</style>
