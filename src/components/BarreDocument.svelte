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
  let selecteur = $state<HTMLInputElement | undefined>();
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

  // Filet anti-perte : le navigateur peut effacer ses données (Safari au bout
  // de 7 jours sans visite, nettoyage manuel…). Seul le fichier .json est
  // durable. On mémorise l'empreinte du dernier fichier enregistré pour
  // signaler, sur le bouton, un suivi modifié depuis.
  const CLE_EMPREINTE = 'fastcurve.empreinte-fichier.v1';
  function empreinte(t: string): string {
    let h = 5381;
    for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0;
    return String(h);
  }
  function lireEmpreinte(): string {
    try { return localStorage.getItem(CLE_EMPREINTE) ?? ''; } catch { return ''; }
  }
  let empreinteFichier = $state(lireEmpreinte());
  const nonEnregistre = $derived(!vide && empreinte(store.exportJSON()) !== empreinteFichier);
  function memoriserEmpreinte() {
    empreinteFichier = empreinte(store.exportJSON());
    try { localStorage.setItem(CLE_EMPREINTE, empreinteFichier); } catch { /* ignore */ }
  }

  function enregistrerFichier() {
    downloadText(store.exportJSON(), nomFichier(), 'application/json');
    memoriserEmpreinte();
    uiBus.toast('Fichier enregistré. Rouvrez-le plus tard pour reprendre ce suivi.');
  }

  function ouvrirFichier(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    const lecteur = new FileReader();
    lecteur.onload = () => {
      const avant = store.exportJSON();
      if (store.importJSON(String(lecteur.result))) {
        memoriserEmpreinte();
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
  <button class="act topbtn fichier" onclick={() => selecteur?.click()} title="Ouvrir un fichier .fastcurve.json enregistré" aria-label="Ouvrir un fichier">
    <Icon name="upload" size={14} /><span class="txt">Ouvrir</span>
  </button>
  <input bind:this={selecteur} type="file" accept=".json,application/json" onchange={ouvrirFichier} hidden />
  <button class="act topbtn" class:a-enregistrer={nonEnregistre} onclick={enregistrerFichier} disabled={vide}
          title={nonEnregistre ? 'Modifications non enregistrées dans un fichier — le navigateur seul ne garantit pas leur conservation' : 'Enregistrer ce suivi dans un fichier'}
          aria-label={nonEnregistre ? 'Enregistrer le fichier (modifications non enregistrées)' : 'Enregistrer le fichier'}>
    <Icon name="save" size={14} /><span class="txt">Enregistrer</span>
  </button>
</div>

<style>
  /* Pastille : suivi modifié depuis le dernier fichier enregistré. */
  .a-enregistrer { position: relative; }
  .a-enregistrer::after {
    content: ''; position: absolute; top: 3px; right: 3px;
    width: 7px; height: 7px; border-radius: 50%; background: #d97706;
  }
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
    .doc { gap: 3px; padding-left: 6px; }
    /* Icône + libellé court dessous : des icônes seules (dossier, fichier+,
       flèche, disquette) laissaient deviner leur rôle. */
    .act, .nom { flex-direction: column; gap: 2px; padding: 4px 5px; font-size: 9.5px; line-height: 1.1; }
    .act .txt { display: block; overflow: visible; }
    .nom .txt { display: block; max-width: 52px; }
  }
</style>
