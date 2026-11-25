const CACHE = 'duocam-v3';
const ASSETS = [
  './', './index.html', './app.js', './santa.js', './manifest.webmanifest', './icon-180.png', './icon-512.png',
  './vendor/vision_bundle.mjs', './vendor/blaze_face_short_range.tflite',
  './vendor/wasm/vision_wasm_internal.js', './vendor/wasm/vision_wasm_internal.wasm'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (new URL(e.request.url).origin !== self.location.origin) return;   // mai toccare richieste di terzi
  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok && r.type === 'basic') { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request))
  );
});
