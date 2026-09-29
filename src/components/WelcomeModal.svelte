<script lang="ts">
  import Icon from './Icon.svelte';
  let { onClose }: { onClose: () => void } = $props();

  const steps = [
    { icon: 'import', t: 'Ajoutez vos données', d: 'Collez une capture (Ctrl+V), saisissez à la main, ou dictez les résultats — la courbe se génère aussitôt.' },
    { icon: 'pill', t: 'Ajoutez les traitements', d: 'Barres, décroissances de corticoïdes, événements, compte-rendu collé et annotations dans l’onglet « Traitements ».' },
    { icon: 'download', t: 'Exportez', d: 'Image haute résolution, PDF / impression A4, ou copie dans le presse-papiers — qualité publication.' },
  ];

  // Sans ça, le premier `Tab` à l'ouverture saute la modale et va tabuler
  // dans la barre du haut *derrière* elle : au clavier, impossible d'atteindre
  // « Commencer » et l'application « en dessous » reste utilisable en plein
  // pendant que la modale prétend la bloquer. Focus initial + piège à Tab +
  // Échap referment la boucle.
  let modalEl = $state<HTMLDivElement | undefined>();
  $effect(() => { modalEl?.querySelector<HTMLElement>('.start')?.focus(); });

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
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="overlay" onclick={onClose}>
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="welcome-title" tabindex="-1"
       bind:this={modalEl} onclick={(e) => e.stopPropagation()} onkeydown={onModalKeydown}>
    <div class="head">
      <span class="logo"><Icon name="chart-spline" size={30} /></span>
      <div class="titles">
        <div class="name" id="welcome-title">FastCurve</div>
        <div class="tag">Courbes de suivi biologique & EFR, qualité publication — en quelques secondes.</div>
      </div>
    </div>

    <div class="privacy">
      <Icon name="lock" size={14} inline /> <strong>100% sur votre ordinateur.</strong> Aucune donnée n'est envoyée, aucun cloud, aucune IA en ligne. La reconnaissance des captures se fait localement.
    </div>

    <div class="steps">
      {#each steps as s, i (i)}
        <div class="step">
          <span class="s-num">{i + 1}</span>
          <span class="s-icon"><Icon name={s.icon} size={18} /></span>
          <div>
            <div class="s-t">{s.t}</div>
            <div class="s-d">{s.d}</div>
          </div>
        </div>
      {/each}
    </div>

    <div class="avert">
      Outil d'illustration, pas d'aide au diagnostic. Les valeurs lues automatiquement
      sont à vérifier sur le document source avant ajout — les cases en jaune d'abord.
    </div>

    <button class="primary start" onclick={onClose}>Commencer</button>

    <div class="foot">
      Version {__APP_VERSION__} · Informations légales dans Réglages › À propos
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed; inset: 0; z-index: 1000;
    background: rgba(20, 28, 38, 0.42); backdrop-filter: blur(4px);
    display: flex; align-items: center; justify-content: center; padding: 20px;
    animation: fade .2s ease;
  }
  .modal {
    width: 100%; max-width: 480px; background: var(--panel);
    border-radius: 18px; box-shadow: 0 24px 60px rgba(10,16,24,.35);
    padding: 24px; animation: pop .24s cubic-bezier(.2,.8,.25,1);
  }
  .head { display: flex; gap: 14px; align-items: flex-start; }
  .logo { color: var(--accent); line-height: 1; }
  .name { font-size: 20px; font-weight: 700; display: flex; align-items: center; gap: 8px; }
  .avert {
    margin-top: 16px; padding: 10px 12px; border-radius: 10px;
    background: var(--warn-bg); color: var(--warn-ink); font-size: 12.5px; line-height: 1.5;
  }
  .tag { font-size: 13px; color: var(--muted); margin-top: 3px; line-height: 1.45; }

  .privacy {
    margin: 18px 0; padding: 12px 14px; border-radius: 12px;
    background: #eef7f0; border: 1px solid #cfe8d6; color: #1f5b39;
    font-size: 12.5px; line-height: 1.5;
  }

  .steps { display: flex; flex-direction: column; gap: 12px; }
  .step { display: grid; grid-template-columns: auto auto 1fr; gap: 11px; align-items: start; }
  .s-num {
    width: 22px; height: 22px; border-radius: 50%; background: var(--accent); color: #fff;
    font-size: 12px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; margin-top: 1px;
  }
  .s-icon { color: var(--accent); margin-top: 1px; }
  .s-t { font-size: 14px; font-weight: 600; }
  .s-d { font-size: 12.5px; color: var(--muted); line-height: 1.45; margin-top: 1px; }

  .start { width: 100%; margin-top: 22px; padding: 11px; font-size: 15px; font-weight: 600; border-radius: 11px; }

  .foot { text-align: center; font-size: 11.5px; color: var(--faint); margin-top: 14px; }

  @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
  @keyframes pop { from { opacity: 0; transform: translateY(8px) scale(.98); } to { opacity: 1; transform: none; } }
</style>
