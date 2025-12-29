self.addEventListener("push", event => {
  if (!event.data) return;

  const data = event.data.json();

  event.waitUntil(
    self.registration.showNotification(data.title || "Notification", {
      body: data.body || "New update",
      icon: "/icon.png",
      requireInteraction: true
    })
  );
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil(clients.openWindow("/report"));
});
