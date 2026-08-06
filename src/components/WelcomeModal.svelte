<script lang="ts">
  let { onClose }: { onClose: () => void } = $props();

  const steps = [
    { icon: '📥', t: 'Ajoutez vos données', d: 'Collez une capture (Ctrl+V), saisissez à la main, ou collez un compte-rendu — la courbe se génère aussitôt.' },
    { icon: '💊', t: 'Ajoutez les traitements', d: 'Barres, décroissances de corticoïdes, événements et annotations dans l’onglet « Repères ».' },
    { icon: '📤', t: 'Exportez', d: 'Image haute résolution, PDF / impression A4, ou copie dans le presse-papiers — qualité publication.' },
  ];
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="overlay" onclick={onClose}>
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="modal" onclick={(e) => e.stopPropagation()}>
    <div class="head">
      <span class="logo">📈</span>
      <div class="titles">
        <div class="name">FastCurve <span class="beta">bêta</span></div>
        <div class="tag">Courbes de suivi biologique & EFR, qualité publication — en quelques secondes.</div>
      </div>
    </div>

    <div class="privacy">
      🔒 <strong>100% sur votre ordinateur.</strong> Aucune donnée n'est envoyée, aucun cloud, aucune IA en ligne. La reconnaissance des captures se fait localement.
    </div>

    <div class="steps">
      {#each steps as s, i (i)}
        <div class="step">
          <span class="s-num">{i + 1}</span>
          <span class="s-icon">{s.icon}</span>
          <div>
            <div class="s-t">{s.t}</div>
            <div class="s-d">{s.d}</div>
          </div>
        </div>
      {/each}
    </div>

    <button class="primary start" onclick={onClose}>Commencer</button>

    <div class="foot">
      Créé par <strong>Quentin Astouati</strong> · Version bêta · Vos retours sont les bienvenus
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
  .logo { font-size: 30px; line-height: 1; }
  .name { font-size: 20px; font-weight: 700; display: flex; align-items: center; gap: 8px; }
  .beta {
    font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase;
    background: var(--accent-soft); color: var(--accent); padding: 2px 8px; border-radius: 999px;
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
  .s-icon { font-size: 18px; }
  .s-t { font-size: 14px; font-weight: 600; }
  .s-d { font-size: 12.5px; color: var(--muted); line-height: 1.45; margin-top: 1px; }

  .start { width: 100%; margin-top: 22px; padding: 11px; font-size: 15px; font-weight: 600; border-radius: 11px; }

  .foot { text-align: center; font-size: 11.5px; color: var(--faint); margin-top: 14px; }

  @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
  @keyframes pop { from { opacity: 0; transform: translateY(8px) scale(.98); } to { opacity: 1; transform: none; } }
</style>
