/*
 * Service worker Aalqurany (PWA).
 *
 * Tujuan: setelah dibuka sekali dengan internet, aplikasi (halaman, font, dan
 * data mushaf) bisa dibuka lagi tanpa internet.
 *
 *  - Halaman (navigasi): jaringan dulu supaya versi baru langsung terpakai,
 *    cadangan dari cache bila offline.
 *  - Berkas hash (/assets/): cache dulu — namanya berubah tiap build, isinya
 *    tidak pernah berubah.
 *  - Lainnya (data mushaf, ikon, manifest): tampilkan dari cache lalu segarkan
 *    diam-diam di belakang layar.
 *
 * Naikkan VERSION setiap mengubah berkas ini agar cache lama dibuang.
 */
const VERSION = 'aalqurany-v1'

self.addEventListener('install', (event) => {
  self.skipWaiting()
  event.waitUntil(
    caches.open(VERSION).then((cache) =>
      Promise.all(
        ['./', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'].map((u) =>
          cache.add(u).catch(() => {}),
        ),
      ),
    ),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'CACHE_URLS') return
  const urls = (event.data.urls || []).filter((u) => u.startsWith(self.location.origin))
  event.waitUntil(
    caches.open(VERSION).then((cache) => Promise.all(urls.map((u) => cache.add(u).catch(() => {})))),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(VERSION).then((c) => c.put('./', copy))
          return res
        })
        .catch(() => caches.match('./').then((r) => r || caches.match(req))),
    )
    return
  }

  if (url.pathname.includes('/assets/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            const copy = res.clone()
            caches.open(VERSION).then((c) => c.put(req, copy))
            return res
          }),
      ),
    )
    return
  }

  event.respondWith(
    caches.match(req).then((hit) => {
      const network = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(VERSION).then((c) => c.put(req, copy))
          }
          return res
        })
        .catch(() => hit)
      return hit || network
    }),
  )
})
