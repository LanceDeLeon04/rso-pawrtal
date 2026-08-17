// supabase/functions/notify-curricular-email/index.ts
//
// Called (fire-and-forget, via pg_net) by three triggers from migration
// 074:
//   trg_notify_curricular_code_email       on curricular_activities  (insert)
//   trg_notify_curricular_approver_email   on curricular_approvals   (insert/reissue)
//   trg_notify_curricular_director_email   on curricular_activities  (status -> director_review)
//
// kind = 'code'             -> emails the faculty member their event code
// kind = 'approver'         -> emails the Dean/SDG Rep their review link
// kind = 'director_pending' -> emails every Academic Director that one is waiting
//
// Required secrets (same ones notify-status-email/notify-approver-email need):
//   EMAIL_WEBHOOK_SECRET   shared secret, must match app_config.email_webhook_secret
//   GMAIL_USER             the Gmail address to send from
//   GMAIL_APP_PASSWORD     16-character Gmail App Password
//   SITE_URL               (optional) app base URL
//
// Deploy with: supabase functions deploy notify-curricular-email

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

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

function escapeHtml(s: string) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const ROLE_LABELS: Record<string, string> = { dean: 'Dean', sdg_rep: 'SDG Representative' }

function wrapHtml(headline: string, bodyHtml: string) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#eef1f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f5;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
        <tr><td style="background:#111827;padding:24px 32px;">
          <span style="font:700 16px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;">🐾 RSO Pawrtal &middot; Curricular Activities</span>
        </td></tr>
        <tr><td style="padding:28px 32px 8px 32px;">
          <h1 style="margin:0 0 14px 0;font:700 20px/1.35 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">${escapeHtml(headline)}</h1>
        </td></tr>
        <tr><td style="padding:0 32px 28px 32px;">${bodyHtml}</td></tr>
        <tr><td style="padding:20px 32px 28px 32px;border-top:1px solid #e2e8f0;">
          <p style="margin:0;font:400 12px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#94a3b8;">This is an automated message from RSO Pawrtal / SDAO — no need to reply.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
}

