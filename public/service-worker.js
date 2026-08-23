// FastCurve — service worker minimal, écrit à la main (pas de dépendance,
// facile à auditer pour une app médicale).
//
// Rôle STRICT : mettre en cache le shell applicatif (HTML/JS/CSS/icônes déjà
// servis par ce site) pour un lancement instantané depuis l'écran d'accueil
// et un fonctionnement hors-ligne. Rien d'autre :
//   - jamais de requête vers un service externe (on ignore tout ce qui n'est
//     pas same-origin, et tout ce qui n'est pas GET) ;
//   - jamais de donnée patient mise en cache ici : les données restent
//     uniquement dans localStorage, ce service worker ne les voit jamais.
//
// Stratégie (déjà documentée dans index.html) :
//   - navigation / documents HTML : réseau d'abord, repli sur le cache
//     seulement hors-ligne. index.html est servi avec des en-têtes
//     no-cache côté serveur précisément pour qu'une mise à jour atteigne
//     toujours les postes en ligne ; le service worker respecte cette
//     intention et ne sert jamais une page périmée par erreur quand le
//     réseau répond.
//   - autres requêtes (assets buildés, noms hachés par Vite ; icônes ;
//     modèles Tesseract, etc.) : cache d'abord, réseau en repli, puis mise
//     en cache de la réponse. Un nom de fichier haché correspond toujours au
//     même contenu, donc cache-first est à la fois sûr et rapide.
//
// Invalidation : CACHE_NAME est versionné. À chaque changement de logique de
// ce fichier, incrémenter le suffixe purge proprement l'ancien cache à
// l'activation. Les anciens noms de fichiers hachés (après un nouveau build)
// ne sont eux jamais servis par erreur puisque index.html n'est jamais servi
// depuis le cache tant que le réseau répond.

const CACHE_NAME = 'fastcurve-shell-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith('fastcurve-shell-') && name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

function isNavigationRequest(request) {
  return request.mode === 'navigate' || request.destination === 'document';
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) {
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Uniquement GET, uniquement same-origin : jamais d'API tierce interceptée
  // ou mise en cache.
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) {
    return;
  }

  if (isNavigationRequest(request)) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(cacheFirst(request));
});
