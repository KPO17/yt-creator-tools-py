// service-worker.js - YT Creator Tools avec support Python Functions
const CACHE_NAME = 'yt-creator-tools-v2.1.0';
const CACHE_VERSION = 'v2.1.0';

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
  'chrome-extension://',
  // Nouvelles URLs à ne pas cacher
  'https://img.youtube.com/', // Images YouTube dynamiques
  'firebase',
  'google'
];

// URLs qui nécessitent toujours le réseau (Network First)
const NETWORK_FIRST_URLS = [
  '/.netlify/functions/subtitles', // Notre fonction Python
  '/api/',
  'https://img.youtube.com/',
  'https://www.googleapis.com/youtube/',
  'firebase',
  'pagead2.googlesyndication.com'
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

// Gestion des requêtes avec stratégies spécifiques
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  
  // Ignorer certaines requêtes
  if (shouldIgnoreRequest(request)) {
    return;
  }
  
  // Stratégies de cache différentes selon le type de ressource
  if (isPythonFunctionRequest(url)) {
    // Network Only pour les fonctions Python (pas de cache)
    event.respondWith(networkOnlyStrategy(request));
  } else if (isNetworkFirstResource(url)) {
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

// Gestion des notifications push
self.addEventListener('push', event => {
  if (event.data) {
    const data = event.data.json();
    const options = {
      body: data.body || 'Sous-titres prêts ! Téléchargez votre script YouTube.',
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-192x192.png',
      tag: 'yt-creator-notification',
      requireInteraction: false,
      data: data.data || {},
      actions: [
        {
          action: 'open',
          title: 'Ouvrir l\'app',
          icon: '/icons/action-open.png'
        },
        {
          action: 'dismiss',
          title: 'Ignorer'
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
            return clients.openWindow('/?from=notification');
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
        
      case 'CACHE_SUBTITLE_RESULT':
        // Cache le résultat des sous-titres pour accès offline
        if (event.data.data) {
          cacheSubtitleResult(event.data.data);
        }
        break;
    }
  }
});

// ==================== FONCTIONS UTILITAIRES ====================

function shouldIgnoreRequest(request) {
  const url = request.url;
  
  // Ignorer les requêtes non-GET sauf pour les fonctions Netlify
  if (request.method !== 'GET' && !url.includes('/.netlify/functions/')) {
    return true;
  }
  
  // Ignorer les extensions de navigateur
  if (url.startsWith('chrome-extension://') || url.startsWith('moz-extension://')) {
    return true;
  }
  
  // Ignorer certaines URLs
  return NEVER_CACHE_URLS.some(pattern => url.includes(pattern));
}

function isPythonFunctionRequest(url) {
  return url.pathname.includes('/.netlify/functions/subtitles');
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

// Stratégie Network Only (pour les fonctions Python)
async function networkOnlyStrategy(request) {
  try {
    console.log('[SW] Network Only:', request.url);
    const response = await fetch(request);
    
    // Log pour debug des fonctions Python
    if (!response.ok) {
      console.warn('[SW] Python function error:', response.status, request.url);
    }
    
    return response;
  } catch (error) {
    console.error('[SW] Python function failed:', error);
    // Retourner une erreur JSON pour les fonctions
    return new Response(
      JSON.stringify({ error: 'Fonction indisponible offline' }),
      { 
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

// Stratégie Network First
async function networkFirstStrategy(request) {
  try {
    // Essayer le réseau d'abord
    const response = await fetch(request);
    
    // Si succès, mettre en cache (sauf APIs)
    if (response.ok && !request.url.includes('/api/') && !request.url.includes('/.netlify/functions/')) {
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
    
    for (const url of EXTENDED_CACHE_RESOURCES) {
      try {
        await cache.add(new Request(url, { mode: 'cors' }));
        console.log('[SW] Ressource mise en cache:', url);
      } catch (error) {
        console.warn('[SW] Impossible de mettre en cache:', url);
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
    
    console.log('[SW] Synchronisation arrière-plan terminée');
  } catch (error) {
    console.error('[SW] Erreur synchronisation:', error);
  }
}

// Cache des résultats de sous-titres pour accès offline
async function cacheSubtitleResult(data) {
  try {
    const cache = await caches.open(CACHE_NAME);
    const response = new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json' }
    });
    
    await cache.put(`/offline-subtitles/${data.videoId}`, response);
    console.log('[SW] Résultat sous-titres mis en cache:', data.videoId);
  } catch (error) {
    console.warn('[SW] Erreur cache sous-titres:', error);
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

// Nettoyer le cache
async function cleanupCache() {
  const cache = await caches.open(CACHE_NAME);
  const requests = await cache.keys();
  
  // Supprimer les entrées les plus anciennes
  const oldRequests = requests.slice(0, Math.floor(requests.length / 3));
  
  for (const request of oldRequests) {
    await cache.delete(request);
  }
  
  console.log('[SW] Cache nettoyé:', oldRequests.length, 'entrées supprimées');
}

// Vider tous les caches
async function clearAllCaches() {
  const cacheNames = await caches.keys();
  return Promise.all(
    cacheNames.map(cacheName => caches.delete(cacheName))
  );
}

// Log de démarrage
console.log('[SW] YT Creator Tools Service Worker', CACHE_VERSION, 'chargé avec support Python Functions');

// Gestion des erreurs globales
self.addEventListener('error', event => {
  console.error('[SW] Erreur globale:', event.error);
});

self.addEventListener('unhandledrejection', event => {
  console.error('[SW] Promise rejetée:', event.reason);
  event.preventDefault();
});