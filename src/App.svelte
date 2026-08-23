<script lang="ts">
  import ChartPanel from './components/ChartPanel.svelte';
  import DataTab from './components/tabs/DataTab.svelte';
  import TreatmentsTab from './components/tabs/TreatmentsTab.svelte';
  import SettingsTab from './components/tabs/SettingsTab.svelte';
  import WelcomeModal from './components/WelcomeModal.svelte';
  import BarreDocument from './components/BarreDocument.svelte';
  import ToastHost from './components/ToastHost.svelte';
  import { store } from './lib/models/store.svelte';
  import { uiBus } from './lib/models/ui.svelte';
  import Icon from './components/Icon.svelte';
  import { downloadText } from './lib/chart/export';
  import { preheatOcr } from './lib/ocr/ocr';

  // Préchauffe l'OCR après le premier rendu (le 1er import paraît instantané).
  const ric = (globalThis as any).requestIdleCallback ?? ((f: () => void) => setTimeout(f, 1200));
  ric(() => preheatOcr());

  /** Valide la cellule en cours d'édition : sans cela, la dernière valeur
   *  tapée est perdue si l'onglet est fermé sans avoir quitté le champ. */
  function validerSaisieEnCours() {
    const a = document.activeElement as HTMLElement | null;
    if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) a.blur();
  }

  // Confidentialité : armer une purge à la fermeture (un simple F5 ne l'active pas).
  function onBeforeUnload() {
    validerSaisieEnCours();
    if (store.clearOnExit) store.armExitWipe();
  }
  function onVisibilityChange() {
    if (document.visibilityState === 'hidden') validerSaisieEnCours();
  }

  // Export direct depuis le bandeau d'erreur de sauvegarde (secours anti-perte).
  function exportCurrent() {
    const name = (store.study.patientLabel || 'fastcurve').replace(/[^\w\-À-ÿ]/g, '_');
    downloadText(store.exportJSON(), `${name}.fastcurve.json`, 'application/json');
  }

  const WELCOME_KEY = 'fastcurve.welcome.v1';
  try { if (localStorage.getItem(WELCOME_KEY) !== '1') uiBus.welcomeOpen = true; } catch { /* ignore */ }
  function closeWelcome() {
    try { localStorage.setItem(WELCOME_KEY, '1'); } catch { /* ignore */ }
    uiBus.welcomeOpen = false;
  }

  // Reprise d'une modification faite dans un autre onglet : on le dit, sinon
  // l'écran change tout seul sans explication.
  $effect(() => {
    if (store.externalReload) uiBus.toast('Ce suivi vient d’être modifié dans un autre onglet : la version la plus récente est affichée.', 'info', 5000);
  });

  function onKey(e: KeyboardEvent) {
    if (!(e.ctrlKey || e.metaKey)) return;
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); store.undo(); }
    else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); store.redo(); }
  }

  // Collage global : une capture collée n'importe où lance l'import (zéro navigation).
  function onPaste(e: ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (items) {
      for (const it of items) {
        if (it.type.startsWith('image/')) {
          const f = it.getAsFile();
          if (f) { uiBus.pasteImage(f); activeTab = 'data'; e.preventDefault(); return; }
        }
      }
    }
    // Collage de tableau (Excel / texte tabulé) — hors champs de saisie
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const text = e.clipboardData?.getData('text') ?? '';
    const looksTabular = /\t/.test(text) && text.split(/\r?\n/).filter(l => l.trim()).length >= 1;
    if (looksTabular) { uiBus.pasteTable(text); activeTab = 'data'; e.preventDefault(); }
  }

  type Tab = 'data' | 'treatments' | 'settings';
  let activeTab = $state<Tab>('data');

  // Rail vertical (icônes seules, remplace l'ancienne barre d'onglets
  // horizontale) : `label` sert de `title`/`aria-label` puisque le texte
  // n'est plus visible en permanence.
  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'data', label: 'Biologie/EFR', icon: 'table' },
    { id: 'treatments', label: 'Traitements', icon: 'pill' },
    { id: 'settings', label: 'Réglages', icon: 'settings' },
  ];

  /**
   * Tant qu'aucune valeur n'a été saisie, il n'y a rien à montrer sur la
   * courbe — juste « Ajoutez des valeurs… » sur les deux tiers de l'écran,
   * pendant que la saisie, ce qu'il y a effectivement à faire, est reléguée au
   * tiers restant. Le cahier des charges est explicite : la saisie doit
   * occuper la majorité de l'écran tant que le suivi est vide. Un
   * redimensionnement manuel de la poignée est un choix délibéré qui l'emporte
   * définitivement sur cette bascule automatique.
   */
  let reglageManuel = $state(false);
  const sansDonnees = $derived(store.study.measurements.length === 0 && !reglageManuel);

  // ── Barre latérale redimensionnable / repliable ──
  const MIN = 320;
  const UI_KEY = 'fastcurve.ui.v1';
  function loadUi() {
    try { return JSON.parse(localStorage.getItem(UI_KEY) || '{}'); } catch { return {}; }
  }
  const MIN_H = 200;          // hauteur minimale du plan de saisie
  const PLANCHER_COURBE = 300; // la courbe ne descend jamais sous cette hauteur
  const savedUi = loadUi();
  let sidebarW = $state<number>(typeof savedUi.w === 'number' ? savedUi.w : 440);
  let collapsed = $state<boolean>(!!savedUi.collapsed);
  let dragging = $state(false);

  /**
   * « horizontal » : la grille occupe toute la largeur, la courbe est dessous.
   * La grille est large par nature (paramètres × dates) et partage son axe —
   * le temps — avec la courbe : empilés, la colonne N se trouve au-dessus du
   * point de la date N. En colonne étroite, seules deux dates tiennent.
   */
  type Sens = 'horizontal' | 'vertical';
  // Choix du médecin : « en colonnes » par défaut à l'ouverture (la courbe
  // garde toute sa hauteur dès le premier écran, même sur un document vide) —
  // sauf écran étroit, où « en bandes » reste plus lisible.
  const sensParDefaut = (): Sens =>
    (typeof window !== 'undefined' && window.innerWidth < 900) ? 'horizontal' : 'vertical';
  let sens = $state<Sens>(savedUi.sens === 'vertical' || savedUi.sens === 'horizontal' ? savedUi.sens : sensParDefaut());
  let sidebarH = $state<number>(typeof savedUi.h === 'number' ? savedUi.h : 330);

  function saveUi() {
    try { localStorage.setItem(UI_KEY, JSON.stringify({ w: sidebarW, h: sidebarH, collapsed, sens })); } catch { /* ignore */ }
  }

  function maxW() { return Math.max(MIN, Math.round(window.innerWidth * 0.72)); }
  function maxH() { return Math.max(MIN_H, window.innerHeight - PLANCHER_COURBE); }

  function basculerSens() {
    sens = sens === 'horizontal' ? 'vertical' : 'horizontal';
    saveUi();
  }

  function startDrag(e: PointerEvent) {
    if (collapsed) return;
    reglageManuel = true; // choix délibéré : l'emporte sur la mise en page « suivi vide »
    dragging = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }
  function onDrag(e: PointerEvent) {
    if (!dragging) return;
    if (sens === 'horizontal') {
      const haut = (document.querySelector('.body') as HTMLElement)?.getBoundingClientRect().top ?? 0;
      sidebarH = Math.min(maxH(), Math.max(MIN_H, e.clientY - haut));
    } else {
      sidebarW = Math.min(maxW(), Math.max(MIN, e.clientX));
    }
  }
  function endDrag() {
    if (!dragging) return;
    dragging = false;
    saveUi();
  }
  function toggleCollapse() { collapsed = !collapsed; saveUi(); }
