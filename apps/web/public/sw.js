/**
 * PWA service worker for the inbox surface (SPEC §12). Deliberately minimal:
 * push + notification click only, no offline caching.
 */
self.addEventListener("push", (event) => {
  let payload = { title: "AgentOS", body: "", url: "/inbox" };
  try {
    if (event.data) {
      payload = { ...payload, ...event.data.json() };
    }
  } catch {
    // fall back to the default payload above
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      data: { url: payload.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "/inbox";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.endsWith(url) && "focus" in client) {
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
