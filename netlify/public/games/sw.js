// сначала сеть, без связи — сохранённая копия (только файлы игрового приложения)
const CACHE = "rey-games-1";
const FILES = ["/games/", "/games/manifest.webmanifest", "/games/icon-192.png", "/cabinet/blocks.js"];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin || !FILES.includes(u.pathname)) return;
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(u.pathname, copy)); }
        return r;
      })
      .catch(() => caches.match(u.pathname).then((r) => r || Response.error()))
  );
});
