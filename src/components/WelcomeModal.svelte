<script lang="ts">
  /**
   * Page d'accueil, dans le style de la première page de CorticoPlan (même
   * famille d'outils) : logo centré en dégradé, phrase d'accroche, barre
   * arrondie façon moteur de recherche, deux boutons discrets, pied de page
   * avec l'avertissement et le créateur.
   */
  import Icon from './Icon.svelte';
  import { loadSample } from '../lib/models/sample';
  let { onClose }: { onClose: () => void } = $props();

  // Focus initial + piège à Tab + Échap : au clavier, l'application
  // « en dessous » ne doit pas rester atteignable tant que l'accueil est affiché.
  let modalEl = $state<HTMLDivElement | undefined>();
  $effect(() => { modalEl?.querySelector<HTMLElement>('.barre')?.focus(); });

  function focusables(): HTMLElement[] {
    if (!modalEl) return [];
    return [...modalEl.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
      .filter(el => !el.hasAttribute('disabled'));
  }
  function onModalKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key !== 'Tab') return;
    const items = focusables();
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function exemple() { loadSample(); onClose(); }
</script>

<!-- Une capture collée depuis l'accueil part directement à l'import (le
     collage global d'App.svelte s'en charge) : l'accueil s'efface. -->
<svelte:window onpaste={onClose} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="accueil" role="dialog" aria-modal="true" aria-labelledby="welcome-title" tabindex="-1"
     bind:this={modalEl} onkeydown={onModalKeydown}>
  <main>
    <h1 class="logo" id="welcome-title">
      <img src="./favicon.svg" alt="" width="52" height="52" /> <span>FastCurve</span>
    </h1>
    <p class="accroche">Collez une capture de résultats : la courbe se trace toute seule.</p>

    <button type="button" class="barre" onclick={onClose}>
      <Icon name="import" size={18} />
      <span>Collez une capture (Ctrl+V), un tableau Excel, ou saisissez les valeurs…</span>
    </button>

    <div class="boutons">
      <button type="button" class="start" onclick={onClose}>Commencer</button>
      <button type="button" onclick={exemple}>Essayer un exemple</button>
    </div>
    <p class="discret">
      🔒 100 % sur votre appareil : aucune donnée envoyée, aucun cloud, aucune IA en ligne.
    </p>
  </main>

  <footer>
    <p>
      Outil d'illustration : ne remplace pas le jugement médical. Les valeurs lues automatiquement sont à
      vérifier sur le document source, les cases en jaune d'abord. Ne saisissez jamais de nom de patient.
    </p>
    <p class="createur">Créé par <strong>Quentin Astouati</strong></p>
    <p class="version">Version {__APP_VERSION__} · Informations légales dans Réglages › À propos</p>
  </footer>
</div>

<style>
  /* Jetons de CorticoPlan (style PNDSthèque), limités à cette page. */
  .accueil {
    --c-bg: #f5f6fa;
    --c-card: #ffffff;
    --c-fg: #1c1d1f;
    --c-muted: #6d6f73;
    --c-line: #e4e7ee;
    --c-accent: #1f5fbf;
    --c-vert: #17794a;
    --c-orange: #eb6834;
    position: fixed; inset: 0; z-index: 1000;
    display: flex; flex-direction: column;
    overflow-y: auto;
    padding: 0 16px 32px;
    background:
      radial-gradient(60% 45% at 20% 18%, color-mix(in srgb, var(--c-accent) 14%, transparent), transparent 70%),
      radial-gradient(55% 40% at 85% 30%, color-mix(in srgb, var(--c-vert) 13%, transparent), transparent 70%),
      radial-gradient(50% 40% at 50% 95%, color-mix(in srgb, var(--c-orange) 9%, transparent), transparent 70%),
      var(--c-bg);
    color: var(--c-fg);
    font: 16px/1.5 'Plus Jakarta Sans', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    animation: fade .2s ease;
  }
  .accueil:focus { outline: none; }
  main {
    flex: 1;
    display: flex; flex-direction: column; justify-content: center;
    width: 100%; max-width: 620px; min-height: 68vh; margin: 0 auto;
  }
  .logo {
    display: flex; align-items: center; justify-content: center; gap: 12px;
    margin: 0 0 18px;
    font: 600 clamp(2.2rem, 9vw, 3.4rem) / 1 'Plus Jakarta Sans', system-ui, sans-serif;
    letter-spacing: -0.03em;
  }
  .logo span {
    background: linear-gradient(90deg, var(--c-accent), var(--c-vert));
    -webkit-background-clip: text; background-clip: text; color: transparent;
  }
  .logo img { width: clamp(40px, 10vw, 52px); height: auto; border-radius: 12px; }
  .accroche { margin: 0 0 16px; text-align: center; color: var(--c-muted); }

  /* Barre arrondie et ombrée, comme le champ d'accueil de CorticoPlan. */
  .barre {
    display: flex; align-items: center; gap: 12px;
    width: 100%; min-height: 6rem;
    padding: 0.9rem 1.25rem;
    border: 1px solid var(--c-line); border-radius: 24px;
    background: var(--c-card); color: var(--c-muted);
    font-family: inherit; font-size: 1.05rem; font-weight: 300; line-height: 1.5; text-align: left;
    box-shadow: 0 1px 6px rgb(32 33 36 / 0.12);
    transition: box-shadow .2s;
  }
  .barre :global(svg) { flex: 0 0 auto; color: var(--c-accent); }
  .barre:hover, .barre:focus-visible {
    background: var(--c-card); border-color: var(--c-line);
    box-shadow: 0 2px 10px rgb(32 33 36 / 0.22);
  }
  .barre:focus-visible { outline: 2px solid var(--c-accent); outline-offset: -1px; }
  .barre:active { transform: none; }

  .boutons { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; margin-top: 20px; }
  .boutons button {
    min-height: 40px; padding: 0 18px;
    border: 1px solid transparent; border-radius: 8px;
    background: var(--c-card); color: var(--c-fg);
    font: inherit; font-size: 0.92rem;
  }
  .boutons button:hover { border-color: var(--c-line); box-shadow: 0 1px 2px rgb(0 0 0 / 0.12); }
  .boutons button:focus-visible { outline: 3px solid var(--c-accent); outline-offset: 2px; }

  .discret { margin: 18px 0 0; text-align: center; color: var(--c-muted); font-size: 0.82rem; }

  footer {
    width: 100%; max-width: 780px; margin: 2rem auto 0;
    text-align: center; font-size: 0.85rem; color: var(--c-muted);
  }
  footer p { margin: 0; }
  .createur { margin: 0.4rem 0; }
  .version { font-size: 0.78rem; }

  @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
</style>
