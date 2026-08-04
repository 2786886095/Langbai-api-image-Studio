const CACHE_NAME = "ai-image-generator-1-6-28-20260804";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./bootstrap-guard.js",
  "./image-task-stability.js",
  "./codex-image-gateway.js",
  "./gemini-image-size-registry.js",
  "./gemini-web-image-adapter.js",
  "./gemini-selector-pack.js",
  "./gemini-watermark-remover.bundle.js",
  "./app.js",
  "./manifest.webmanifest",
  "./assets/icons/mascot-app-icon.png",
  "./assets/icons/mascot-avatar.png",
  "./assets/icons/mascot-empty.png",
  "./assets/icons/mascot-upload.png",
  "./assets/icons/mascot-maskable.png"
];
const CORE_PATHS = new Set(CORE_ASSETS.map(asset => new URL(asset, self.location.href).pathname));

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // A release cache is immutable. Reload every core response during install
      // so one worker can never combine an old app.js with a new index.html.
      .then(cache => cache.addAll(CORE_ASSETS.map(asset => new Request(asset, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      caches.open(CACHE_NAME)
        .then(cache => cache.match("./index.html"))
        .then(cached => cached || fetch(request))
    );
    return;
  }

  if (CORE_PATHS.has(url.pathname)) {
    event.respondWith(
      caches.open(CACHE_NAME)
        .then(cache => cache.match(request, { ignoreSearch: true }))
        .then(cached => cached || fetch(request))
    );
    return;
  }

  // Non-core same-origin resources remain network-first and may be cached.
  event.respondWith(fetch(request).catch(() => caches.match(request)));
});
