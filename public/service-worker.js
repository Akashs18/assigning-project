self.addEventListener('push', event => {
  if (!event.data) return;

  const data = event.data.json();
  const title = data.title || 'Notification';
  const options = {
    body: data.body || 'New update',
    icon: '/icon.png', // make sure you have an icon in /public
    requireInteraction: true
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.openWindow('/report'));
});
