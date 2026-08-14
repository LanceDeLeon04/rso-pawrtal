// supabase/functions/notify-approver-email/index.ts
//
// Called (fire-and-forget, via pg_net) by two triggers from migration 061:
//   trg_notify_submission_pending_approver  on submission_status_history
//   trg_notify_approval_link_pending        on approval_links
//
// Where notify-status-email (migration 049) emails the SUBMITTER on
// every status change, this function emails whoever's turn it now is
// to act — Academic Director, SDAO Assistant/Supervisor, SDAO-SHS, SHS
// Principal, Executive Director (internal reviewers, looked up by role
// in `profiles`), or an Adviser/Dean/SDG Rep/Marketing Rep/Org
// President/Org Moderator (external, via their approval_links row).
//
// Required secrets (same ones notify-status-email already needs):
//   EMAIL_WEBHOOK_SECRET   shared secret, must match app_config.email_webhook_secret
//   GMAIL_USER             the Gmail address to send from
//   GMAIL_APP_PASSWORD     16-character Gmail App Password
//   SITE_URL                (optional) app base URL
//
// Deploy with: supabase functions deploy notify-approver-email

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
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const STAGE_LABELS: Record<string, string> = {
  assistant_review: 'SDAO Assistant Review',
  supervisor_endorsement: 'SDAO Supervisor Endorsement',
  director_approval: 'Academic Director Approval',
  shs_review: 'SDAO-SHS Review',
  shs_supervisor_endorsement: 'SDAO Supervisor Endorsement',
  shs_principal_approval: 'SHS Principal Approval',
  shs_director_approval: 'Academic Director Approval',
  shs_executive_approval: 'Executive Director Approval',
}

const ROLE_LABELS: Record<string, string> = {
  sdao_assistant: 'SDAO Assistant',
  sdao_supervisor: 'SDAO Supervisor',
  academic_director: 'Academic Director',
  sdao_shs: 'SDAO-SHS',
  shs_principal: 'SHS Principal',
  executive_director: 'Executive Director',
}

const LINK_ROLE_LABELS: Record<string, string> = {
  adviser: 'Adviser',
  dean: 'Dean',
  sdg_rep: 'SDG Representative',
  marketing_rep: 'Marketing Representative',
  org_president: 'Org President',
  org_moderator: 'Org Moderator',
}

function htmlShell(opts: { badge: string; badgeColor: string; title: string; intro: string; bodyLines: string[]; ctaLabel: string; ctaUrl: string }) {
  const { badge, badgeColor, title, intro, bodyLines, ctaLabel, ctaUrl } = opts
  const paras = bodyLines
    .map((l) => `<p style="margin:0 0 10px 0;font:400 15px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#334155;">${l}</p>`)
    .join('')

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:#eef1f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f5;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
        <tr><td style="background:#111827;padding:24px 32px;">
          <span style="font:700 16px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;letter-spacing:.02em;">🐾 RSO Pawrtal</span>
        </td></tr>
        <tr><td style="padding:28px 32px 8px 32px;">
          <span style="display:inline-block;background:${badgeColor}1a;color:${badgeColor};font:600 12px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:.03em;text-transform:uppercase;padding:6px 12px;border-radius:999px;">${escapeHtml(badge)}</span>
        </td></tr>
        <tr><td style="padding:8px 32px 4px 32px;">
          <h1 style="margin:0 0 14px 0;font:700 20px/1.35 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">${escapeHtml(title)}</h1>
          <p style="margin:0 0 10px 0;font:400 15px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#334155;">${intro}</p>
          ${paras}
        </td></tr>
        <tr><td style="height:12px;"></td></tr>
        <tr><td style="padding:4px 32px 32px 32px;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="border-radius:8px;background:#111827;">
              <a href="${ctaUrl}" style="display:inline-block;padding:12px 22px;font:600 14px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;text-decoration:none;border-radius:8px;">${escapeHtml(ctaLabel)}</a>
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
}

