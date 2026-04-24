// Service Worker — LA HUNE Draft Survey
// Stratégie : cache-first pour les ressources de l'app, network-fallback.
// À incrémenter à chaque déploiement pour forcer la mise à jour.
const CACHE_NAME = 'lahune-draft-v2-2026-04-23';

// Ressources à précharger au premier lancement
const PRECACHE = [
  './',
  './index.html',
  './app.jsx',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable.png',
  'https://unpkg.com/react@18/umd/react.production.min.js',
  'https://unpkg.com/react-dom@18/umd/react-dom.production.min.js',
  'https://unpkg.com/@babel/standalone/babel.min.js',
  'https://cdn.tailwindcss.com',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // addAll est strict ; on utilise add() individuel pour tolérer les échecs CDN au premier chargement
      Promise.all(
        PRECACHE.map((url) =>
          cache.add(url).catch((err) => console.warn('Cache miss', url, err))
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          // Ne met en cache que les réponses valides
          if (res && res.status === 200 && res.type !== 'opaque') {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return res;
        })
        .catch(() => {
          // Hors ligne et pas en cache : on renvoie l'index pour les routes de l'app
          if (req.mode === 'navigate') return caches.match('./index.html');
          return new Response('Ressource non disponible hors ligne', { status: 503 });
        });
    })
  );
});
