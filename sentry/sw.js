const CACHE = 'face-sentry-v1';
const SHELL = [
  './', './index.html', './manifest.json', './css/app.css',
  './js/app.js', './js/ai.js', './js/config.js', './js/db.js',
  './js/tracker.js', './js/alert.js', './js/outbox.js',
  './vendor/onnxruntime/ort.webgpu.min.js'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))),
    self.clients.claim()
  ]));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const immutable = /\.(onnx|wasm)$/.test(url.pathname);
  if (immutable) {
    event.respondWith(caches.open(CACHE).then(async cache => {
      const saved = await cache.match(request);
      if (saved) return saved;
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    }));
    return;
  }
  event.respondWith(fetch(request).then(response => {
    if (response.ok) {
      const copy = response.clone();
      void caches.open(CACHE).then(cache => cache.put(request, copy));
    }
    return response;
  }).catch(async () => (await caches.match(request)) || Response.error()));
});
