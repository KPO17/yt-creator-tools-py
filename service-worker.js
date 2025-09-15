// service_worker.js - YT Creator Tools
const CACHE_NAME = 'yt-creator-tools-v2.0.0';
const CACHE_VERSION = 'v2.0.0';

// Ressources critiques à mettre en cache immédiatement
const CORE_CACHE_RESOURCES = [
  '/',
  '/index.html',
  '/manifest.json',
  '/privacy_policy.html'
];

// Ressources supplémentaires à mettre en cache en arrière-plan
const EXTENDED_CACHE_RESOURCES = [
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  // CDN Firebase
  'https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth-compat.js'
];

// URLs à ne jamais mettre en cache
const NEVER_CACHE_URLS = [
  '/api/',
  '/.netlify/functions/',
  'https://www.googleapis.com/',
  'https://pagead2.googlesyndication.com/',
  'chrome-extension://'
];

// URLs qui nécessitent toujours le réseau
const NETWORK_FIRST_URLS = [
  '/api/',
  '/.netlify/functions/',
  'https://img.youtube.com/',
  'https://www.googleapis.com/youtube/'
];

// Installation du Service Worker
self.addEventListener('install', event => {
  console.log('[SW] Installation en cours...', CACHE_VERSION);
  
  event.waitUntil(
    Promise.all([
      // Cache des ressources critiques
      caches.open(CACHE_NAME).then(cache => {
        console.log('[SW] Mise en cache des ressources critiques');
        return cache.addAll(CORE_CACHE_RESOURCES.map(url => new Request(url, {
          cache: 'reload' // Force le téléchargement même si en cache
        })));
      }),
      
      // Activation immédiate
      self.skipWaiting()
    ])
  );
});

// Activation du Service Worker
self.addEventListener('activate', event => {
  console.log('[SW] Activation...', CACHE_VERSION);
  
  event.waitUntil(
    Promise.all([
      // Nettoyage des anciens caches
      cleanupOldCaches(),
      
      // Prise de contrôle immédiate
      self.clients.claim(),
      
      // Cache des ressources étendues en arrière-plan
      cacheExtendedResources()
    ])
  );
});

// Gestion des requêtes
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  
  // Ignorer certaines requêtes
  if (shouldIgnoreRequest(request)) {
    return;
  }
  
  // Stratégies de cache différentes selon le type de ressource
  if (isNetworkFirstResource(url)) {
    // Network First (APIs, images YouTube)
    event.respondWith(networkFirstStrategy(request));
  } else if (isCacheFirstResource(url)) {
    // Cache First (ressources statiques)
    event.respondWith(cacheFirstStrategy(request));
  } else if (isStaleWhileRevalidateResource(url)) {
    // Stale While Revalidate (contenu dynamique)
    event.respondWith(staleWhileRevalidateStrategy(request));
  } else {
    // Cache First par défaut
    event.respondWith(cacheFirstStrategy(request));
  }
});

// Gestion des notifications push (optionnel)
self.addEventListener('push', event => {
  if (event.data) {
    const data = event.data.json();
    const options = {
      body: data.body || 'Nouvelle notification de YT Creator Tools',
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-192x192.png',
      tag: 'yt-creator-notification',
      requireInteraction: false,
      actions: [
        {
          action: 'open',
          title: 'Ouvrir l\'app'
        },
        {
          action: 'close',
          title: 'Fermer'
        }
      ]
    };
    
    event.waitUntil(
      self.registration.showNotification(data.title || 'YT Creator Tools', options)
    );
  }
});

// Gestion des clics sur notifications
self.addEventListener('notificationclick', event => {
  event.notification.close();
  
  if (event.action === 'open' || !event.action) {
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true })
        .then(clientList => {
          // Si l'app est déjà ouverte, la focus
          for (const client of clientList) {
            if (client.url.includes(self.location.origin) && 'focus' in client) {
              return client.focus();
            }
          }
          // Sinon, ouvrir une nouvelle fenêtre
          if (clients.openWindow) {
            return clients.openWindow('/');
          }
        })
    );
  }
});

