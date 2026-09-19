// @ts-check
/*
 * The service worker (PROMPT §XI). The build prepends PRECACHE (every file Vite emitted) and
 * VERSION (a hash of that list), so the app shell installs as a whole or not at all, and a new
 * build replaces the old cache instead of mixing with it.
 *
 *   app shell (same-origin static files, navigations): cache-first. The app installs and runs
 *     from cache, with no network at all.
 *   bundles (/api/bundles/*): the app's sync asks with `cache: 'no-store'` and gets the network
 *     answer (a 304 when unchanged), with the SW cache refreshed behind it. When the network
 *     fails, it gets the cached copy marked `x-fasal-from-cache: 1`, so it can never mistake the
 *     phone's copy for the server speaking (V-2 lesson). Any other bundle read is
 *     stale-while-revalidate. The home screen waits on neither, because it reads verified bundles
 *     from IndexedDB.
 *   everything else under /api, and every mutation: network only, never cached. Offline actions
 *     go through the outbox, which the app owns.
 *
 * There is deliberately no offline fallback page. The app itself works offline, and a "you are
 * offline" page would admit the opposite.
 */

// PRECACHE and VERSION are prepended by the build (see globals.d.ts).
const sw = /** @type {ServiceWorkerGlobalScope} */ (/** @type {unknown} */ (self));
const ASSETS = PRECACHE;
const BUILD = VERSION;

const SHELL = `fasal-shell-${BUILD}`;
const BUNDLES = 'fasal-bundles-v1';

sw.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(ASSETS.map((path) => new Request(path, { cache: 'reload' }))))
      .then(() => sw.skipWaiting()),
  );
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('fasal-shell-') && key !== SHELL).map((key) => caches.delete(key))))
      .then(() => sw.clients.claim()),
  );
});

/** @param {Response} cached */
async function markedFromCache(cached) {
  const headers = new Headers(cached.headers);
  headers.set('x-fasal-from-cache', '1');
  return new Response(await cached.clone().arrayBuffer(), { status: cached.status, statusText: cached.statusText, headers });
}

/**
 * @param {Request} request
 * @param {FetchEvent} event
 */
async function bundle(request, event) {
  const cache = await caches.open(BUNDLES);
  const cached = await cache.match(request, { ignoreVary: true });
  const network = fetch(request).then(
    (response) => {
      if (response.ok) void cache.put(request, response.clone());
      return response;
    },
    () => null,
  );
  if (request.cache === 'no-store') {
    const response = await network;
    if (response !== null) return response;
    if (cached) return markedFromCache(cached);
    return new Response(JSON.stringify({ error: { code: 'OFFLINE', message: 'No network.' } }), { status: 503, headers: { 'content-type': 'application/json', 'x-fasal-from-cache': '1' } });
  }
  if (cached) {
    event.waitUntil(network);
    return markedFromCache(cached);
  }
  const response = await network;
  return response ?? new Response(JSON.stringify({ error: { code: 'OFFLINE', message: 'No network.' } }), { status: 503, headers: { 'content-type': 'application/json', 'x-fasal-from-cache': '1' } });
}

/** @param {Request} request */
async function shell(request) {
  const cache = await caches.open(SHELL);
  // A navigation to any in-app path is the single-page app's index.html.
  const lookup = request.mode === 'navigate' ? '/index.html' : request;
  // ignoreVary: a static server may send `Vary: Origin`, and a module script's request carries an
  // Origin header the precache request did not. The shell's bytes never vary by origin; without
  // this, the first offline reload finds index.html but not the script it loads.
  const cached = await cache.match(lookup, { ignoreSearch: request.mode === 'navigate', ignoreVary: true });
  if (cached) return cached;
  try {
    return await fetch(request);
  } catch (error) {
    const index = await cache.match('/index.html', { ignoreVary: true });
    if (request.mode === 'navigate' && index) return index;
    throw error;
  }
}

sw.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return; // mutations: network only, via the outbox
  const url = new URL(request.url);
  if (url.origin !== sw.location.origin) return;
  if (url.pathname.startsWith('/api/bundles/')) {
    event.respondWith(bundle(request, event));
    return;
  }
  if (url.pathname.startsWith('/api/')) return; // identity, health, outbox: never cached
  // The grading runtime and models: fetched by the camera, checked against pinned hashes and
  // kept in IndexedDB by the camera itself (camera/runtime.ts). Not the service worker's business.
  if (url.pathname.startsWith('/ort/') || url.pathname.startsWith('/models/')) return;
  event.respondWith(shell(request));
});
