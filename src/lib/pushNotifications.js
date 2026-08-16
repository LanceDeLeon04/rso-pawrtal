// src/lib/pushNotifications.js
//
// Browser Web Push — real OS-level popup notifications (desktop and
// phone), not just an in-app toast. Complements the existing email
// notifications; doesn't replace them.
//
// Flow:
//   1. registerServiceWorker() once on app load (public/sw.js).
//   2. User opts in from Settings -> subscribeToPush(profileId).
//      This asks browser permission, creates a PushSubscription, and
//      upserts it into push_subscriptions (see migration 063).
//   3. DB triggers (migration 063) call the send-push Edge Function,
//      which sends to every subscription on file for that profile.
//
// Requires VITE_VAPID_PUBLIC_KEY in .env (public key only — the
// private key lives server-side as an Edge Function secret, never
// shipped to the browser).

import { supabase } from './supabaseClient'

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY

export function isPushSupported() {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window
}

export function getPermissionState() {
  if (typeof Notification === 'undefined') return 'unsupported'
  return Notification.permission // 'default' | 'granted' | 'denied'
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i)
  return outputArray
}

export async function registerServiceWorker() {
  if (!isPushSupported()) return null
  try {
    return await navigator.serviceWorker.register('/sw.js')
  } catch (err) {
    console.error('Service worker registration failed', err)
    return null
  }
}

// Ask permission (if needed) and create+save a push subscription for
// the given profile. Returns { ok: boolean, reason?: string }.
export async function subscribeToPush(profileId) {
  if (!isPushSupported()) return { ok: false, reason: 'not-supported' }
  if (!VAPID_PUBLIC_KEY) return { ok: false, reason: 'not-configured' }

  const registration = (await navigator.serviceWorker.getRegistration()) || (await registerServiceWorker())
  if (!registration) return { ok: false, reason: 'sw-failed' }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return { ok: false, reason: 'denied' }

  let subscription = await registration.pushManager.getSubscription()
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    })
  }

  const json = subscription.toJSON()
  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      profile_id: profileId,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      user_agent: navigator.userAgent,
    },
    { onConflict: 'endpoint' }
  )

  if (error) return { ok: false, reason: 'save-failed' }
  return { ok: true }
}

// Turn off push for this device: unsubscribe the browser and remove
// the row so send-push stops targeting it.
export async function unsubscribeFromPush() {
  if (!isPushSupported()) return { ok: false, reason: 'not-supported' }
  const registration = await navigator.serviceWorker.getRegistration()
  if (!registration) return { ok: true }

  const subscription = await registration.pushManager.getSubscription()
  if (!subscription) return { ok: true }

  const endpoint = subscription.endpoint
  await subscription.unsubscribe()
  await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint)
  return { ok: true }
}

// Is this specific browser/device currently subscribed?
export async function isSubscribed() {
  if (!isPushSupported()) return false
  const registration = await navigator.serviceWorker.getRegistration()
  if (!registration) return false
  const subscription = await registration.pushManager.getSubscription()
  return !!subscription
}

// Plays public/sounds/notif.mp3 when the service worker signals a push
// arrived (see public/sw.js). Only fires while this tab/window is open
// — browsers give web push no way to set a custom sound for the OS
// popup itself when the app is fully closed, so that case always
// falls back to the browser/OS's own default sound instead.
export function listenForPushSound() {
  if (!('serviceWorker' in navigator)) return

  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type !== 'PLAY_NOTIFICATION_SOUND') return
    const audio = new Audio('/sounds/notif.mp3')
    audio.volume = 0.85
    // Autoplay can be blocked by the browser if the user hasn't
    // interacted with the page yet in this tab — fail silently rather
    // than throwing, since the OS popup + its default sound still
    // happened regardless.
    audio.play().catch(() => {})
  })
}