// Synchronisation en arrière-plan
self.addEventListener('sync', event => {
  if (event.tag === 'background-sync') {
    event.waitUntil(performBackgroundSync());
  }
});

// Gestion des messages depuis l'application
self.addEventListener('message', event => {
  if (event.data && event.data.type) {
    switch (event.data.type) {
      case 'SKIP_WAITING':
        self.skipWaiting();
        break;
        
      case 'GET_VERSION':
        event.ports[0].postMessage({ version: CACHE_VERSION });
        break;
        
      case 'CLEAR_CACHE':
        clearAllCaches().then(() => {
          event.ports[0].postMessage({ success: true });
        });
        break;
        
      case 'CACHE_URLS':
        if (event.data.urls) {
          cacheUrls(event.data.urls).then(() => {
            event.ports[0].postMessage({ success: true });
          });
        }
        break;
    }
  }
});

// ==================== FONCTIONS UTILITAIRES ====================

function shouldIgnoreRequest(request) {
  const url = request.url;
  
  // Ignorer les requêtes non-GET
  if (request.method !== 'GET') return true;
  
  // Ignorer les extensions de navigateur
  if (url.startsWith('chrome-extension://')) return true;
  if (url.startsWith('moz-extension://')) return true;
  
  // Ignorer certaines URLs
  return NEVER_CACHE_URLS.some(pattern => url.includes(pattern));
}

function isNetworkFirstResource(url) {
  return NETWORK_FIRST_URLS.some(pattern => url.href.includes(pattern));
}

function isCacheFirstResource(url) {
  const pathname = url.pathname;
  
  // Ressources statiques
  return pathname.match(/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf)$/) ||
         pathname === '/' ||
         pathname === '/index.html' ||
         pathname === '/manifest.json';
}

function isStaleWhileRevalidateResource(url) {
  // APIs YouTube et autres données dynamiques
  return url.href.includes('googleapis.com') && !url.href.includes('img.youtube.com');
}

// Stratégie Network First
async function networkFirstStrategy(request) {
  try {
    // Essayer le réseau d'abord
    const response = await fetch(request);
    
    // Si succès, mettre en cache (sauf si c'est une API)
    if (response.ok && !request.url.includes('/api/')) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    
    return response;
  } catch (error) {
    console.log('[SW] Réseau indisponible, tentative cache:', request.url);
    
    // Fallback sur le cache
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    
    // Fallback final
    if (request.destination === 'document') {
      return caches.match('/index.html');
    }
    
    throw error;
  }
}

// Stratégie Cache First
async function cacheFirstStrategy(request) {
  // Chercher en cache d'abord
  const cachedResponse = await caches.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }
  
  try {
    // Si pas en cache, aller sur le réseau
    const response = await fetch(request);
    
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    
    return response;
  } catch (error) {
    // Fallback pour les documents
    if (request.destination === 'document') {
      return caches.match('/index.html');
    }
    throw error;
  }
}

