// public/sw.js
//
// Minimal service worker whose only job is Web Push: show an OS-level
// notification when a push arrives (works even if the app tab/window
// is closed), and focus/open the app when the user taps it.
//
// Registered from src/lib/pushNotifications.js. Not used for offline
// caching — RSO Pawrtal doesn't need that, so this stays deliberately
// small to avoid stale-cache bugs.

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

// A no-op fetch handler (network passthrough, no caching). Not used for
// offline support — RSO Pawrtal needs a live connection anyway — but
// some browsers (notably older Chromium/Firefox installability checks)
// require an active fetch handler before they'll treat the site as an
// installable PWA.
self.addEventListener('fetch', () => {})


self.addEventListener('push', (event) => {
  let data = { title: 'RSO Pawrtal', body: 'You have a new notification.', url: '/' }
  try {
    if (event.data) data = { ...data, ...event.data.json() }
  } catch {
    if (event.data) data.body = event.data.text()
  }

  event.waitUntil(
    (async () => {
      // Show the OS-level popup. `silent: false` uses the browser/OS's
      // own default notification sound — browsers don't support a
      // custom `sound` option here, no matter what file we pass, so
      // this line alone can never play nu-notif.mp3.
      const showPromise = self.registration.showNotification(data.title, {
        body: data.body,
        icon: '/icon.png',
        badge: '/icon.png',
        data: { url: data.url || '/' },
        silent: false,
      })

      // Instead: tell every open tab/window of the app (foreground or
      // background, including the installed PWA) to play our actual
      // custom sound file itself via normal <audio> playback. This is
      // the only way to get a custom sound in a web push flow, and it
      // only works while the app is open somewhere — a fully closed
      // browser will only ever get the OS default sound above.
      const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of clientsList) {
        client.postMessage({ type: 'PLAY_NOTIFICATION_SOUND' })
      }

      await showPromise
    })()
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = (event.notification.data && event.notification.data.url) || '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        const clientUrl = new URL(client.url)
        if (clientUrl.origin === self.location.origin && 'focus' in client) {
          client.navigate(targetUrl)
          return client.focus()
        }
      }
      return self.clients.openWindow(targetUrl)
    })
  )
})
