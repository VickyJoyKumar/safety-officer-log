const CACHE_NAME = 'safety-officer-log-shell-v1'
const APP_SHELL_URLS = ['.', 'index.html', 'manifest.webmanifest', 'favicon.svg']

const toScopePath = (relativePath) => new URL(relativePath, self.registration.scope).pathname

const INDEX_PATH = toScopePath('index.html')
const ROOT_PATH = toScopePath('.')

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL_URLS.map((url) => toScopePath(url))))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
    ).then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return
  }

  const { request } = event

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(INDEX_PATH).then((response) => response ?? caches.match(ROOT_PATH))),
    )
    return
  }

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse
      }

      return fetch(request)
        .then((networkResponse) => {
          const responseClone = networkResponse.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone))
          return networkResponse
        })
        .catch(() => cachedResponse)
    }),
  )
})