// Stratégie Stale While Revalidate
async function staleWhileRevalidateStrategy(request) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(request);
  
  // Lancer la mise à jour en arrière-plan
  const fetchPromise = fetch(request)
    .then(response => {
      if (response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => {
      console.log('[SW] Erreur réseau pour:', request.url);
    });
  
  // Retourner la version cache immédiatement si disponible
  return cachedResponse || fetchPromise;
}

// Nettoyage des anciens caches
async function cleanupOldCaches() {
  const cacheNames = await caches.keys();
  
  return Promise.all(
    cacheNames
      .filter(cacheName => {
        return cacheName.startsWith('yt-creator-tools-') && cacheName !== CACHE_NAME;
      })
      .map(cacheName => {
        console.log('[SW] Suppression ancien cache:', cacheName);
        return caches.delete(cacheName);
      })
  );
}

// Cache des ressources étendues
async function cacheExtendedResources() {
  try {
    const cache = await caches.open(CACHE_NAME);
    
    // Ajouter les ressources une par une pour éviter les échecs
    for (const url of EXTENDED_CACHE_RESOURCES) {
      try {
        await cache.add(new Request(url, { mode: 'cors' }));
        console.log('[SW] Ressource mise en cache:', url);
      } catch (error) {
        console.warn('[SW] Impossible de mettre en cache:', url, error);
      }
    }
  } catch (error) {
    console.warn('[SW] Erreur cache étendu:', error);
  }
}

// Synchronisation en arrière-plan
async function performBackgroundSync() {
  try {
    // Nettoyer le cache si nécessaire
    const cacheSize = await getCacheSize();
    if (cacheSize > 50 * 1024 * 1024) { // 50MB
      await cleanupCache();
    }
    
    // Pré-charger les ressources populaires
    await preloadPopularResources();
    
    console.log('[SW] Synchronisation arrière-plan terminée');
  } catch (error) {
    console.error('[SW] Erreur synchronisation:', error);
  }
}

// Calculer la taille du cache
async function getCacheSize() {
  const cache = await caches.open(CACHE_NAME);
  const requests = await cache.keys();
  let totalSize = 0;
  
  for (const request of requests) {
    try {
      const response = await cache.match(request);
      if (response) {
        const blob = await response.blob();
        totalSize += blob.size;
      }
    } catch (error) {
      console.warn('[SW] Erreur calcul taille:', error);
    }
  }
  
  return totalSize;
}

// Nettoyer le cache en supprimant les anciennes entrées
async function cleanupCache() {
  const cache = await caches.open(CACHE_NAME);
  const requests = await cache.keys();
  
  // Supprimer les entrées les plus anciennes (logique simple)
  const oldRequests = requests.slice(0, Math.floor(requests.length / 3));
  
  for (const request of oldRequests) {
    await cache.delete(request);
  }
  
  console.log('[SW] Cache nettoyé:', oldRequests.length, 'entrées supprimées');
}

// Pré-charger les ressources populaires
async function preloadPopularResources() {
  const popularUrls = [
    'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg', // Exemple
  ];
  
  const cache = await caches.open(CACHE_NAME);
  
  for (const url of popularUrls) {
    try {
      if (!(await cache.match(url))) {
        await cache.add(url);
      }
    } catch (error) {
      console.warn('[SW] Erreur préchargement:', url);
    }
  }
}

// Vider tous les caches
async function clearAllCaches() {
  const cacheNames = await caches.keys();
  return Promise.all(
    cacheNames.map(cacheName => caches.delete(cacheName))
  );
}

// Mettre en cache des URLs spécifiques
async function cacheUrls(urls) {
  const cache = await caches.open(CACHE_NAME);
  return Promise.all(
    urls.map(url => {
      return cache.add(url).catch(error => {
        console.warn('[SW] Impossible de mettre en cache:', url, error);
      });
    })
  );
}

// Log de démarrage
console.log('[SW] YT Creator Tools Service Worker', CACHE_VERSION, 'chargé');

// Gestion des erreurs globales
self.addEventListener('error', event => {
  console.error('[SW] Erreur globale:', event.error);
});

self.addEventListener('unhandledrejection', event => {
  console.error('[SW] Promise rejetée:', event.reason);
  event.preventDefault();
});

// Statistiques de performance (optionnel)
self.addEventListener('fetch', event => {
  const startTime = performance.now();
  
  event.respondWith(
    handleRequest(event.request).then(response => {
      const duration = performance.now() - startTime;
      
      // Log des performances pour les requêtes lentes
      if (duration > 1000) {
        console.warn('[SW] Requête lente:', event.request.url, duration.toFixed(2) + 'ms');
      }
      
      return response;
    })
  );
});

// Fonction wrapper pour les requêtes
async function handleRequest(request) {
  const url = new URL(request.url);
  
  if (shouldIgnoreRequest(request)) {
    return fetch(request);
  }
  
  if (isNetworkFirstResource(url)) {
    return networkFirstStrategy(request);
  } else if (isCacheFirstResource(url)) {
    return cacheFirstStrategy(request);
  } else if (isStaleWhileRevalidateResource(url)) {
    return staleWhileRevalidateStrategy(request);
  } else {
    return cacheFirstStrategy(request);
  }
}