function button(url: string, label: string) {
  return `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:8px;background:#111827;">
    <a href="${url}" style="display:inline-block;padding:12px 22px;font:600 14px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;text-decoration:none;border-radius:8px;">${escapeHtml(label)}</a>
  </td></tr></table>`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const secret = req.headers.get('x-webhook-secret')
    if (!secret || secret !== Deno.env.get('EMAIL_WEBHOOK_SECRET')) {
      return json({ error: 'Unauthorized' }, 401)
    }

    const gmailUser = Deno.env.get('GMAIL_USER')
    const gmailPass = Deno.env.get('GMAIL_APP_PASSWORD')
    if (!gmailUser || !gmailPass) return json({ error: 'Email sender not configured' }, 500)

    const siteUrl = Deno.env.get('SITE_URL') || 'https://pawrtal.app'
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const payload = await req.json()
    const { kind } = payload

    let to: string[] = []
    let subject = ''
    let html = ''
    let text = ''

    if (kind === 'code') {
      const { data: a, error } = await admin
        .from('curricular_activities')
        .select('event_code, title, faculty_name, faculty_email, faculty_personal_email')
        .eq('id', payload.activity_id)
        .single()
      if (error || !a) return json({ error: 'Activity not found' }, 404)

      to = Array.from(
        new Set([a.faculty_email, a.faculty_personal_email].filter((e): e is string => !!e && e.includes('@')))
      )
      if (to.length === 0) return json({ skipped: true, reason: 'No faculty email on file' })

      subject = `[RSO Pawrtal] Your Curricular Activity code: ${a.event_code}`
      text = `Hi ${a.faculty_name},\n\nYour Curricular Activity "${a.title}" was received.\n\nEvent Code: ${a.event_code}\n\nKeep this code — use it on the "Track My Activity" page (${siteUrl}/track) to check its status anytime. It will move through Dean and SDG Representative review (in parallel), then Academic Director approval.\n\nThis is going to both your NU email and personal email, if you gave us one.\n\n— RSO Pawrtal / SDAO`
      html = wrapHtml('Your activity was received', `
        <p style="margin:0 0 16px 0;font:400 15px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#334155;">Hi ${escapeHtml(a.faculty_name)}, your Curricular Activity "<strong>${escapeHtml(a.title)}</strong>" was received and is now with the Dean for review.</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:8px;margin:0 0 20px 0;"><tr><td style="padding:16px 18px;text-align:center;">
          <p style="margin:0 0 6px 0;font:600 12px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#64748b;text-transform:uppercase;letter-spacing:.04em;">Event Code</p>
          <p style="margin:0;font:700 24px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a;letter-spacing:.03em;">${escapeHtml(a.event_code)}</p>
        </td></tr></table>
        <p style="margin:0 0 20px 0;font:400 14px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#334155;">Keep this code — use it to check your activity's status anytime.</p>
        ${button(`${siteUrl}/track`, 'Track My Activity')}
      `)
    } else if (kind === 'approver') {
      const { data: link, error } = await admin
        .from('curricular_approvals')
        .select('role, token, person_name, person_email, curricular_activities ( event_code, title, faculty_name, department, event_date )')
        .eq('id', payload.approval_id)
        .single()
      if (error || !link) return json({ error: 'Approval link not found' }, 404)
      if (!link.person_email) return json({ skipped: true, reason: 'No email on file for this approver' })

      const activity = (link as any).curricular_activities
      const roleLabel = ROLE_LABELS[link.role] || link.role
      const url = `${siteUrl}/curricular/approve/${link.token}`

      to = [link.person_email]
      subject = `[RSO Pawrtal] Review needed: "${activity.title}" (${activity.event_code})`
      text = `Hi ${link.person_name},\n\nA Curricular Activity needs your review as ${roleLabel}:\n\n"${activity.title}" (${activity.event_code})\nSubmitted by: ${activity.faculty_name}${activity.department ? ` — ${activity.department}` : ''}\n\nReview it here: ${url}\n\nThis link expires in 7 days.\n\n— RSO Pawrtal / SDAO`
      html = wrapHtml(`Review needed — ${roleLabel}`, `
        <p style="margin:0 0 8px 0;font:400 14px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#64748b;">Hi ${escapeHtml(link.person_name)}, a Curricular Activity is waiting on your review.</p>
        <h2 style="margin:0 0 6px 0;font:700 18px/1.35 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">"${escapeHtml(activity.title)}"</h2>
        <p style="margin:0 0 20px 0;font:400 14px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#334155;">${escapeHtml(activity.event_code)} &middot; Submitted by ${escapeHtml(activity.faculty_name)}${activity.department ? ` — ${escapeHtml(activity.department)}` : ''}</p>
        ${button(url, `Review as ${roleLabel}`)}
        <p style="margin:16px 0 0 0;font:400 12px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#94a3b8;">This link expires in 7 days.</p>
      `)
    } else if (kind === 'director_pending') {
      const { data: a, error } = await admin
        .from('curricular_activities')
        .select('event_code, title, faculty_name, department')
        .eq('id', payload.activity_id)
        .single()
      if (error || !a) return json({ error: 'Activity not found' }, 404)

      const { data: directors } = await admin
        .from('profiles')
        .select('email')
        .eq('role', 'academic_director')
        .eq('is_active', true)

      to = (directors || []).map((d: any) => d.email).filter(Boolean)
      if (to.length === 0) return json({ skipped: true, reason: 'No active Academic Director accounts' })

      const url = `${siteUrl}/curricular-activities`
      subject = `[RSO Pawrtal] Curricular Activity awaiting your approval: "${a.title}"`
      text = `A Curricular Activity has cleared Dean and SDG Representative review and now needs Academic Director approval:\n\n"${a.title}" (${a.event_code})\nSubmitted by: ${a.faculty_name}${a.department ? ` — ${a.department}` : ''}\n\nReview it here: ${url}\n\n— RSO Pawrtal / SDAO`
      html = wrapHtml('Awaiting your approval', `
        <h2 style="margin:0 0 6px 0;font:700 18px/1.35 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">"${escapeHtml(a.title)}"</h2>
        <p style="margin:0 0 20px 0;font:400 14px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#334155;">${escapeHtml(a.event_code)} &middot; Submitted by ${escapeHtml(a.faculty_name)}${a.department ? ` — ${escapeHtml(a.department)}` : ''}</p>
        ${button(url, 'Open Curricular Activities')}
      `)
    } else {
      return json({ error: 'Unknown kind' }, 400)
    }

    const client = new SMTPClient({
      connection: { hostname: 'smtp.gmail.com', port: 465, tls: true, auth: { username: gmailUser, password: gmailPass } },
    })
    await client.send({ from: `RSO Pawrtal <${gmailUser}>`, to, subject, content: text, html })
    await client.close()

    return json({ sent: true, to })
  } catch (err) {
    console.error('notify-curricular-email error', err)
    return json({ error: 'Send failed', detail: String(err) }, 500)
  }
})
