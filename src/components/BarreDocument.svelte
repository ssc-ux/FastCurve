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

  <button class="act topbtn" onclick={nouveau} title="Repartir d’un suivi vierge" aria-label="Nouveau suivi">
    <Icon name="file-plus" size={14} /><span class="txt">Nouveau</span>
  </button>
  <label class="act topbtn fichier" title="Ouvrir un fichier .fastcurve.json enregistré" aria-label="Ouvrir un fichier">
    <Icon name="upload" size={14} /><span class="txt">Ouvrir</span>
    <input type="file" accept=".json,application/json" onchange={ouvrirFichier} hidden />
  </label>
  <button class="act topbtn" onclick={enregistrerFichier} disabled={vide} title="Enregistrer ce suivi dans un fichier" aria-label="Enregistrer le fichier">
    <Icon name="save" size={14} /><span class="txt">Enregistrer</span>
  </button>
</div>

<style>
  /* `overflow: hidden` en secours : sans lui, si le nom du suivi est déjà
     réduit à rien et que la place manque encore, le texte des boutons
     « Nouveau / Ouvrir / Enregistrer » (en nowrap, donc non compressible)
     déborde silencieusement de sa propre case et se peint par-dessus le
     badge « ✓ Enregistré » à sa droite — repéré à 760px de large avec un
     suivi déjà enregistré. */
  .doc {
    display: flex; align-items: center; gap: 6px; min-width: 0; overflow: hidden;
    padding-left: 14px; margin-left: 2px; border-left: 1px solid var(--topbar-border);
  }
  .nom {
    display: inline-flex; align-items: center; gap: 7px; max-width: 260px;
    border: 1px solid transparent; background: transparent; border-radius: 6px;
    padding: 5px 9px; font-size: 13px; font-weight: 700; color: #fff;
  }
  .nom:hover { background: rgba(255,255,255,.08); border-color: var(--topbar-border); }
  .txt { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .renom {
    width: 240px; font-size: 13px; font-weight: 600; padding: 5px 9px;
    border-radius: 6px; border: 1px solid var(--accent); background: #fff; color: var(--ink);
  }
  /* Les trois actions (Nouveau/Ouvrir/Enregistrer) partagent le style
     `.topbtn` (global.css) : boutons sombres à bordure fine, comme dans la
     maquette « Console clinique dense ». `.act` n'ajoute plus qu'un
     comportement de mise en page. */
  .act {
    white-space: nowrap;
    /* Ne rétrécit jamais : c'est le nom du suivi (ellipsis ci-dessus) qui doit
       céder la place en premier, jamais ces trois actions. */
    flex-shrink: 0;
  }
  .fichier { display: inline-flex; align-items: center; flex-shrink: 0; }

  /* Téléphone : plus de place pour trois libellés + le nom du suivi + les
     boutons Annuler/Rétablir de la barre du haut. Les trois actions
     deviennent des boutons-icônes (icône + `title`/`aria-label` déjà posés
     plus haut, rien n'est perdu pour un lecteur d'écran) ; le nom du suivi
     s'efface pour leur laisser la place — il reste lisible dans l'écran
     Réglages et au clic sur l'icône dossier qui l'ouvre toujours pour le
     renommer. */
  @media (max-width: 640px) {
    .doc { gap: 4px; padding-left: 8px; }
    .act .txt { display: none; }
    .act { padding: 8px 10px; }
    .nom .txt { display: none; }
    .nom { padding: 8px; }
  }
</style>
