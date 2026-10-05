<script lang="ts">
  import Icon from './Icon.svelte';
  import { uiBus } from '../lib/models/ui.svelte';
  import { loadSample } from '../lib/models/sample';

  /**
   * Écran d'arrivée d'un suivi vide (remplace l'ancienne fenêtre d'accueil) :
   * plutôt qu'une notice à fermer puis une grille minuscule perdue dans le
   * vide, les trois façons d'ajouter des résultats sont proposées d'emblée.
   * Le collage global (Ctrl+V) reste actif ici — voir `onPaste` dans App.
   */
  let { onChoix }: { onChoix: (dest: 'saisir' | 'photo' | 'dictee') => void } = $props();

  let survol = $state(false);
  function onDrop(e: DragEvent) {
    e.preventDefault();
    survol = false;
    const f = e.dataTransfer?.files?.[0];
    if (!f) return;
    uiBus.pasteImage(f);
    onChoix('photo');
  }

  // Accroche qui défile (même rythme que CorticoPlan : fondu toutes les 3,5 s).
  const USAGES = [
    'tracer une courbe EFR',
    'tracer une courbe de CPK',
    'suivre l’évolution sous traitement',
    'partager un suivi',
  ];
  let usage = $state(0);
  let visible = $state(true);
  $effect(() => {
    const minuteur = setInterval(() => {
      visible = false;
      setTimeout(() => { usage = (usage + 1) % USAGES.length; visible = true; }, 300);
    }, 3500);
    return () => clearInterval(minuteur);
  });

  function exemple() {
    loadSample();
    onChoix('saisir');
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<section class="accueil" aria-labelledby="accueil-titre"
         ondragover={(e) => { e.preventDefault(); survol = true; }}
         ondragleave={() => (survol = false)} ondrop={onDrop}>
  <div class="centre">
    <h1 id="accueil-titre" class="logo">
      <span class="logo-ic"><Icon name="chart-spline" size={30} /></span>
      <span class="logo-nom">FastCurve</span>
    </h1>
    <p class="accroche">
      <span class="visuellement-cache">Pour tracer une courbe EFR, une courbe de CPK, suivre l’évolution sous traitement ou partager un suivi.</span>
      <span aria-hidden="true">Pour <span class="usage" class:visible>{USAGES[usage]}</span></span>
    </p>

    <button class="barre" class:survol onclick={() => onChoix('photo')}>
      <span class="b-ic"><Icon name="import" size={20} /></span>
      <span class="b-txt desktop">Collez une capture <kbd>Ctrl</kbd> + <kbd>V</kbd>, ou glissez un PDF / une image ici</span>
      <span class="b-txt mobile">Importer un bilan : photo, capture ou PDF</span>
    </button>

    <div class="boutons">
      <button onclick={() => onChoix('saisir')}><Icon name="table" size={15} inline /> Saisir à la main</button>
      <button onclick={() => onChoix('dictee')}><Icon name="mic" size={15} inline /> Dicter</button>
      <button onclick={exemple}><Icon name="chart-spline" size={15} inline /> Voir un exemple</button>
    </div>

    <div class="avert" role="note">
      <div class="av-titre"><Icon name="lock" size={15} inline /> Confidentialité</div>
      <ul>
        <li><strong>Aucune IA en ligne</strong> : la lecture des captures se fait sur cet ordinateur.</li>
        <li><strong>Aucune donnée ne sort du navigateur.</strong></li>
        <li><strong>Aucun enregistrement sur un serveur</strong> : le suivi reste uniquement dans ce navigateur.</li>
        <li class="fort"><Icon name="alert" size={14} inline /> <strong>N’importez pas de document permettant d’identifier le patient</strong> (nom, date de naissance, n° de dossier…) : masquez ces informations avant.</li>
      </ul>
    </div>

    <p class="pied">
      Outil d’illustration, pas d’aide au diagnostic : vérifiez les valeurs lues sur le document source.
      · Version {__APP_VERSION__} · Informations légales dans Réglages › À propos
    </p>
  </div>
</section>

<style>
  /* Style repris de l'accueil de CorticoPlan : logo dégradé centré, halos
     colorés en fond, barre arrondie façon moteur de recherche. */
  .accueil {
    flex: 1; min-width: 0; min-height: 0; overflow-y: auto;
    display: flex; padding: 24px; position: relative;
    background:
      radial-gradient(60% 45% at 20% 18%, color-mix(in srgb, var(--accent) 14%, transparent), transparent 70%),
      radial-gradient(55% 40% at 85% 30%, color-mix(in srgb, var(--ok) 13%, transparent), transparent 70%),
      radial-gradient(50% 40% at 50% 95%, color-mix(in srgb, #eb6834 9%, transparent), transparent 70%),
      var(--bg);
  }
  .centre { margin: auto; max-width: 640px; width: 100%; text-align: center; }

  .logo {
    display: flex; align-items: center; justify-content: center; gap: 12px; margin: 0;
    font-size: clamp(2.2rem, 9vw, 3.4rem); font-weight: 650; line-height: 1; letter-spacing: -.03em;
  }
  .logo-ic {
    display: inline-flex; padding: 9px; border-radius: 14px;
    background: var(--panel); color: var(--accent); box-shadow: 0 1px 6px rgba(32,33,36,.12);
  }
  .logo-nom {
    background: linear-gradient(90deg, var(--accent), var(--ok));
    -webkit-background-clip: text; background-clip: text; color: transparent;
  }

  .accroche { margin: 18px 0 22px; font-size: 1.15rem; color: var(--muted); min-height: 1.5em; }
  .usage { color: var(--ink); font-weight: 650; opacity: 0; transition: opacity .3s ease; }
  .usage.visible { opacity: 1; }

  .barre {
    display: flex; align-items: center; gap: 14px; width: 100%;
    min-height: 64px; padding: 14px 22px; border-radius: 32px;
    background: var(--panel); border: 1px solid var(--border); color: var(--muted);
    font: inherit; font-size: 1.02rem; text-align: left; cursor: pointer;
    box-shadow: 0 1px 6px rgba(32,33,36,.12); transition: box-shadow .2s, border-color .2s;
  }
  .barre:hover, .barre:focus-visible { box-shadow: 0 2px 10px rgba(32,33,36,.22); }
  .barre.survol { border: 2px dashed var(--accent); background: var(--accent-soft); }
  .b-ic { color: var(--accent); display: inline-flex; }
  kbd {
    border: 1px solid var(--border-strong); border-bottom-width: 2px; border-radius: 5px;
    padding: 0 5px; font: inherit; font-size: .85em; background: var(--bg); color: var(--ink);
  }
  .mobile { display: none; }

  .boutons { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; margin-top: 20px; }
  .boutons button {
    display: inline-flex; align-items: center; gap: 6px;
    min-height: 40px; padding: 0 18px; border-radius: 8px;
    border: 1px solid transparent; background: var(--panel); color: var(--ink);
    font: inherit; font-size: .92rem; cursor: pointer;
  }
  .boutons button:hover { border-color: var(--border-strong); box-shadow: 0 1px 2px rgba(0,0,0,.12); }

  .avert {
    margin: 28px auto 0; text-align: left;
    padding: 14px 18px; border-radius: 12px;
    background: var(--warn-bg); color: var(--warn-ink);
    border: 1px solid color-mix(in srgb, var(--warn-ink) 22%, transparent);
    font-size: 13px; line-height: 1.5;
  }
  .av-titre { font-weight: 750; font-size: 13.5px; margin-bottom: 6px; }
  .avert ul { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 3px; }
  .avert li.fort { margin-top: 4px; }

  .pied { margin-top: 16px; font-size: 11.5px; color: var(--faint); line-height: 1.5; }

  .visuellement-cache {
    position: absolute; width: 1px; height: 1px; overflow: hidden;
    clip: rect(0 0 0 0); white-space: nowrap;
  }

  @media (prefers-reduced-motion: reduce) { .usage { transition: none; } }
  @media (max-width: 640px) {
    .accueil { padding: 20px 16px; }
    .accroche { font-size: 1rem; }
    .barre { min-height: 56px; padding: 12px 18px; }
    .desktop { display: none; }
    .mobile { display: inline; }
  }
</style>
