// ──────────────────────────────────────────────────────────────
// Caméra : analyse en direct, rafale, préparation de la photo retenue.
// Tout se passe dans le navigateur ; aucune image ne quitte l'appareil.
// ──────────────────────────────────────────────────────────────

import { carteEncreLocale, grisCanalMin } from '../ocr/preparation';
import {
  estimerInclinaison, nettete, trouverTableau, verdictCadrage,
  type BoiteTableau, type MesureCadrage, type Verdict,
} from './cadrage';

/** Largeur de l'image réduite analysée en direct (compromis vitesse/finesse). */
const LARGEUR_ANALYSE = 720;

/** Ouvre la caméra arrière, en haute définition, mise au point continue si possible. */
export async function ouvrirCamera(video: HTMLVideoElement): Promise<MediaStream> {
  const flux = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } },
  });
  video.srcObject = flux;
  video.setAttribute('playsinline', '');
  video.muted = true;
  await video.play();
  const piste = flux.getVideoTracks()[0];
  try {
    const caps = (piste.getCapabilities?.() ?? {}) as any;
    if (Array.isArray(caps.focusMode) && caps.focusMode.includes('continuous')) {
      await piste.applyConstraints({ advanced: [{ focusMode: 'continuous' } as any] });
    }
  } catch { /* mise au point automatique du système */ }
  return flux;
}

export function fermerCamera(flux: MediaStream | null) {
  flux?.getTracks().forEach(t => t.stop());
}

/**
 * Mise au point sur le tableau : point d'intérêt au centre de la zone repérée
 * (coordonnées relatives 0..1). Pris en charge par une partie des téléphones
 * Android ; ignoré ailleurs sans erreur.
 */
export async function viserPourMiseAuPoint(flux: MediaStream | null, x: number, y: number) {
  const piste = flux?.getVideoTracks()[0];
  if (!piste) return;
  try {
    const caps = (piste.getCapabilities?.() ?? {}) as any;
    if ('pointsOfInterest' in caps || 'focusMode' in caps) {
      await piste.applyConstraints({ advanced: [{ pointsOfInterest: [{ x, y }] } as any] });
    }
  } catch { /* non pris en charge */ }
}

function copieRedressee(source: CanvasImageSource, sw: number, sh: number, largeur: number, angleDeg: number): HTMLCanvasElement {
  const echelle = largeur / sw;
  const c = document.createElement('canvas');
  c.width = Math.round(sw * echelle);
  c.height = Math.round(sh * echelle);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.translate(c.width / 2, c.height / 2);
  // Angle positif = texte qui monte vers la droite : on tourne dans le sens
  // horaire (sens positif du canvas, axe y vers le bas) pour le remettre à plat.
  ctx.rotate((angleDeg * Math.PI) / 180);
  ctx.drawImage(source, -c.width / 2, -c.height / 2, c.width, c.height);
  return c;
}

export interface Analyse {
  mesure: MesureCadrage;
  verdict: Verdict;
  /** Boîte du tableau en coordonnées relatives (0..1) de l'image redressée. */
  boiteRelative: BoiteTableau | null;
  /** Netteté brute, pour suivre le maximum récent. */
  netteteBrute: number;
}

