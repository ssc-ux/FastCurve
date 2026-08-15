<script lang="ts">
  import { store } from '../lib/models/store.svelte';
  import { renderChart, type RenderResult } from '../lib/chart/render';
  import { svgToPngBlob, downloadBlob, downloadText, copyPngToClipboard } from '../lib/chart/export';
  import { formatDate } from '../lib/models/types';
  import { uiBus } from '../lib/models/ui.svelte';

  let container: HTMLDivElement;
  let width = $state(920);
  let hover = $state<{ x: number; y: number; label: string } | null>(null);
  let copied = $state(false);
  let showMenu = $state(false);
  let showExport = $state(false);
  let editingTitle = $state(false);

  // #6 : édition d'un point directement sur la courbe (popover)
  type PointEdit = { pId: string; name: string; date: string; x: number; y: number };
  let pointEdit = $state<PointEdit | null>(null);
  let pointVal = $state('');

  // Rendu réactif : dépend de l'étude et de la largeur disponible
  const result = $derived<RenderResult>(renderChart(store.study, width));

  $effect(() => {
    if (!container) return;
    const ro = new ResizeObserver(entries => {
      const w = entries[0].contentRect.width;
      width = Math.max(360, Math.min(1400, Math.round(w - 4)));
    });
    ro.observe(container);
    return () => ro.disconnect();
  });

  function onMove(e: MouseEvent) {
    const svgEl = (e.currentTarget as HTMLElement).querySelector('svg');
    if (!svgEl) { hover = null; return; }
    const rect = svgEl.getBoundingClientRect();
    const scale = result.width / rect.width;
    const mx = (e.clientX - rect.left) * scale;
    const my = (e.clientY - rect.top) * scale;
    let best: typeof result.hotspots[0] | null = null;
    let bestD = 18 * scale;
    for (const h of result.hotspots) {
      const d = Math.hypot(h.cx - mx, h.cy - my);
      if (d < bestD) { bestD = d; best = h; }
    }
    if (best) {
      const ul = best.param.category === 'efr' && best.param.display === 'percent' ? '% théo.' : best.param.unit;
      hover = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        label: `${best.param.name} · ${formatDate(best.date)} · ${best.value}${ul ? ' ' + ul : ''}`,
      };
    } else hover = null;
  }

  /** Trouve le point (hotspot) le plus proche du clic, en coordonnées SVG. */
  function nearestHotspot(e: MouseEvent) {
    const svgEl = (e.currentTarget as HTMLElement).querySelector('svg');
    if (!svgEl) return null;
    const rect = svgEl.getBoundingClientRect();
    const scale = result.width / rect.width;
    const mx = (e.clientX - rect.left) * scale;
    const my = (e.clientY - rect.top) * scale;
    let best: typeof result.hotspots[0] | null = null;
    let bestD = 20 * scale;
    for (const h of result.hotspots) {
      const d = Math.hypot(h.cx - mx, h.cy - my);
      if (d < bestD) { bestD = d; best = h; }
    }
    if (!best) return null;
    return { best, x: (best.cx / scale), y: (best.cy / scale) };
  }

  function onChartClick(e: MouseEvent) {
    const hit = nearestHotspot(e);
    if (!hit) { pointEdit = null; return; }
    e.stopPropagation();
    const m = store.valueAt(hit.best.param.id, hit.best.date);
    pointVal = m ? (m.qualifier ?? '') + m.value : String(hit.best.value);
    pointEdit = { pId: hit.best.param.id, name: hit.best.param.name, date: hit.best.date, x: hit.x, y: hit.y };
    hover = null;
  }

  function savePoint() {
    if (!pointEdit) return;
    const t = pointVal.trim();
    if (t === '') { store.removeMeasurement(pointEdit.pId, pointEdit.date); pointEdit = null; return; }
    let qualifier: '<' | '>' | null = null;
    let rest = t;
    if (t[0] === '<' || t[0] === '>') { qualifier = t[0] as '<' | '>'; rest = t.slice(1); }
    const v = parseFloat(rest.replace(',', '.'));
    if (!isNaN(v)) store.setMeasurement(pointEdit.pId, pointEdit.date, v, qualifier);
    pointEdit = null;
  }
  function deletePoint() {
    if (!pointEdit) return;
    store.removeMeasurement(pointEdit.pId, pointEdit.date);
    pointEdit = null;
  }

  const filenameBase = () => {
    const t = (store.study.patientLabel || store.study.settings.title || 'FastCurve').replace(/[^\w\-À-ÿ ]/g, '').trim().replace(/\s+/g, '_');
    return t || 'FastCurve';
  };

  async function exportPng(scale: number) {
    const blob = await svgToPngBlob(result.svg, result.width, result.height, scale);
    downloadBlob(blob, `${filenameBase()}.png`);
  }
  function exportSvg() {
    downloadText(result.svg, `${filenameBase()}.svg`, 'image/svg+xml');
  }
  async function copyImg() {
    const blob = await svgToPngBlob(result.svg, result.width, result.height, 3);
    const ok = await copyPngToClipboard(blob);
    if (ok) { copied = true; setTimeout(() => (copied = false), 1500); uiBus.toast('✓ Courbe copiée — collez dans PowerPoint (Ctrl+V)'); }
    else { downloadBlob(blob, `${filenameBase()}.png`); uiBus.toast('Image téléchargée (copie presse-papiers indisponible)', 'info'); }
  }

  // #7 : raccourci global pour copier la courbe.
  // Ctrl+Maj+C (mnémonique) + secours Ctrl+E (Ctrl+Maj+C est happé par « Inspecter » sur Chrome).
  function onKey(e: KeyboardEvent) {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const k = e.key.toLowerCase();
    if ((e.shiftKey && k === 'c') || (!e.shiftKey && k === 'e')) {
      e.preventDefault();
      copyImg();
    }
  }

  const s = () => store.study.settings;
