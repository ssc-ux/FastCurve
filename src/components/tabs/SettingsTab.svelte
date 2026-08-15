<script lang="ts">
  import { store } from '../../lib/models/store.svelte';
  import { downloadText } from '../../lib/chart/export';
  import { loadSample } from '../../lib/models/sample';
  import type { Template } from '../../lib/models/types';
  import { learnStats, resetLearning, exportLearning, importLearning } from '../../lib/learn/memory';
  import { uiBus } from '../../lib/models/ui.svelte';

  let learn = $state(learnStats());

  function exportLearn() {
    downloadText(exportLearning(), 'fastcurve-apprentissage.json', 'application/json');
  }
  function importLearn(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (importLearning(String(reader.result))) { learn = learnStats(); uiBus.toast('Apprentissage importé.'); }
      else uiBus.toast('Fichier invalide.', 'error');
    };
    reader.readAsText(f);
  }

  let templates = $state<Template[]>(store.listTemplates());
  let tplName = $state('');

  function refreshTemplates() { templates = store.listTemplates(); }
  function saveTemplate() {
    if (!tplName.trim() || store.study.parameters.length === 0) return;
    store.saveTemplate(tplName.trim());
    tplName = '';
    refreshTemplates();
  }
  function applyTemplate(id: string) { store.applyTemplate(id); }
  function deleteTemplate(id: string) { store.deleteTemplate(id); refreshTemplates(); }

  function exportFile() {
    const name = (store.study.patientLabel || 'fastcurve').replace(/[^\w\-À-ÿ]/g, '_');
    downloadText(store.exportJSON(), `${name}.fastcurve.json`, 'application/json');
  }

  function importFile(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (store.importJSON(String(reader.result))) uiBus.toast('Fichier ouvert : il remplace le suivi en cours.');
      else uiBus.toast('Fichier invalide.', 'error');
    };
    reader.readAsText(f);
  }

  const s = () => store.study.settings;
</script>

