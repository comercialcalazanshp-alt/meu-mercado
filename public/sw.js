const CACHE_NAME = "mm-shell-v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Limpa cache de versão antiga — sem isso, cada deploy só ia
      // acumulando cópia velha de bundle sem nunca liberar espaço.
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

// Antes disso, o fetch handler era um no-op — o navegador não tinha nada
// pra servir quando a internet caía, então o PDV nem abria offline (mesmo
// já tendo IndexedDB pronto pra vender sem rede — ver src/lib/pdv-offline.ts).
// Estratégia: tenta a rede primeiro (sempre pega a versão mais nova quando
// tem internet) e guarda uma cópia; se a rede falhar, serve a última cópia
// salva. Só cuida do próprio site (HTML/JS/CSS) — chamada pra API do
// Supabase é outro domínio, passa direto sem entrar aqui, do jeito que tem
// que ser (dado ao vivo nunca deveria vir de cache).
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  event.respondWith(
    (async () => {
      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(request, response.clone());
        }
        return response;
      } catch {
        const cached = await caches.match(request);
        if (cached) return cached;
        throw new Error("offline e sem versão salva pra essa página");
      }
    })(),
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = data.title || "Meu Mercado";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      data: { url: data.url || "/painel/pedidos" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/painel/pedidos";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientsList) => {
      for (const client of clientsList) {
        if (client.url.includes(url) && "focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    }),
  );
});