</script>

<svelte:window onkeydown={onKey} onpaste={onPaste} onpointermove={onDrag} onpointerup={endDrag} onbeforeunload={onBeforeUnload} onpagehide={validerSaisieEnCours} />
<svelte:document onvisibilitychange={onVisibilityChange} />

<div class="app">
  <header class="topbar">
    <div class="brand"><span class="logo"><Icon name="chart-spline" size={19} /></span><span class="title">FastCurve</span></div>
    <BarreDocument />
    {#if store.savedAt}
      {#key store.savedAt}
        <span class="saved" title="Enregistré dans ce navigateur">✓ Enregistré</span>
      {/key}
    {/if}
    <div class="spacer"></div>
    <button class="topbtn side-toggle" onclick={toggleCollapse} title={collapsed ? 'Afficher le panneau de saisie' : 'Masquer le panneau : donne toute la place à la courbe'}>
      <Icon name="panel-left" size={14} />
      {collapsed ? 'Afficher le panneau' : 'Plein écran courbe'}
    </button>
    <button class="topbtn sens-btn" onclick={basculerSens}
            title={sens === 'horizontal' ? 'Passer en colonnes : saisie à gauche, courbe à droite' : 'Passer en bandes : saisie en haut sur toute la largeur, courbe dessous'}>
      <Icon name={sens === 'horizontal' ? 'panel-left' : 'table'} size={14} />
      {sens === 'horizontal' ? 'En colonnes' : 'En bandes'}
    </button>
    <button class="topbtn" disabled={!store.canUndo} onclick={() => store.undo()} title="Annuler (Ctrl+Z)"><Icon name="undo" size={14} /> Annuler</button>
    <button class="topbtn" disabled={!store.canRedo} onclick={() => store.redo()} title="Rétablir (Ctrl+Maj+Z)"><Icon name="redo" size={14} /> Rétablir</button>
  </header>

  {#if store.saveError}
    <div class="savebanner" role="alert">
      <span class="sb-icon">⚠️</span>
      <span class="sb-text">{store.saveError}</span>
      <button class="sb-export" onclick={exportCurrent}>⬇ Exporter (.json)</button>
      <button class="sb-close" onclick={() => (store.saveError = null)} aria-label="Fermer">✕</button>
    </div>
  {/if}

  <div class="shell">
    <nav class="rail" aria-label="Navigation entre les écrans">
      {#each tabs as t (t.id)}
        <button class="rbtn" class:on={activeTab === t.id} onclick={() => (activeTab = t.id)}
                title={t.label} aria-label={t.label} aria-current={activeTab === t.id ? 'page' : undefined}>
          <Icon name={t.icon} size={19} />
        </button>
      {/each}
    </nav>

    <div class="body" class:dragging class:horizontal={sens === 'horizontal'} class:vide={sansDonnees && !collapsed}>
      <aside class="sidebar" class:collapsed
             style={sens === 'horizontal'
               ? `max-height:${collapsed ? 0 : sidebarH}px`
               : `width:${collapsed ? 0 : sidebarW}px`}>
        <div class="tab-content" class:forme={activeTab !== 'data'} class:centrer={activeTab === 'data' && sansDonnees}>
          {#if activeTab === 'data'}<DataTab />
          {:else if activeTab === 'treatments'}<TreatmentsTab />
          {:else if activeTab === 'settings'}<SettingsTab />
          {/if}
        </div>
      </aside>

      {#if !collapsed}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="divider" onpointerdown={startDrag} ondblclick={toggleCollapse} title="Glisser pour redimensionner · double-clic pour masquer">
          <span class="grip"></span>
        </div>
      {/if}

      <main class="chart-area">
        <ChartPanel />
      </main>
    </div>
  </div>
</div>

{#if uiBus.welcomeOpen}
  <WelcomeModal onClose={closeWelcome} />
{/if}

<ToastHost />

<style>
  .app { display: flex; flex-direction: column; height: 100vh; }

  /* Barre supérieure sombre (Console clinique dense) : logo, document, actions —
     texte clair sur marine, boutons `.topbtn` (voir global.css) plutôt que le
     style « pilule » clair de l'ancienne barre blanche. */
  .topbar {
    display: flex; align-items: center; gap: 10px;
    padding: 0 14px; height: 52px; flex: 0 0 auto;
    background: var(--topbar-bg); color: var(--topbar-ink);
    border-bottom: 1px solid var(--topbar-border);
    font-size: 12.5px;
  }
  .brand { display: flex; align-items: center; gap: 8px; padding-right: 4px; }
  .logo { display: inline-flex; color: var(--rail-ink-on); }
  .title { font-weight: 800; font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: var(--rail-ink-on); }

  .saved { font-size: 12px; color: #7fe0ab; font-weight: 600; white-space: nowrap; animation: savedpulse 1.4s ease-out; }
  @keyframes savedpulse {
    0% { opacity: 0; transform: translateY(-1px); }
    18% { opacity: 1; }
    70% { opacity: 1; }
    100% { opacity: .55; transform: none; }
  }

  .savebanner {
    display: flex; align-items: center; gap: 10px;
    padding: 10px 16px; background: #fdecea; color: #8a1c12;
    border-bottom: 1px solid #f5c6c0; font-size: 13px;
  }
  .sb-icon { font-size: 15px; }
  .sb-text { flex: 1; line-height: 1.35; }
  .sb-export { border: 1px solid #d98b80; background: #fff; color: #8a1c12; font-size: 12.5px; font-weight: 600; padding: 5px 12px; border-radius: 999px; white-space: nowrap; }
  .sb-export:hover { background: #8a1c12; color: #fff; border-color: #8a1c12; }
  .sb-close { border: none; background: transparent; color: #8a1c12; font-size: 14px; padding: 2px 6px; border-radius: 6px; }
  .sb-close:hover { background: rgba(138,28,18,.12); }

  /* Rail vertical étroit (icônes seules) + plan de travail. Le rail est un
     élément de chrome permanent — il ne fait pas partie du panneau
     repliable/redimensionnable (`Plein écran courbe` ne le masque pas). */
  .shell { flex: 1; display: flex; min-height: 0; }
  .rail {
    flex: 0 0 auto; width: 56px; background: var(--rail-bg);
    display: flex; flex-direction: column; align-items: center;
    padding: 12px 0; gap: 4px;
  }
  .rbtn {
    width: 40px; height: 40px; border: none; background: transparent;
    border-radius: 8px; display: flex; align-items: center; justify-content: center;
    color: var(--rail-ink); padding: 0;
  }
  .rbtn:hover { background: rgba(255,255,255,.05); color: var(--rail-ink-on); }
  .rbtn.on { background: var(--rail-bg-on); color: var(--rail-ink-on); }
  .rbtn:active { transform: none; }

  .body { flex: 1; display: flex; min-height: 0; min-width: 0; }
  /* Plan de travail en bandes : la grille prend toute la largeur, la courbe
     est dessous et partage visuellement l'axe du temps avec les colonnes. */
  .body.horizontal { flex-direction: column; --grille-max-h: none; }
  .sidebar {
    flex: 0 0 auto; overflow: hidden;
    display: flex; flex-direction: column;
    background: var(--bg); min-height: 0;
    transition: width .3s cubic-bezier(.4, 0, .2, 1);
  }
  .body.dragging .sidebar { transition: none; }
  .sidebar.collapsed { width: 0 !important; }
  /* Hauteur ajustée au contenu, plafonnée par le séparateur : une grille de
     trois lignes ne doit pas réserver 400 px de vide au-dessus de la courbe. */
  .body.horizontal .sidebar {
    width: 100% !important; flex: 0 0 auto; height: auto;
    transition: max-height .25s cubic-bezier(.4, 0, .2, 1);
  }
  .body.horizontal.dragging .sidebar { transition: none; }
  .body.horizontal .sidebar.collapsed { max-height: 0 !important; }
  /* Suivi vide : la saisie doit occuper la majorité de l'écran, pas le
     graphique qui n'a rien à montrer. `flex-basis: 0` + un ratio de
     croissance fait la proportion indépendamment de la hauteur du contenu —
     contrairement au `max-height` ci-dessus, qui plafonne mais ne fait
     jamais grandir. `!important` nécessaire : l'attribut `style` du `<aside>`
     pose un `max-height` en ligne qui l'emporterait sinon. */
  .body.horizontal.vide .sidebar { flex: 62 38 0%; max-height: none !important; }
  .body.horizontal.vide .chart-area { flex: 38 62 0%; }
  /* Les onglets Traitements et Réglages sont des formulaires : en pleine
     largeur ils deviennent illisibles. On les garde dans une colonne confortable. */
  .body.horizontal .tab-content.forme { max-width: 760px; }

  .tab-content { flex: 1; overflow-y: auto; padding: 16px; min-height: 0; }
  /* Suivi vide : donne à DataTab (`.data`/`.corps`) une hauteur à occuper,
     pour qu'il puisse centrer son tableau au lieu de le laisser collé en
     haut d'un grand vide (voir `.corps.centrer` dans DataTab.svelte). Sans
     effet une fois des données présentes : la classe n'est posée que pour
     ce cas précis (`sansDonnees`), et la sidebar retrouve alors sa hauteur
     naturelle (`.body.horizontal .sidebar { height: auto }`). */
  .tab-content.centrer { display: flex; flex-direction: column; }

  /* Poignée de redimensionnement */
  .body.horizontal .divider { width: auto; height: 10px; cursor: row-resize; }
  .body.horizontal .grip { width: 34px; height: 3px; }
  .divider {
    flex: 0 0 auto; width: 10px; cursor: col-resize;
    display: flex; align-items: center; justify-content: center;
    background: var(--border); position: relative;
  }
  .divider:hover, .body.dragging .divider { background: var(--accent); }
  .grip { width: 3px; height: 34px; border-radius: 3px; background: rgba(255,255,255,.7); }
  .divider:hover .grip, .body.dragging .grip { background: #fff; }

  /* `min-height: 0` est indispensable en bandes : sans lui la zone de courbe
     grandit avec ses 12 panneaux et c'est la page entière qui défile — la
     barre du haut et le tableau disparaissent alors de l'écran. */
  .chart-area { flex: 1; min-width: 0; min-height: 0; background: var(--canvas-bg); }

  @media (max-width: 900px) { .sens-btn { display: none; } }

  @media (max-width: 820px) {
    .body, .body.horizontal { flex-direction: column; }
    .sidebar, .body.horizontal .sidebar { width: 100% !important; height: 52% !important; }
    .divider { display: none; }
    .chart-area { height: 48%; }
    .side-toggle { display: none; }
    /* En dessous de 800px environ, la barre du haut n'a plus la place pour
       « Nouveau / Ouvrir / Enregistrer » (jamais compressibles, l'action
       reste lisible) ET le badge « ✓ Enregistré » : les deux finissaient par
       occuper le même espace, l'un peint par-dessus l'autre. Le badge est le
       moins utile des deux — la sauvegarde reste automatique sans lui. */
    .saved { display: none; }
  }
</style>
