<script lang="ts">
  // Prise de vue guidée d'un tableau de résultats affiché sur un écran.
  // Un cadre suit le tableau repéré en direct et change de couleur ; quand
  // l'image est bonne et stable, une rafale part toute seule et la plus
  // nette est retenue. Rien ne quitte le téléphone.
  import { onDestroy, onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import {
    analyserImage, analyserParDetection, fermerCamera, ouvrirCamera, doubleLecture, rafale, redresserPhoto, viserPourMiseAuPoint, type Analyse,
  } from '../lib/photo/camera';
  import { chargerPaddle } from '../lib/photo/paddle';

  let { onPhoto, onClose, partie = 1 }: {
    onPhoto: (photo: HTMLCanvasElement, seconde?: HTMLCanvasElement) => void;
    onClose: () => void;
    /** Numéro de la partie d'un long tableau pris en plusieurs photos. */
    partie?: number;
  } = $props();

  let video = $state<HTMLVideoElement | undefined>();
  let flux: MediaStream | null = null;
  let erreur = $state('');
  let analyse = $state<Analyse | null>(null);
  let capture = $state(false);
  let stables = 0;
  let meilleureNettete = 0;
  let minuteur: ReturnType<typeof setTimeout> | undefined;
  let fini = false;
  let dernierPointFocus = 0;
  let moteurPret = false;

  // Rectangle réellement occupé par l'image dans la balise vidéo
  // (object-fit: contain), pour poser le cadre au bon endroit.
  let zone = $state({ x: 0, y: 0, w: 0, h: 0 });
  function mesurerZone() {
    if (!video || !video.videoWidth) return;
    const r = video.getBoundingClientRect();
    const ratio = Math.min(r.width / video.videoWidth, r.height / video.videoHeight);
    const w = video.videoWidth * ratio, h = video.videoHeight * ratio;
    zone = { x: (r.width - w) / 2, y: (r.height - h) / 2, w, h };
  }

  const couleur = $derived(
    !analyse || analyse.verdict.etat === 'aucun' ? '#e5484d'
      : analyse.verdict.etat === 'ok' ? '#30a46c' : '#f5a524',
  );

  async function boucle() {
    if (fini || capture || !video || !video.videoWidth) { planifier(); return; }
    try {
      // Repérage par le détecteur de texte ; repli sur l'analyse d'encre si
      // le moteur photo n'a pas pu se charger.
      const a = moteurPret
        ? await analyserParDetection(video, meilleureNettete).catch(() => { moteurPret = false; return analyserImage(video!, meilleureNettete); })
        : analyserImage(video, meilleureNettete);
      // Maximum de netteté récent, qui s'érode lentement (la scène change).
      meilleureNettete = Math.max(a.netteteBrute, meilleureNettete * 0.97);
      analyse = a;
      mesurerZone();
      if (a.boiteRelative && Date.now() - dernierPointFocus > 1500) {
        dernierPointFocus = Date.now();
        const b = a.boiteRelative;
        viserPourMiseAuPoint(flux, (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
      }
      stables = a.verdict.etat === 'ok' ? stables + 1 : 0;
      if (stables >= 3) { await declencher(); return; }
    } catch { /* image indisponible un instant : on réessaie */ }
    planifier();
  }
  function planifier() { if (!fini) minuteur = setTimeout(boucle, 220); }

  async function declencher() {
    if (!video || capture) return;
    capture = true;
    try {
      const a = analyse;
      const [photo, seconde] = await rafale(video, a?.boiteRelative ?? null);
      const angle = a?.mesure.angle ?? 0;
      const prete = redresserPhoto(photo, angle);
      terminer();
      // Double lecture : la deuxième image la plus nette est lue aussi.
      onPhoto(prete, doubleLecture() && seconde ? redresserPhoto(seconde, angle) : undefined);
    } catch (e: any) {
      erreur = 'La photo a échoué : ' + (e?.message || e);
      capture = false; stables = 0; planifier();
    }
  }

  function terminer() {
    fini = true;
    clearTimeout(minuteur);
    fermerCamera(flux);
    flux = null;
  }

  function fermer() { terminer(); onClose(); }

  onMount(async () => {
    // Le moteur photo se charge pendant que le médecin vise.
    chargerPaddle().then(() => { moteurPret = true; }, () => {});
    try {
      flux = await ouvrirCamera(video!);
      mesurerZone();
      planifier();
    } catch (e: any) {
      erreur = e?.name === 'NotAllowedError'
        ? 'L’accès à la caméra a été refusé. Autorisez-le dans les réglages du navigateur, ou choisissez une photo existante.'
        : 'Caméra indisponible sur cet appareil. Choisissez une photo existante.';
    }
  });
  onDestroy(terminer);
</script>

<svelte:window onresize={mesurerZone} onkeydown={(e) => e.key === 'Escape' && fermer()} />

<div class="cam" role="dialog" aria-modal="true" aria-label="Photo guidée du tableau">
  <!-- svelte-ignore a11y_media_has_caption -->
  <video bind:this={video} playsinline muted></video>

  {#if analyse?.boiteRelative && zone.w}
    {@const b = analyse.boiteRelative}
    <div class="cadre" style="left:{zone.x + b.x0 * zone.w}px; top:{zone.y + b.y0 * zone.h}px; width:{(b.x1 - b.x0) * zone.w}px; height:{(b.y1 - b.y0) * zone.h}px; border-color:{couleur};"></div>
  {/if}

  <div class="haut">
    <button class="rond" onclick={fermer} aria-label="Fermer la caméra">✕</button>
    {#if partie > 1}<span class="partie">Partie {partie} du tableau</span>{/if}
  </div>

  <div class="bas">
    {#if erreur}
      <p class="consigne erreur">{erreur}</p>
    {:else}
      <p class="consigne" style="background:{couleur};" aria-live="polite">
        {capture ? 'Photo en cours…' : analyse?.verdict.message ?? 'Ouverture de la caméra…'}
      </p>
      <button class="declencheur" onclick={declencher} disabled={capture || !analyse} aria-label="Prendre la photo maintenant">
        <Icon name="camera" size={26} />
      </button>
      <p class="aide">Déclenchement automatique quand le cadre est vert. Astuce : zoomez dans Sillage pour grossir les chiffres.</p>
    {/if}
  </div>
</div>

<style>
  .cam { position: fixed; inset: 0; z-index: 1200; background: #000; display: flex; flex-direction: column; }
  video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
  .cadre { position: absolute; border: 3px solid; border-radius: 6px; box-shadow: 0 0 0 9999px rgba(0,0,0,.28); transition: all .18s ease; pointer-events: none; }
  .haut { position: absolute; top: 0; left: 0; right: 0; display: flex; align-items: center; gap: 10px; padding: calc(10px + env(safe-area-inset-top, 0)) 12px 10px; }
  .partie { color: #fff; font-weight: 600; font-size: 14px; text-shadow: 0 1px 2px rgba(0,0,0,.6); }
  .rond { width: 44px; height: 44px; border-radius: 50%; border: none; background: rgba(0,0,0,.55); color: #fff; font-size: 18px; }
  .bas { position: absolute; left: 0; right: 0; bottom: 0; display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 12px 16px calc(18px + env(safe-area-inset-bottom, 0)); background: linear-gradient(transparent, rgba(0,0,0,.65)); }
  .consigne { margin: 0; color: #fff; font-weight: 700; font-size: 15px; padding: 8px 14px; border-radius: 999px; text-align: center; }
  .consigne.erreur { background: #e5484d; font-weight: 600; border-radius: 12px; }
  .declencheur { width: 72px; height: 72px; border-radius: 50%; border: 4px solid #fff; background: rgba(255,255,255,.2); color: #fff; display: flex; align-items: center; justify-content: center; }
  .declencheur:disabled { opacity: .5; }
  .aide { margin: 0; color: #e8eef7; font-size: 12px; text-align: center; max-width: 340px; }
</style>
