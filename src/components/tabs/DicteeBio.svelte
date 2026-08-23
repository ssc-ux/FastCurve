<script lang="ts">
  // ──────────────────────────────────────────────────────────────
  // DICTÉE VOCALE (Dragon, ou tout logiciel qui tape au clavier) — un champ
  // de texte libre, analysé à CHAQUE frappe : pas de bouton « Analyser ».
  //
  // Aucun micro, aucune reconnaissance vocale embarquée : Dragon tape dans ce
  // champ exactement comme un clavier (intégration système, hors du
  // navigateur). Ce composant ne lit que du TEXTE, jamais de l'audio —
  // 100% local, comme partout ailleurs dans l'application.
  //
  // Le texte reste l'unique source de vérité : le corriger (à la souris, au
  // clavier, ou en redictant) recalcule le tableau ci-dessous à l'identique.
  // ──────────────────────────────────────────────────────────────
  import { store } from '../../lib/models/store.svelte';
  import { parseDicteeBio } from '../../lib/text/dicteeBio';
  import { todayISO, formatDate, parseDateSouple } from '../../lib/models/types';
  import { uiBus } from '../../lib/models/ui.svelte';

  let { onImported = () => {} }: { onImported?: () => void } = $props();

  let texte = $state('');
  let date = $state(todayISO());
  let champTexte = $state<HTMLTextAreaElement>();

  // L'attribut HTML `autofocus` seul est peu fiable une fois l'écran ouvert
  // après un clic (le focus reste souvent sur le bouton cliqué) : sans ce
  // focus explicite, ni Dragon ni la dictée système de l'OS n'ont de champ où
  // écrire, et rien ne semble se passer quand le médecin dicte.
  $effect(() => { champTexte?.focus(); });

  // Ré-analysé à chaque changement de `texte` — c'est tout le mécanisme du
  // « ça se remplit en direct » : aucune action du médecin ne le déclenche.
  const resultat = $derived(parseDicteeBio(texte));

  interface Ligne {
    id: string;
    nom: string;
    unite: string;
    valeurTexte: string;
    valeur: number | null;
    complet: boolean;
    connu: boolean;
    include: boolean;
    /** Date ISO effectivement utilisée pour cette ligne : dictée localement,
     * corrigée à la main, ou — le cas par défaut — la date globale ci-dessus. */
    date: string;
    /** Vrai quand `date` vient d'une date dictée avec la valeur (« le 28/06/2026 »),
     * pour l'indiquer discrètement sans imposer de geste supplémentaire. */
    dateDictee: boolean;
  }

  // Cases décochées mémorisées par clé stable (nom du catalogue, ou texte brut
  // pour un analyte inconnu) : sans cela, décocher une ligne pendant que la
  // dictée continue la recocherait à chaque frappe suivante.
  let exclus = $state<Set<string>>(new Set());

  // Corrections manuelles de date par ligne (même clé stable que `exclus`) :
  // le médecin peut retoucher une date mal comprise sans que la dictée qui
  // continue ne l'écrase à la frappe suivante — même logique que `exclus`.
  let datesManuelles = $state<Map<string, string>>(new Map());

  const lignes = $derived.by((): Ligne[] => {
    const out: Ligne[] = [];
    for (const it of resultat.reconnus) {
      const id = 'c:' + (it.catalogue?.name ?? it.nom);
      const manuelle = datesManuelles.get(id);
      out.push({
        id, nom: it.nom, unite: it.catalogue?.unit ?? '',
        valeurTexte: it.valeurTexte, valeur: it.valeur, complet: it.complet,
        connu: true, include: !exclus.has(id),
        date: manuelle ?? it.date ?? date,
        dateDictee: manuelle == null && it.date != null,
      });
    }
    for (const it of resultat.inconnus) {
      const id = 'i:' + it.nom.toLowerCase();
      const manuelle = datesManuelles.get(id);
      out.push({
        id, nom: it.nom, unite: '',
        valeurTexte: it.valeurTexte, valeur: it.valeur, complet: it.complet,
        connu: false, include: !exclus.has(id),
        date: manuelle ?? it.date ?? date,
        dateDictee: manuelle == null && it.date != null,
      });
    }
    return out;
  });

  function toggle(id: string) {
    const s = new Set(exclus);
    if (s.has(id)) s.delete(id); else s.add(id);
    exclus = s;
  }

  const pretes = $derived(lignes.filter(l => l.include && l.valeur !== null));
  const nbEnCours = $derived(lignes.filter(l => !l.complet).length);

  function commit() {
    if (pretes.some(l => !l.date)) { uiBus.toast('Renseignez la date avant d’ajouter.', 'error'); return; }
    let added = 0;
    for (const l of pretes) {
      const param = store.resolveParameter(l.nom.trim(), l.unite);
      store.setMeasurement(param.id, l.date, l.valeur);
      added++;
    }
    texte = '';
    exclus = new Set();
    datesManuelles = new Map();
    uiBus.toast(`${added} valeur(s) ajoutée(s) au graphique.`);
    onImported();
  }

  function majDate(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const brut = input.value.trim();
    if (!brut) { input.value = date ? formatDate(date) : ''; return; }
    const iso = parseDateSouple(brut);
    if (iso) { date = iso; input.value = formatDate(iso); }
    else { uiBus.toast(`Date « ${brut} » non comprise : tapez par exemple 12/03/2024.`, 'error'); input.value = formatDate(date); }
  }

  // Correction manuelle de la date d'UNE ligne (dictée mal comprise, ou pour
  // écarter la date globale sur ce résultat précis).
  function majDateLigne(id: string, actuelle: string, e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const brut = input.value.trim();
    if (!brut) { input.value = formatDate(actuelle); return; }
    const iso = parseDateSouple(brut);
    if (iso) {
      const m = new Map(datesManuelles);
      m.set(id, iso);
      datesManuelles = m;
      input.value = formatDate(iso);
    } else {
      uiBus.toast(`Date « ${brut} » non comprise : tapez par exemple 12/03/2024.`, 'error');
      input.value = formatDate(actuelle);
    }
  }
