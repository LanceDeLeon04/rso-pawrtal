// supabase/functions/send-push/index.ts
//
// Called (fire-and-forget, via pg_net) by migration 063's triggers —
// trg_notify_submission_status_push (submitter) and
// trg_notify_submission_pending_approver_push (internal reviewer) —
// to pop a real OS-level desktop/phone notification via the Web Push
// protocol, in addition to (not instead of) the existing emails from
// migrations 049/061.
//
// Looks up every push_subscriptions row for the given profile_ids and
// sends the same payload to each. A subscription that the browser has
// revoked (410 Gone / 404 Not Found) is deleted so it stops being
// retried.
//
// Required secrets (same EMAIL_WEBHOOK_SECRET already used by the
// email functions, plus two new VAPID ones):
//   EMAIL_WEBHOOK_SECRET   shared secret, must match app_config.email_webhook_secret
//   VAPID_PUBLIC_KEY       must match VITE_VAPID_PUBLIC_KEY baked into the frontend
//   VAPID_PRIVATE_KEY      keep secret, server-side only
//   VAPID_SUBJECT          (optional) mailto:you@example.com — contact for push services
//
// Deploy with: supabase functions deploy send-push

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const secret = req.headers.get('x-webhook-secret')
    if (!secret || secret !== Deno.env.get('EMAIL_WEBHOOK_SECRET')) {
      return json({ error: 'Unauthorized' }, 401)
    }

    const vapidPublic = Deno.env.get('VAPID_PUBLIC_KEY')
    const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY')
    if (!vapidPublic || !vapidPrivate) {
      return json({ error: 'Push sender not configured' }, 500)
    }
    const vapidSubject = Deno.env.get('VAPID_SUBJECT') || 'mailto:noreply@pawrtal.app'
    webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate)

    const payload = await req.json()
    const { profile_ids, title, body, url } = payload
    if (!Array.isArray(profile_ids) || profile_ids.length === 0) {
      return json({ error: 'Missing profile_ids' }, 400)
    }
    if (!title || !body) return json({ error: 'Missing title/body' }, 400)

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data: subs, error: subsErr } = await admin
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .in('profile_id', profile_ids)

    if (subsErr) return json({ error: 'Subscription lookup failed', detail: subsErr.message }, 500)
    if (!subs || subs.length === 0) {
      return json({ skipped: true, reason: 'No push subscriptions on file for these profiles' })
    }

    const notificationPayload = JSON.stringify({ title, body, url: url || '/' })

    const results = await Promise.allSettled(
      subs.map((s) =>
        webpush.sendNotification(
          {
            endpoint: s.endpoint,
            keys: { p256dh: s.p256dh, auth: s.auth },
          },
          notificationPayload
        )
      )
    )

    // Clean up subscriptions the browser has revoked so we stop retrying them.
    const staleIds: string[] = []
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        const statusCode = (r.reason && (r.reason.statusCode || r.reason.status)) || null
        if (statusCode === 404 || statusCode === 410) staleIds.push(subs[i].id)
      }
    })
    if (staleIds.length > 0) {
      await admin.from('push_subscriptions').delete().in('id', staleIds)
    }

    const sent = results.filter((r) => r.status === 'fulfilled').length
    return json({ sent, attempted: subs.length, staleRemoved: staleIds.length })
  } catch (err) {
    console.error('send-push error', err)
    return json({ error: 'Send failed', detail: String(err) }, 500)
  }
})
