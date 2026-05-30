/* ─── SGAR Portería — Service Worker ────────────────────────────────────────
   Estrategia: Cache-First para assets estáticos, Network-First para API.
   La app funciona completamente offline gracias a Dexie.js.
   ──────────────────────────────────────────────────────────────────────────── */
'use strict';

const CACHE_NAME    = 'sgar-porteria-v1';
const STATIC_ASSETS = [
  '/porteria',
  '/static/porteria/css/porteria.css',
  '/static/porteria/js/db.js',
  '/static/porteria/js/api.js',
  '/static/porteria/js/porteria.js',
  'https://unpkg.com/dexie@3.2.4/dist/dexie.min.js',
];

/* ── INSTALL: cachear assets estáticos ─────────────────────────────────────── */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

/* ── ACTIVATE: limpiar caches antiguos ─────────────────────────────────────── */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

/* ── FETCH: estrategia por tipo de recurso ──────────────────────────────────── */
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Rutas de API: Network-First (si falla, error claro — Dexie maneja el dato)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // Assets estáticos: Cache-First
  event.respondWith(cacheFirst(event.request));
});

/* ── Cache-First ────────────────────────────────────────────────────────────── */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (_) {
    // Si no hay red y no hay caché: respuesta vacía
    return new Response('Sin conexión', { status: 503 });
  }
}

/* ── Network-First ──────────────────────────────────────────────────────────── */
async function networkFirst(request) {
  try {
    return await fetch(request);
  } catch (_) {
    const cached = await caches.match(request);
    return cached || new Response(
      JSON.stringify({ success: false, message: 'Sin conexión' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