</script>

<svelte:window onclick={() => { showMenu = false; showExport = false; editingTitle = false; }} onkeydown={onKey} />

<div class="chart-wrap">
  <div class="toolbar">
    <div class="seg">
      <button class:active={s().chartMode === 'stacked'} onclick={() => store.updateSettings({ chartMode: 'stacked' })} title="Un panneau par paramètre, axe du temps commun">Panneaux</button>
      <button class:active={s().chartMode === 'single'} onclick={() => store.updateSettings({ chartMode: 'single' })} title="Un seul graphe, 2 axes Y">Graphe unique</button>
    </div>

    <div class="menu-wrap">
      <button class="menu-btn" onclick={(e) => { e.stopPropagation(); showMenu = !showMenu; }}>Affichage ▾</button>
      {#if showMenu}
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
        <div class="menu" onclick={(e) => e.stopPropagation()}>
          <label class="mitem"><input type="checkbox" checked={s().showReference} onchange={(e) => store.updateSettings({ showReference: e.currentTarget.checked })} /> Bandes de normale</label>
          <label class="mitem"><input type="checkbox" checked={s().showLegend} onchange={(e) => store.updateSettings({ showLegend: e.currentTarget.checked })} /> Légende</label>
          <label class="mitem"><input type="checkbox" checked={s().showValues} onchange={(e) => store.updateSettings({ showValues: e.currentTarget.checked })} /> Valeurs sur les points</label>
          <label class="mitem"><input type="checkbox" checked={s().markOutOfRange} onchange={(e) => store.updateSettings({ markOutOfRange: e.currentTarget.checked })} /> Marquer les valeurs hors-norme</label>
          <label class="mitem" title="Coché : les dates sont espacées proportionnellement au temps réel écoulé. Décoché : toutes les dates sont espacées régulièrement."><input type="checkbox" checked={s().timeAxis} onchange={(e) => store.updateSettings({ timeAxis: e.currentTarget.checked })} /> Espacer selon le temps réel</label>
          <div class="mdiv"></div>
          <div class="mperiod">
            <span class="mp-title">Période affichée</span>
            <label class="mp-row">Du <input type="date" value={s().fromDate ?? ''} onchange={(e) => store.updateSettings({ fromDate: e.currentTarget.value || null })} /></label>
            <label class="mp-row">Au <input type="date" value={s().toDate ?? ''} onchange={(e) => store.updateSettings({ toDate: e.currentTarget.value || null })} /></label>
            {#if s().fromDate || s().toDate}
              <button class="mp-reset" onclick={() => store.updateSettings({ fromDate: null, toDate: null })}>Tout afficher</button>
            {/if}
          </div>
        </div>
      {/if}
    </div>

    <!--
      Deux axes ne peuvent pas loger des ordres de grandeur trop éloignés : une
      hémoglobine tracée à côté d'une ferritine devient un trait plat. La courbe
      reste juste, mais on ne peut rien y lire — et rien ne le signalait. Plutôt
      que de laisser croire à un paramètre resté stable, on le dit, et un clic
      bascule vers le mode où chaque série retrouve son échelle.
    -->
    {#if result.ecrasees.length}
      <button class="ecrase-badge" onclick={() => store.updateSettings({ chartMode: 'stacked' })}
              title="Sur un seul graphe, ces paramètres sont écrasés au ras de leur axe : leurs variations y sont invisibles. Cliquer pour passer en panneaux, où chacun a sa propre échelle.">
        ⚠ {result.ecrasees.length === 1 ? `« ${result.ecrasees[0]} » est écrasé` : `${result.ecrasees.length} séries écrasées`} — voir en panneaux
      </button>
    {/if}

    {#if s().fromDate || s().toDate}
      <button class="period-badge" onclick={() => store.updateSettings({ fromDate: null, toDate: null })}
              title="Un filtre de période masque une partie des données. Cliquer pour tout réafficher.">
        📅 {s().fromDate ? formatDate(s().fromDate!) : '…'} → {s().toDate ? formatDate(s().toDate!) : '…'} <span class="pb-x">✕</span>
      </button>
    {/if}

    <div class="spacer"></div>
    <button class="primary copy-btn" onclick={copyImg} title="Copier la courbe pour la coller dans PowerPoint (Ctrl+Maj+C, ou Ctrl+E)">{copied ? '✓ Copié' : '⧉ Copier'}</button>
    <div class="menu-wrap split">
      <button class="primary export-main" onclick={() => exportPng(4)} title="Télécharger l'image PNG (haute résolution)">Exporter</button>
      <button class="primary export-caret" onclick={(e) => { e.stopPropagation(); showExport = !showExport; }} title="Autres formats">▾</button>
      {#if showExport}
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
        <div class="menu export-menu" onclick={(e) => e.stopPropagation()}>
          <button class="mitem" onclick={() => { showExport = false; exportPng(4); }}>Télécharger l'image (PNG)</button>
          <button class="mitem" onclick={() => { showExport = false; exportSvg(); }}>Télécharger en vectoriel (SVG)</button>
          <button class="mitem" onclick={() => { showExport = false; copyImg(); }}>{copied ? '✓ Copié' : 'Copier dans le presse-papiers'}</button>
          <button class="mitem" onclick={() => { showExport = false; setTimeout(() => window.print(), 60); }}>Imprimer / PDF (A4)</button>
        </div>
      {/if}
    </div>
  </div>

  <div class="canvas" bind:this={container}>
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
    <div class="svg-host" role="img" aria-label="Graphique" onmousemove={onMove} onmouseleave={() => (hover = null)} onclick={onChartClick}>
      {@html result.svg}
      <button class="title-hit" title="Cliquer pour modifier le titre" aria-label="Modifier le titre" onclick={(e) => { e.stopPropagation(); editingTitle = true; }}></button>

      {#if pointEdit}
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
        <div class="point-pop" style="left:{pointEdit.x}px; top:{pointEdit.y}px" onclick={(e) => e.stopPropagation()}>
          <div class="pp-head">{pointEdit.name} · {formatDate(pointEdit.date)}</div>
          <div class="pp-row">
            <!-- svelte-ignore a11y_autofocus -->
            <input class="pp-val" autofocus bind:value={pointVal} inputmode="decimal"
              onkeydown={(e) => { if (e.key === 'Enter') savePoint(); if (e.key === 'Escape') pointEdit = null; }} />
            <button class="pp-ok" onclick={savePoint}>OK</button>
          </div>
          <button class="pp-del" onclick={deletePoint}>Supprimer ce point</button>
        </div>
      {/if}
      {#if editingTitle}
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
        <div class="title-editor" onclick={(e) => e.stopPropagation()}>
          <input class="te-title" placeholder="Titre du graphique" value={s().title} oninput={(e) => store.updateSettings({ title: e.currentTarget.value })} />
          <input class="te-sub" placeholder="Sous-titre (optionnel)" value={s().subtitle} oninput={(e) => store.updateSettings({ subtitle: e.currentTarget.value })} />
          <button class="te-ok" onclick={() => (editingTitle = false)}>OK</button>
        </div>
      {/if}
    </div>
    {#if hover}
      <div class="tip" style="left:{hover.x}px; top:{hover.y}px">{hover.label}</div>
    {/if}
  </div>
</div>

<style>
  .chart-wrap { display: flex; flex-direction: column; height: 100%; min-width: 0; }
  .toolbar {
    display: flex; gap: 10px; align-items: center; flex-wrap: wrap;
    padding: 10px 16px; border-bottom: 1px solid var(--border); background: var(--panel);
  }
  .seg { display: inline-flex; background: #eef1f4; border-radius: 8px; padding: 2px; }
  .seg button { border: none; border-radius: 6px; padding: 5px 13px; background: transparent; font-size: 12.5px; color: var(--muted); }
  .seg button:hover { background: rgba(0,0,0,.04); }
  .seg button.active { background: #fff; color: var(--ink); font-weight: 600; box-shadow: 0 1px 2px rgba(0,0,0,.12); }

  .menu-wrap { position: relative; }
  .menu-btn { padding: 5px 12px; font-size: 12.5px; border-radius: 8px; }
  .menu {
    position: absolute; top: calc(100% + 6px); left: 0; z-index: 20;
    background: var(--panel); border: 1px solid var(--border); border-radius: 10px;
    box-shadow: 0 8px 24px rgba(20,30,40,.16); padding: 6px; min-width: 210px;
    display: flex; flex-direction: column; gap: 1px;
  }
  .mitem { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--ink); padding: 7px 9px; border-radius: 7px; cursor: pointer; }
  .mitem:hover { background: var(--panel-2); }
  button.mitem { border: none; background: transparent; width: 100%; text-align: left; }
  .export-menu { left: auto; right: 0; min-width: 240px; }
  .mdiv { height: 1px; background: var(--border); margin: 5px 2px; }
  .mperiod { display: flex; flex-direction: column; gap: 5px; padding: 4px 9px 6px; }
  .mp-title { font-size: 12px; color: var(--muted); font-weight: 600; }
  .mp-row { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--ink); }
  .mp-row input { flex: 1; font-size: 12.5px; padding: 4px 6px; }
  .mp-reset { align-self: flex-start; border: none; background: transparent; color: var(--accent); font-size: 12px; padding: 3px 2px; }
  .mp-reset:hover { text-decoration: underline; background: transparent; }
  .split { display: inline-flex; }
  .period-badge {
    display: inline-flex; align-items: center; gap: 6px;
    background: #fff4d6; color: #7a5b00; border: 1px solid #f0d98a;
    border-radius: 999px; padding: 4px 12px; font-size: 12px; font-weight: 600; white-space: nowrap;
  }
  .period-badge:hover { background: #f7e9b8; border-color: #e0c46a; }
  .pb-x { color: #a07b1a; font-weight: 700; }
  .period-badge:hover .pb-x { color: #7a5b00; }
  .ecrase-badge {
    display: inline-flex; align-items: center; gap: 6px;
    background: #fdeeea; color: #8a3423; border: 1px solid #f3c4b8;
    border-radius: 999px; padding: 4px 12px; font-size: 12px; font-weight: 600; white-space: nowrap;
  }
  .ecrase-badge:hover { background: #f9ded7; border-color: #e8a897; }
  .copy-btn { padding: 5px 14px; }
  .export-main { border-top-right-radius: 0; border-bottom-right-radius: 0; padding: 5px 14px; }
  .export-caret { border-top-left-radius: 0; border-bottom-left-radius: 0; padding: 5px 8px; margin-left: 1px; border-left: 1px solid rgba(255,255,255,.35); }

  .title-hit {
    position: absolute; top: 6px; left: 0; width: 62%; height: 46px;
    background: transparent; border: none; border-radius: 8px; cursor: text; padding: 0;
  }
  .title-hit:hover { background: rgba(47,116,208,.06); box-shadow: inset 0 0 0 1px rgba(47,116,208,.25); }
  .title-editor {
    position: absolute; top: 8px; left: 10px; z-index: 30;
    background: var(--panel); border: 1px solid var(--border); border-radius: 12px;
    box-shadow: 0 10px 30px rgba(16,24,32,.18); padding: 10px; display: flex; flex-direction: column; gap: 7px; width: min(360px, 80%);
  }
  .te-title { font-size: 15px; font-weight: 600; }
  .te-sub { font-size: 12.5px; }
  .te-ok { align-self: flex-end; }

  .toolbar button { padding: 5px 12px; font-size: 12.5px; border-radius: 8px; }
  .canvas { position: relative; flex: 1; overflow: auto; padding: 24px; background: var(--canvas-bg); display: flex; justify-content: center; align-items: flex-start; }
  .svg-host { position: relative; background: #fff; box-shadow: 0 6px 24px rgba(16,24,32,.10); border-radius: 12px; max-width: 100%; }
  .svg-host :global(svg) { display: block; max-width: 100%; height: auto; }
  .point-pop {
    position: absolute; transform: translate(-50%, calc(-100% - 12px)); z-index: 25;
    background: var(--panel); border: 1px solid var(--border); border-radius: 10px;
    box-shadow: 0 10px 28px rgba(16,24,32,.22); padding: 9px; width: 190px;
  }
  .pp-head { font-size: 12px; color: var(--muted); margin-bottom: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pp-row { display: flex; gap: 6px; }
  .pp-val { flex: 1; width: 100%; font-size: 14px; text-align: center; }
  .pp-ok { padding: 5px 12px; }
  .pp-del { margin-top: 7px; width: 100%; border: none; background: transparent; color: var(--danger); font-size: 12px; padding: 5px; border-radius: 7px; }
  .pp-del:hover { background: #fbecea; }

  .tip {
    position: absolute; transform: translate(-50%, -130%); pointer-events: none;
    background: #1b2733; color: #fff; padding: 4px 8px; border-radius: 6px;
    font-size: 12px; white-space: nowrap; box-shadow: 0 2px 8px rgba(0,0,0,.25); z-index: 5;
  }
</style>
