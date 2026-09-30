const CACHE = "qamar-shell-v1";
const SHELL = ["./", "./index.html", "./manifest.json"];

self.addEventListener("install", e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(()=>{}));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

// Netzwerk zuerst (App-Daten sind live), Cache nur als Rückfallebene beim App-Start.
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy)).catch(()=>{});
      return res;
    }).catch(() => caches.match(e.request))
  );
});

// ---- Push-Benachrichtigungen ----
self.addEventListener("push", e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (err) {}
  const title = data.title || "Qamar Network";
  const body = data.body || "Du hast eine neue Nachricht.";
  e.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "icon-192.svg",
      badge: "icon-192.svg",
      data: { openchat: data.openchat || null },
      tag: data.openchat ? "chat-" + data.openchat : undefined
    })
  );
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const openchat = e.notification.data && e.notification.data.openchat;
  const url = openchat ? ("./?openchat=" + encodeURIComponent(openchat)) : "./";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if ("focus" in c) {
          c.postMessage({ type: "openchat", id: openchat });
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