/** Analyse une image du flux vidéo. `meilleureNettete` : max récent, pour la netteté relative. */
export function analyserImage(video: HTMLVideoElement, meilleureNettete: number): Analyse {
  const vw = video.videoWidth, vh = video.videoHeight;
  const largeur = Math.min(LARGEUR_ANALYSE, vw);
  let c = copieRedressee(video, vw, vh, largeur, 0);
  let gris = grisCanalMin(c);
  let { carte } = carteEncreLocale(gris);
  const angle = estimerInclinaison(carte);
  if (Math.abs(angle) >= 1 && Math.abs(angle) <= 4) {
    // Petite inclinaison : on redresse avant de chercher le tableau ; la
    // photo finale sera redressée du même angle.
    c = copieRedressee(video, vw, vh, largeur, angle);
    gris = grisCanalMin(c);
    carte = carteEncreLocale(gris).carte;
  }
  const tableau = trouverTableau(carte);
  let biais = 0, netteteBrute = 0;
  if (tableau) {
    const { x0, x1 } = tableau.boite;
    const milieu = Math.round((x0 + x1) / 2);
    biais = estimerInclinaison(carte, x0, milieu, 6) - estimerInclinaison(carte, milieu, x1, 6);
    netteteBrute = nettete(gris, tableau.boite);
  }
  const mesure: MesureCadrage = {
    tableau, angle, biais, largeur: c.width,
    netteteRelative: meilleureNettete > 0 ? netteteBrute / meilleureNettete : 1,
    echellePleine: vw / c.width,
  };
  const b = tableau?.boite;
  return {
    mesure,
    verdict: verdictCadrage(mesure),
    boiteRelative: b ? { x0: b.x0 / c.width, y0: b.y0 / c.height, x1: b.x1 / c.width, y1: b.y1 / c.height } : null,
    netteteBrute,
  };
}

/** Rafale : `n` images pleine résolution à intervalle régulier ; renvoie la plus nette. */
export async function rafale(video: HTMLVideoElement, boite: BoiteTableau | null, n = 4, intervalle = 110): Promise<HTMLCanvasElement> {
  const vw = video.videoWidth, vh = video.videoHeight;
  let meilleure: HTMLCanvasElement | null = null, score = -1;
  for (let i = 0; i < n; i++) {
    const c = document.createElement('canvas');
    c.width = vw; c.height = vh;
    c.getContext('2d', { willReadFrequently: true })!.drawImage(video, 0, 0, vw, vh);
    // Netteté mesurée sur une copie réduite de la zone du tableau (rapide).
    const petite = copieRedressee(c, vw, vh, Math.min(900, vw), 0);
    const zone = boite
      ? { x0: boite.x0 * petite.width, y0: boite.y0 * petite.height, x1: boite.x1 * petite.width, y1: boite.y1 * petite.height }
      : undefined;
    const s = nettete(grisCanalMin(petite), zone);
    if (s > score) { score = s; meilleure = c; }
    if (i < n - 1) await new Promise(r => setTimeout(r, intervalle));
  }
  return meilleure!;
}

/**
 * Photo prête pour la lecture : redressée du même angle que l'analyse,
 * recadrée sur le tableau (avec une marge), et très légèrement lissée pour
 * gommer le moiré de la trame de l'écran.
 */
export function preparerPhoto(photo: HTMLCanvasElement, angle: number, boite: BoiteTableau | null): HTMLCanvasElement {
  const droite = Math.abs(angle) >= 1 && Math.abs(angle) <= 4
    ? copieRedressee(photo, photo.width, photo.height, photo.width, angle)
    : photo;
  const W = droite.width, H = droite.height;
  const m = 0.04;
  const b = boite ?? { x0: 0, y0: 0, x1: 1, y1: 1 };
  const x0 = Math.max(0, (b.x0 - m) * W), y0 = Math.max(0, (b.y0 - m * 1.5) * H);
  const x1 = Math.min(W, (b.x1 + m) * W), y1 = Math.min(H, (b.y1 + m * 1.5) * H);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(x1 - x0));
  c.height = Math.max(1, Math.round(y1 - y0));
  const ctx = c.getContext('2d')!;
  ctx.filter = 'blur(0.6px)';
  ctx.drawImage(droite, x0, y0, c.width, c.height, 0, 0, c.width, c.height);
  return c;
}

/**
 * Photo guidée : en réglage sur de vraies photos d'écran, elle n'est proposée
 * que si l'adresse contient `?photo=1` (le choix est ensuite mémorisé).
 */
export function cameraDisponible(): boolean {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return false;
  try {
    const p = new URLSearchParams(location.search).get('photo');
    if (p === '1') localStorage.setItem('fastcurve.photo-guidee', '1');
    if (p === '0') localStorage.removeItem('fastcurve.photo-guidee');
    return localStorage.getItem('fastcurve.photo-guidee') === '1';
  } catch { return false; }
}