async function sendMail(client: any, gmailUser: string, to: string[], subject: string, text: string, html: string) {
  await client.send({ from: `RSO Pawrtal <${gmailUser}>`, to, subject, content: text, html })
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

    const payload = await req.json()
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )
    const siteUrl = Deno.env.get('SITE_URL') || 'https://pawrtal.app'
    const client = new SMTPClient({
      connection: { hostname: 'smtp.gmail.com', port: 465, tls: true, auth: { username: gmailUser, password: gmailPass } },
    })

    if (payload.kind === 'internal_stage') {
      const { submission_id, stage, role_needed } = payload
      if (!submission_id || !stage || !role_needed) return json({ error: 'Missing submission_id/stage/role_needed' }, 400)

      const { data: sub, error: subErr } = await admin
        .from('submissions')
        .select('id, title, organizations ( name )')
        .eq('id', submission_id)
        .single()
      if (subErr || !sub) return json({ error: 'Submission not found', detail: subErr?.message }, 404)

      const { data: reviewers, error: revErr } = await admin
        .from('profiles')
        .select('email, full_name')
        .eq('role', role_needed)
        .eq('is_active', true)
      if (revErr) return json({ error: 'Reviewer lookup failed', detail: revErr.message }, 500)

      const recipients = Array.from(new Set((reviewers || []).map((r) => r.email).filter((e): e is string => !!e && e.includes('@'))))
      if (recipients.length === 0) {
        await client.close()
        return json({ skipped: true, reason: `No active ${role_needed} accounts on file` })
      }

      const orgName = (sub as any).organizations?.name || ''
      const stageLabel = STAGE_LABELS[stage] || stage
      const roleLabel = ROLE_LABELS[role_needed] || role_needed
      const subject = `[RSO Pawrtal] Action needed: "${sub.title}" is waiting on ${roleLabel}`
      const text = [
        `Hi,`,
        ``,
        `"${sub.title}"${orgName ? ` (${orgName})` : ''} has reached the ${stageLabel} stage and is now waiting on your action.`,
        ``,
        `Log in to RSO Pawrtal to review it in Submission Bin:`,
        `${siteUrl}/submissions`,
        ``,
        `— RSO Pawrtal / SDAO`,
      ].join('\n')
      const html = htmlShell({
        badge: stageLabel,
        badgeColor: '#a16207',
        title: `"${escapeHtml(sub.title)}" needs your review`,
        intro: `${orgName ? `<strong>${escapeHtml(orgName)}</strong>'s submission ` : 'A submission '}has reached the <strong>${escapeHtml(stageLabel)}</strong> stage and is now waiting on you as ${escapeHtml(roleLabel)}.`,
        bodyLines: [],
        ctaLabel: 'Review in Submission Bin',
        ctaUrl: `${siteUrl}/submissions`,
      })

      await sendMail(client, gmailUser, recipients, subject, text, html)
      await client.close()
      return json({ sent: true, recipients })
    }

    if (payload.kind === 'external_link') {
      const { link_id } = payload
      if (!link_id) return json({ error: 'Missing link_id' }, 400)

      const { data: link, error: linkErr } = await admin
        .from('approval_links')
        .select('id, role, token, person_name, person_email, submission_id, submissions ( title, organizations ( name ) )')
        .eq('id', link_id)
        .single()
      if (linkErr || !link) return json({ error: 'Approval link not found', detail: linkErr?.message }, 404)
      if (!link.person_email || !link.person_email.includes('@')) {
        await client.close()
        return json({ skipped: true, reason: 'No person_email on link' })
      }

      const title = (link as any).submissions?.title || 'a submission'
      const orgName = (link as any).submissions?.organizations?.name || ''
      const roleLabel = LINK_ROLE_LABELS[link.role] || link.role
      const approveUrl = `${siteUrl}/approve/${link.token}`
      const subject = `[RSO Pawrtal] Please review "${title}" as ${roleLabel}`
      const text = [
        `Hi ${link.person_name || ''},`,
        ``,
        `You've been asked to review "${title}"${orgName ? ` (${orgName})` : ''} as ${roleLabel}.`,
        ``,
        `Open your review link here (valid for 7 days):`,
        approveUrl,
        ``,
        `— RSO Pawrtal / SDAO`,
      ].join('\n')
      const html = htmlShell({
        badge: roleLabel,
        badgeColor: '#1d4ed8',
        title: `Please review "${escapeHtml(title)}"`,
        intro: `Hi ${escapeHtml(link.person_name || '')}, you've been asked to review this submission${orgName ? ` from <strong>${escapeHtml(orgName)}</strong>` : ''} as <strong>${escapeHtml(roleLabel)}</strong>.`,
        bodyLines: [`<span style="color:#64748b;">This link is valid for 7 days.</span>`],
        ctaLabel: 'Open review link',
        ctaUrl: approveUrl,
      })

      await sendMail(client, gmailUser, [link.person_email], subject, text, html)
      await client.close()
      return json({ sent: true, recipients: [link.person_email] })
    }

    await client.close()
    return json({ error: 'Unknown kind' }, 400)
  } catch (err) {
    console.error('notify-approver-email error', err)
    return json({ error: 'Send failed', detail: String(err) }, 500)
  }
})