<div class="col" style="gap:14px;">
  <div class="card" style="padding:12px;">
    <div class="row" style="margin-bottom:8px;"><strong>Titre & légende du graphique</strong></div>
    <div class="col" style="gap:8px;">
      <label class="col" style="gap:3px;">Titre
        <input value={s().title} onchange={(e) => store.updateSettings({ title: e.currentTarget.value })} />
      </label>
      <label class="col" style="gap:3px;">Sous-titre
        <input value={s().subtitle} onchange={(e) => store.updateSettings({ subtitle: e.currentTarget.value })} placeholder="ex. Patient anonymisé, contexte clinique…" />
      </label>
      <label class="col" style="gap:3px;">Nom du suivi (sert au nom de fichier, non affiché sur le graphe)
        <input value={store.study.patientLabel} onchange={(e) => store.setPatientLabel(e.currentTarget.value)} placeholder="ex. Cas n°12" />
      </label>
    </div>
  </div>

  <div class="card" style="padding:12px;">
    <div class="row" style="margin-bottom:8px;"><strong>Modèles de suivi</strong></div>
    <p class="faint small" style="margin-bottom:8px;">Enregistrez un jeu de paramètres (ex. « suivi vascularite ») pour le recharger en un clic sur un nouveau suivi.</p>
    <div class="row wrap" style="margin-bottom:8px;">
      <input class="grow" placeholder="Nom du modèle" bind:value={tplName} onkeydown={(e) => e.key === 'Enter' && saveTemplate()} />
      <button onclick={saveTemplate} disabled={!store.study.parameters.length}>Enregistrer le suivi actuel</button>
    </div>
    {#if templates.length}
      <div class="col" style="gap:5px;">
        {#each templates as t (t.id)}
          <div class="row" style="gap:6px;">
            <span class="grow small"><strong>{t.name}</strong> <span class="faint">· {t.parameters.length} paramètre{t.parameters.length > 1 ? 's' : ''}</span></span>
            <button class="small" onclick={() => applyTemplate(t.id)}>Appliquer</button>
            <button class="danger small" onclick={() => deleteTemplate(t.id)} title="Supprimer ce modèle" aria-label="Supprimer le modèle « {t.name} »">✕</button>
          </div>
        {/each}
      </div>
    {:else}
      <p class="faint small">Aucun modèle enregistré.</p>
    {/if}
  </div>

  <div class="card" style="padding:12px;">
    <div class="row" style="margin-bottom:8px;"><strong>Apprentissage</strong></div>
    <p class="faint small" style="margin-bottom:8px;">
      À chaque import, quand vous corrigez un nom lu (analyte) ou confirmez un médicament, l'outil le <strong>retient</strong> sur ce poste et le réapplique la prochaine fois. Un <strong>dictionnaire intégré</strong> à l'app est déjà partagé par tous les postes. 100% local, aucune donnée patient.
    </p>
    <div class="row wrap" style="margin-bottom:8px;">
      <span class="badge">{learn.builtinDrugs + learn.drugs} médicaments reconnus</span>
      <span class="badge">{learn.analytes} correction{learn.analytes > 1 ? 's' : ''} d'analyte (ce poste)</span>
    </div>
    <p class="faint small" style="margin-bottom:8px;">Pour faire profiter <strong>tous les postes</strong> de ce que ce poste a appris : exportez, et transmettez le fichier pour l'intégrer au dictionnaire de l'app.</p>
    <div class="row wrap">
      <button onclick={exportLearn}>⬇ Exporter l'apprentissage</button>
      <label class="filebtn-wrap"><span>⬆ Importer un apprentissage</span><input type="file" accept=".json,application/json" onchange={importLearn} hidden /></label>
      <div class="spacer"></div>
      <button class="danger small" title="N'efface aucun patient : oublie seulement les corrections de lecture apprises sur ce poste."
        onclick={() => { const snap = exportLearning(); resetLearning(); learn = learnStats(); uiBus.toastAction('Apprentissage de ce poste réinitialisé.', 'Annuler', () => { importLearning(snap); learn = learnStats(); }); }}>Réinitialiser (ce poste)</button>
    </div>
  </div>

  <div class="card" style="padding:12px;">
    <div class="row" style="margin-bottom:8px;"><strong>Sauvegarde</strong></div>
    <p class="faint small" style="margin-bottom:8px;">Votre suivi est enregistré automatiquement dans ce navigateur : vous le retrouvez à la réouverture. Pour le garder durablement ou le reprendre sur un autre poste, enregistrez un fichier.</p>
    <div class="row wrap">
      <button onclick={exportFile}>⬇ Enregistrer le fichier (.json)</button>
      <label class="filebtn-wrap"><span>⬆ Ouvrir un fichier</span><input type="file" accept=".json,application/json" onchange={importFile} hidden /></label>
    </div>
  </div>

  <div class="card" style="padding:12px;">
    <div class="row" style="margin-bottom:8px;"><strong>Confidentialité</strong></div>
    <p class="faint small" style="margin-bottom:8px; line-height:1.5;">
      🔒 Tout reste dans <strong>ce navigateur</strong> : aucune donnée patient n'est envoyée. Avant de partager un graphique, vérifiez qu'aucun <strong>identifiant patient</strong> n'apparaît (nom, date de naissance, IPP). Utilisez le sous-titre pour un libellé anonymisé (« Cas n°12 »).
    </p>
    <label class="row" style="gap:8px; cursor:pointer;">
      <input type="checkbox" checked={store.clearOnExit} onchange={(e) => store.setClearOnExit(e.currentTarget.checked)} />
      <span class="small">Effacer le suivi à la fermeture de l'onglet <span class="faint">(un simple rechargement F5 ne l'efface pas. La purge s'exécute à la prochaine ouverture — d'ici là, les données restent dans ce navigateur. Poste partagé : enregistrez le fichier avant !)</span></span>
    </label>
  </div>

  <div class="card" style="padding:12px;">
    <div class="row" style="margin-bottom:8px;"><strong>Démarrage rapide</strong></div>
    <div class="row wrap">
      <button onclick={() => loadSample()}>Charger un exemple</button>
      <button class="danger" title="Vide les valeurs, dates et traitements ; garde les paramètres (analytes) et le titre du graphique."
        onclick={() => { store.clearData(); uiBus.toastAction('Données effacées (mesures et traitements).', 'Annuler', () => store.undo()); }}>Effacer les données</button>
      <button class="danger" title="Repart d'un suivi entièrement vierge : paramètres, titre et traitements compris — comme au tout premier lancement."
        onclick={() => { store.clearAll(); uiBus.toastAction('Dossier réinitialisé.', 'Annuler', () => store.undo()); }}>Tout réinitialiser</button>
    </div>
  </div>

  <div class="card" style="padding:12px;">
    <div class="row" style="margin-bottom:8px;"><strong>À propos</strong></div>
    <p class="small" style="margin-bottom:8px; line-height:1.5;">
      <strong>FastCurve</strong> — version bêta. Créé par <strong>Quentin Astouati</strong>.<br/>
      🔒 100% local : aucune donnée envoyée, aucun cloud, aucune IA en ligne.
    </p>
    <button onclick={() => (uiBus.welcomeOpen = true)}>Revoir la présentation</button>
  </div>

  <p class="faint small">FastCurve · 100% local, aucune donnée envoyée sur un serveur.</p>
</div>

<style>
  .filebtn-wrap { display: inline-flex; }
  .filebtn-wrap span {
    display: inline-block; border: 1px solid var(--border-strong); background: var(--panel);
    border-radius: 6px; padding: 6px 12px; cursor: pointer;
  }
  .filebtn-wrap:hover span { border-color: var(--accent); }
</style>
