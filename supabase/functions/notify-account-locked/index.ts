// supabase/functions/notify-account-locked/index.ts
//
// Called (fire-and-forget, via pg_net) by record_failed_login() in
// migration 083, the moment an account transitions from "3 wrong
// attempts -> 30 min cooldown" into a second round of 3 wrong
// attempts and gets locked.
//
// Emails every active SDAO Administrator (ADMIN_ROLES, see
// AuthContext.jsx) so they know which account locked and can expect a
// reset request from that person. The account holder themselves is
// never emailed here — Login.jsx already tells them on-screen to
// contact their SDAO Administrator.
//
// Required secrets (same ones notify-status-email/notify-approver-email
// already need):
//   EMAIL_WEBHOOK_SECRET   shared secret, must match app_config.email_webhook_secret
//   GMAIL_USER             the Gmail address to send from
//   GMAIL_APP_PASSWORD     16-character Gmail App Password
//   SITE_URL                (optional) app base URL
//
// Deploy with: supabase functions deploy notify-account-locked

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
}

// Same admin tier as ADMIN_ROLES in src/context/AuthContext.jsx —
// kept as a literal list here since Edge Functions can't import
// frontend source.
const ADMIN_ROLES = [
  'sdao_assistant',
  'crso_chairperson',
  'qmo',
  'sdao_supervisor',
  'academic_director',
  'system_admin',
  'executive_director',
]

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  })
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
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
    if (!gmailUser || !gmailPass) {
      return json({ error: 'Email sender not configured' }, 500)
    }

    const { profile_id } = await req.json()
    if (!profile_id) return json({ error: 'Missing profile_id' }, 400)

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )
    const siteUrl = Deno.env.get('SITE_URL') || 'https://pawrtal.app'

    const { data: locked, error: lockedErr } = await admin
      .from('profiles')
      .select('id, full_name, email, role, locked_at')
      .eq('id', profile_id)
      .single()
    if (lockedErr || !locked) return json({ error: 'Account not found', detail: lockedErr?.message }, 404)

    const { data: admins, error: adminsErr } = await admin
      .from('profiles')
      .select('email, full_name')
      .in('role', ADMIN_ROLES)
      .eq('is_active', true)
    if (adminsErr) return json({ error: 'Administrator lookup failed', detail: adminsErr.message }, 500)

    const recipients = Array.from(new Set((admins || []).map((a) => a.email).filter((e): e is string => !!e && e.includes('@'))))

    const client = new SMTPClient({
      connection: { hostname: 'smtp.gmail.com', port: 465, tls: true, auth: { username: gmailUser, password: gmailPass } },
    })

    if (recipients.length === 0) {
      await client.close()
      return json({ skipped: true, reason: 'No active SDAO Administrator accounts on file' })
    }

    const lockedAt = locked.locked_at ? new Date(locked.locked_at) : new Date()
    const subject = `[RSO Pawrtal] Account locked: ${locked.full_name}`
    const text = [
      `Hi,`,
      ``,
      `${locked.full_name}'s account (${locked.email}) has been locked after repeated incorrect password attempts.`,
      ``,
      `They were shown a message on-screen asking them to contact an SDAO Administrator for a reset.`,
      ``,
      `Go to Accounts in RSO Pawrtal to review and reset the lock:`,
      `${siteUrl}/accounts`,
      ``,
      `Locked at: ${lockedAt.toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}`,
      ``,
      `— RSO Pawrtal / SDAO`,
    ].join('\n')
    const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#eef1f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f5;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
        <tr><td style="background:#111827;padding:24px 32px;">
          <span style="font:700 16px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;letter-spacing:.02em;">🐾 RSO Pawrtal</span>
        </td></tr>
        <tr><td style="padding:28px 32px 8px 32px;">
          <span style="display:inline-block;background:#dc26261a;color:#dc2626;font:600 12px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:.03em;text-transform:uppercase;padding:6px 12px;border-radius:999px;">Account locked</span>
        </td></tr>
        <tr><td style="padding:8px 32px 4px 32px;">
          <h1 style="margin:0 0 14px 0;font:700 20px/1.35 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">${escapeHtml(locked.full_name)}'s account was locked</h1>
          <p style="margin:0 0 10px 0;font:400 15px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#334155;">After a 30-minute cooldown from an earlier round of incorrect attempts, <strong>${escapeHtml(locked.email)}</strong> received another 3 incorrect password attempts and has been locked for security reasons.</p>
          <p style="margin:0 0 10px 0;font:400 15px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#334155;">The person was told on-screen to contact an SDAO Administrator to have it reset.</p>
        </td></tr>
        <tr><td style="height:12px;"></td></tr>
        <tr><td style="padding:4px 32px 32px 32px;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="border-radius:8px;background:#111827;">
              <a href="${siteUrl}/accounts" style="display:inline-block;padding:12px 22px;font:600 14px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;text-decoration:none;border-radius:8px;">Review in Accounts</a>
            </td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:20px 32px 28px 32px;border-top:1px solid #e2e8f0;">
          <p style="margin:0;font:400 12px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#94a3b8;">This is an automated message — no need to reply.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

    await client.send({ from: `RSO Pawrtal <${gmailUser}>`, to: recipients, subject, content: text, html })
    await client.close()

    await admin.from('profiles').update({ lock_notified_at: new Date().toISOString() }).eq('id', profile_id)

    return json({ sent: true, recipients })
  } catch (err) {
    return json({ error: 'Unexpected error', detail: String(err) }, 500)
  }
})
