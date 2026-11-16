const scope = self.registration.scope
const cachePrefix = 'sakura-garden:' + scope + ':'
const cacheName = cachePrefix + '9b3eb89db3a77e54'
const urlFor = file => new URL(file, scope).href
const index = urlFor('index.html')
const files = ["index.html","style.css","manifest.webmanifest","src/main.js","src/ai-worker.js","assets/spring-garden.png","assets/icon-192.png","assets/icon-512.png"]
const urls = new Set(files.map(urlFor))

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName)
    await cache.addAll(files.map(file => new Request(urlFor(file), { cache: 'reload' })))
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith(cachePrefix) && key !== cacheName) await caches.delete(key)
    }
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return
  const url = new URL(event.request.url)
  url.search = ''
  url.hash = ''
  const key = url.href === scope ? index : url.href
  if (!urls.has(key)) return
  event.respondWith(caches.open(cacheName)
    .then(cache => cache.match(key))
    .then(response => response ?? fetch(event.request)))
})
