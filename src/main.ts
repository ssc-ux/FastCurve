import { mount } from 'svelte';
import './styles/global.css';
import App from './App.svelte';

const app = mount(App, {
  target: document.getElementById('app')!,
});

// Demande au navigateur de ne pas effacer le suivi de lui-même (pression de
// stockage, Safari et ses 7 jours). Best-effort : le fichier .json reste la
// seule sauvegarde durable.
try { navigator.storage?.persist?.().catch(() => {}); } catch { /* ignore */ }

// Service worker : ne fait que mettre en cache le shell applicatif (fichiers
// statiques déjà servis par ce site) pour un lancement instantané depuis
// l'écran d'accueil et un usage hors-ligne. Aucune donnée patient n'y transite
// jamais. Dégradation silencieuse si non supporté ; inactif en développement.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  });
  // Une nouvelle version prend la main alors que la page est ouverte :
  // l'application le signale (bouton « Recharger »). Pas au tout premier
  // passage, où il n'y avait aucune version précédente.
  const avaitUneVersion = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (avaitUneVersion) window.dispatchEvent(new Event('fastcurve:nouvelle-version'));
  });
}

export default app;
