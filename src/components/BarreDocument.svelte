<script lang="ts">
  // Modèle « un document » : on nomme son travail, on repart de zéro, on ouvre
  // ou on enregistre un fichier. Le navigateur conserve le document courant
  // d'une session à l'autre ; le fichier .json sert à le garder ou à le
  // reprendre sur un autre poste.
  import { store, nomEtude } from '../lib/models/store.svelte';
  import { uiBus } from '../lib/models/ui.svelte';
  import { downloadText } from '../lib/chart/export';
  import Icon from './Icon.svelte';

  let renommage = $state(false);
  let saisie = $state('');

  const nom = $derived(nomEtude(store.study));
  const vide = $derived(
    store.study.parameters.length === 0 &&
    store.study.treatments.length === 0 &&
    store.study.annotations.length === 0,
  );

  function ouvrirRenommage() {
    saisie = store.study.patientLabel || '';
    renommage = true;
  }
  function validerRenommage() {
    store.setPatientLabel(saisie.trim());
    renommage = false;
  }
  function focusAuto(node: HTMLInputElement) { node.focus(); node.select(); }

  function nomFichier(): string {
    const base = nom.replace(/[^\w\-À-ÿ ]/g, '').trim().replace(/\s+/g, '_') || 'FastCurve';
    return `${base}.fastcurve.json`;
  }

  function enregistrerFichier() {
    downloadText(store.exportJSON(), nomFichier(), 'application/json');
    uiBus.toast('Fichier enregistré. Rouvrez-le plus tard pour reprendre ce suivi.');
  }

  function ouvrirFichier(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    const lecteur = new FileReader();
    lecteur.onload = () => {
      const avant = store.exportJSON();
      if (store.importJSON(String(lecteur.result))) {
        uiBus.toastAction('Fichier ouvert.', 'Revenir', () => store.importJSON(avant));
      } else {
        uiBus.toast("Ce fichier n'est pas un suivi FastCurve.", 'error');
      }
    };
    lecteur.readAsText(f);
    (e.target as HTMLInputElement).value = '';
  }

  function nouveau() {
    if (vide) { store.nouvelleEtude(); return; }
    const avant = store.exportJSON();
    store.nouvelleEtude();
    uiBus.toastAction('Nouveau suivi. L’ancien n’est plus dans le navigateur.', 'Revenir', () => store.importJSON(avant));
  }
</script>

<div class="doc">
  {#if renommage}
    <input class="renom" bind:value={saisie} use:focusAuto placeholder="Nom du suivi"
           onkeydown={(e) => { if (e.key === 'Enter') validerRenommage(); if (e.key === 'Escape') renommage = false; }}
           onblur={validerRenommage} />
  {:else}
    <button class="nom" onclick={ouvrirRenommage} title="Cliquer pour renommer ce suivi">
      <Icon name="folder-open" size={15} />
      <span class="txt">{nom}</span>
    </button>
  {/if}

  <button class="act" onclick={nouveau} title="Repartir d’un suivi vierge">Nouveau</button>
  <label class="act fichier" title="Ouvrir un fichier .fastcurve.json enregistré">
    Ouvrir<input type="file" accept=".json,application/json" onchange={ouvrirFichier} hidden />
  </label>
  <button class="act" onclick={enregistrerFichier} disabled={vide} title="Enregistrer ce suivi dans un fichier">Enregistrer</button>
</div>

<style>
  .doc { display: flex; align-items: center; gap: 4px; min-width: 0; }
  .nom {
    display: inline-flex; align-items: center; gap: 7px; max-width: 260px;
    border: 1px solid transparent; background: transparent; border-radius: 9px;
    padding: 5px 10px; font-size: 13px; font-weight: 600; color: var(--ink);
  }
  .nom:hover { background: var(--panel-2); border-color: var(--border); }
  .txt { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .renom {
    width: 240px; font-size: 13px; font-weight: 600; padding: 5px 9px;
    border-radius: 9px; border: 1px solid var(--accent);
  }
  .act {
    border: none; background: transparent; color: var(--muted);
    font-size: 12.5px; padding: 5px 10px; border-radius: 8px; white-space: nowrap; cursor: pointer;
  }
  .act:hover:not(:disabled) { background: var(--panel-2); color: var(--ink); }
  .act:disabled { opacity: .45; cursor: default; }
  .fichier { display: inline-flex; align-items: center; }
</style>