</script>

<div class="card" style="padding:12px;">
  <div class="row wrap" style="margin-bottom:8px;">
    <strong>Dicter les résultats</strong>
    <span class="faint small">— parlez ou tapez, le tableau se remplit tout seul.</span>
    <div class="spacer"></div>
    <span class="local small">🔒 100% local — rien n'est envoyé</span>
  </div>

  <p class="faint small" style="margin-bottom:6px;">
    Activez Dragon (ou tout logiciel de dictée) sur ce champ, ou tapez directement.
    Exemple : « CRP 45 créatinine 90 hémoglobine 12,3 ». Par défaut, tout va à la date ci-dessous.
    Pour dicter plusieurs dates dans la même série, faites suivre chaque valeur de sa date
    (« CPK 28 le 28/06/2026, CRP 45 le 15/05/2020 ») : la date propre à chaque ligne apparaît
    dans le tableau, et reste modifiable à la main.
  </p>

  <div class="row" style="margin-bottom:8px; gap:10px;">
    <label class="dlabel" for="dictee-date">Date des résultats</label>
    <input id="dictee-date" class="dinp" type="text" inputmode="numeric" placeholder="JJ/MM/AAAA"
           value={formatDate(date)} onblur={majDate}
           onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.currentTarget as HTMLInputElement).blur(); } }} />
  </div>

  <textarea bind:this={champTexte} class="dictzone" bind:value={texte} placeholder="Dictez ou tapez ici les résultats…" spellcheck="false"></textarea>

  {#if lignes.length}
    <div style="margin-top:10px; overflow-x:auto;">
      <table class="grid vgrid dtable">
        <thead>
          <tr><th></th><th style="text-align:left;">Analyte</th><th>Valeur</th><th>Date</th><th></th></tr>
        </thead>
        <tbody>
          {#each lignes as l (l.id)}
            <tr class:excluded={!l.include} class:pending={!l.complet}>
              <td><input type="checkbox" checked={l.include} onchange={() => toggle(l.id)} /></td>
              <td class="name">
                {l.nom}
                {#if !l.connu}<span class="badge new" title="Absent du catalogue : sera créé comme paramètre libre.">+ nouveau</span>{/if}
              </td>
              <td class="val">
                {#if l.valeur === null}
                  <span class="faint">—</span>
                {:else}
                  {l.valeurTexte}{#if l.unite} <span class="faint">{l.unite}</span>{/if}
                {/if}
              </td>
              <td class="date">
                <input class="dinp2" type="text" inputmode="numeric" placeholder="JJ/MM/AAAA"
                       value={formatDate(l.date)}
                       title={l.dateDictee ? 'Date dictée avec cette valeur — modifiable.' : 'Date du champ « Date des résultats » ci-dessus — modifiable pour cette ligne seule.'}
                       class:dictee={l.dateDictee}
                       onblur={(e) => majDateLigne(l.id, l.date, e)}
                       onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.currentTarget as HTMLInputElement).blur(); } }} />
              </td>
              <td class="flag">{#if !l.complet}<span class="badge pending" title="En train de se dicter : pas encore définitif.">…</span>{/if}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <div class="row" style="margin-top:10px;">
      <span class="faint small">
        {pretes.length} valeur(s) prête(s)
        {#if nbEnCours}· <span class="pastille"></span> {nbEnCours} en cours de dictée{/if}
      </span>
      <div class="spacer"></div>
      <button onclick={() => { texte = ''; exclus = new Set(); datesManuelles = new Map(); }}>Effacer</button>
      <button class="primary" disabled={!pretes.length} onclick={commit}>Ajouter au graphique</button>
    </div>
  {/if}
</div>

<style>
  .dictzone {
    width: 100%; min-height: 110px; resize: vertical; font-size: 15px; line-height: 1.6;
  }
  .dlabel { font-size: 13px; color: var(--muted); }
  .dinp { width: 128px; }
  .local { color: var(--ok, #14683e); font-weight: 600; font-size: 13px; }
  .local.small { font-size: 12px; }

  .dtable td, .dtable th { padding: 5px 8px; }
  .dtable td.name { text-align: left; }
  .dtable td.val { white-space: nowrap; font-variant-numeric: tabular-nums; }
  .dtable td.date { white-space: nowrap; }
  .dtable td.flag { width: 20px; }
  .dinp2 {
    width: 108px; font-size: 13px; padding: 2px 6px;
  }
  /* Une date dictée avec la valeur (plutôt que reprise du champ global) se
     distingue discrètement, sans badge ni texte supplémentaire. */
  .dinp2.dictee { border-color: var(--accent, #2f6feb); }
  .dtable tr.excluded { opacity: .45; }
  /* Une ligne « en cours » n'est pas une erreur : elle dit juste « ce mot est
     encore en train de se dicter, sa valeur peut encore changer ». */
  .dtable tr.pending { opacity: .6; }
  .dtable tr.pending td.val { font-style: italic; }

  .badge { display: inline-block; font-size: 11px; padding: 1px 6px; border-radius: 8px; margin-left: 6px; vertical-align: 1px; }
  .badge.new { background: var(--accent-soft); color: var(--accent); }
  .badge.pending { background: var(--panel-2); color: var(--muted); border: 1px solid var(--border); }
  .pastille { display: inline-block; width: 10px; height: 10px; border-radius: 3px; background: var(--panel-2); border: 1px solid var(--border-strong); vertical-align: -1px; margin-right: 2px; }
</style>
