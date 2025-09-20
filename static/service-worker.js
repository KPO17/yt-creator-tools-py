// Service Worker pour YT Creator Tools
const CACHE_NAME = 'yt-creator-tools-v2.0.0';
const urlsToCache = [
  '/',
  '/static/index.html',
  '/manifest.json'
];

// Installation du service worker
self.addEventListener('install', (event) => {
  console.log('Service Worker: Installation...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Service Worker: Fichiers mis en cache');
        return cache.addAll(urlsToCache);
      })
      .catch((error) => {
        console.error('Service Worker: Erreur de mise en cache', error);
      })
  );
});

// Activation du service worker
self.addEventListener('activate', (event) => {
  console.log('Service Worker: Activation...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Service Worker: Suppression ancien cache', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// Interception des requêtes
self.addEventListener('fetch', (event) => {
  // Ignorer les requêtes API pour éviter les problèmes de cache
  if (event.request.url.includes('/api/')) {
    return;
  }
  
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // Retourner le fichier en cache s'il existe
        if (response) {
          return response;
        }
        
        // Sinon, faire la requête réseau
        return fetch(event.request)
          .catch(() => {
            // En cas d'erreur réseau, retourner la page d'accueil si c'est une navigation
            if (event.request.mode === 'navigate') {
              return caches.match('/');
            }
          });
      })
  );
});