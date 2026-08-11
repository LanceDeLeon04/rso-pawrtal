// supabase/functions/notify-status-email/index.ts
//
// Called (fire-and-forget, via pg_net) by the trg_notify_submission_status_email
// trigger every time a row is inserted into submission_status_history — i.e.
// every "checked", "endorsed", "approved", "returned", "rejected", and
// "deadline_extended" step, for both internal reviewer actions and external
// adviser/dean/SDG-rep/marketing-rep decisions, and for reports as well as
// event applications (they all write to the same table).
//
// Sends an update email to BOTH the submitter's NU email and personal email
// via Gmail SMTP using an App Password.
//
// Required secrets (supabase secrets set ...):
//   EMAIL_WEBHOOK_SECRET   shared secret, must match app_config.email_webhook_secret
//   GMAIL_USER             the Gmail address to send from
//   GMAIL_APP_PASSWORD     16-character Gmail App Password (not the account password)
//   SITE_URL                (optional) app base URL for the "view status" link
//
// Deploy with: supabase functions deploy notify-status-email

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

const STAGE_LABELS: Record<string, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  assistant_review: 'SDAO Assistant Review',
  supervisor_endorsement: 'SDAO Supervisor Endorsement',
  director_approval: 'Academic Director Approval',
  approved: 'Approved',
  returned: 'Returned for Revision',
  rejected: 'Rejected',
}

const ACTION_VERBS: Record<string, string> = {
  checked: 'checked and forwarded',
  endorsed: 'endorsed',
  approved: 'approved',
  returned: 'returned for revision',
  rejected: 'rejected',
  deadline_extended: 'given a new deadline',
}

function subjectFor(action: string, title: string) {
  const verb = ACTION_VERBS[action] || action
  return `[RSO Pawrtal] "${title}" was ${verb}`
}

function bodyFor(opts: {
  action: string
  stage: string
  title: string
  orgName: string
  actorName: string | null
  comment: string | null
  siteUrl: string
}) {
  const { action, stage, title, orgName, actorName, comment, siteUrl } = opts
  const verb = ACTION_VERBS[action] || action
  const stageLabel = STAGE_LABELS[stage] || stage
  const by = actorName ? ` by ${actorName}` : ''

  const lines = [
    `Hi,`,
    ``,
    `An update on your submission "${title}" (${orgName}):`,
    ``,
    `Status: ${stageLabel}`,
    `Action: This submission was just ${verb}${by}.`,
  ]

  if (comment && comment.trim()) {
    lines.push(``, `Comment:`, comment.trim())
  }

  lines.push(
    ``,
    `You can check the full status and history of this submission anytime by logging into RSO Pawrtal:`,
    siteUrl,
    ``,
    `This is an automated message — no need to reply. We'll keep emailing both your NU email and personal email as this submission moves through review.`,
    ``,
    `— RSO Pawrtal / SDAO`
  )

  return lines.join('\n')
}

// Status -> accent color for the badge/header in the HTML email.
const STAGE_COLORS: Record<string, { bg: string; text: string; accent: string }> = {
  draft:                  { bg: '#f1f5f9', text: '#475569', accent: '#94a3b8' },
  submitted:              { bg: '#eff6ff', text: '#1d4ed8', accent: '#3b82f6' },
  assistant_review:       { bg: '#fefce8', text: '#a16207', accent: '#eab308' },
  supervisor_endorsement: { bg: '#fefce8', text: '#a16207', accent: '#eab308' },
  director_approval:      { bg: '#fefce8', text: '#a16207', accent: '#eab308' },
  approved:               { bg: '#f0fdf4', text: '#15803d', accent: '#22c55e' },
  returned:               { bg: '#fff7ed', text: '#c2410c', accent: '#f97316' },
  rejected:               { bg: '#fef2f2', text: '#b91c1c', accent: '#ef4444' },
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function htmlBodyFor(opts: {
  action: string
  stage: string
  title: string
  orgName: string
  actorName: string | null
  comment: string | null
  siteUrl: string
}) {
  const { action, stage, title, orgName, actorName, comment, siteUrl } = opts
  const verb = ACTION_VERBS[action] || action
  const stageLabel = STAGE_LABELS[stage] || stage
  const by = actorName ? ` by <strong>${escapeHtml(actorName)}</strong>` : ''
  const colors = STAGE_COLORS[stage] || { bg: '#f1f5f9', text: '#475569', accent: '#64748b' }

  const commentBlock = comment && comment.trim()
    ? `
      <tr>
        <td style="padding:0 32px 24px 32px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-left:3px solid ${colors.accent};border-radius:6px;">
            <tr>
              <td style="padding:14px 18px;">
                <p style="margin:0 0 6px 0;font:600 12px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#64748b;text-transform:uppercase;letter-spacing:.04em;">Comment</p>
                <p style="margin:0;font:400 14px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1e293b;white-space:pre-wrap;">${escapeHtml(comment.trim())}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>`
    : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(subjectFor(action, title))}</title>
</head>
<body style="margin:0;padding:0;background:#eef1f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f5;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">

          <!-- Header -->
          <tr>
            <td style="background:#111827;padding:24px 32px;">
              <span style="font:700 16px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;letter-spacing:.02em;">🐾 RSO Pawrtal</span>
            </td>
          </tr>

          <!-- Status badge -->
          <tr>
            <td style="padding:28px 32px 8px 32px;">
              <span style="display:inline-block;background:${colors.bg};color:${colors.text};font:600 12px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:.03em;text-transform:uppercase;padding:6px 12px;border-radius:999px;">
                ${escapeHtml(stageLabel)}
              </span>
            </td>
          </tr>

          <!-- Title / message -->
          <tr>
            <td style="padding:8px 32px 4px 32px;">
              <p style="margin:0 0 6px 0;font:400 14px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#64748b;">Update on your submission${orgName ? ` &middot; ${escapeHtml(orgName)}` : ''}</p>
              <h1 style="margin:0 0 14px 0;font:700 20px/1.35 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">"${escapeHtml(title)}"</h1>
              <p style="margin:0;font:400 15px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#334155;">
                This submission was just <strong style="color:${colors.text};">${escapeHtml(verb)}</strong>${by}.
              </p>
            </td>
          </tr>

          <tr><td style="height:20px;"></td></tr>
${commentBlock}
          <!-- CTA button -->
          <tr>
            <td style="padding:4px 32px 32px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:8px;background:#111827;">
                    <a href="${siteUrl}" style="display:inline-block;padding:12px 22px;font:600 14px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;text-decoration:none;border-radius:8px;">
                      View submission status
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px 28px 32px;border-top:1px solid #e2e8f0;">
              <p style="margin:0 0 4px 0;font:400 12px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#94a3b8;">
                This is an automated message — no need to reply. We'll email both your NU email and personal email as this submission moves through review.
              </p>
              <p style="margin:0;font:600 12px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#64748b;">
                RSO Pawrtal &middot; SDAO
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
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
    const { submission_id, stage, action, comment, actor_name } = payload
    if (!submission_id || !action) return json({ error: 'Missing submission_id/action' }, 400)

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data: sub, error: subErr } = await admin
      .from('submissions')
      .select('id, title, email, personal_email, organizations ( name )')
      .eq('id', submission_id)
      .single()

    if (subErr || !sub) return json({ error: 'Submission not found', detail: subErr?.message }, 404)

    const recipients = Array.from(
      new Set([sub.email, sub.personal_email].filter((e): e is string => !!e && e.includes('@')))
    )

    if (recipients.length === 0) {
      // Nothing to send to — not an error, just nothing to do.
      return json({ skipped: true, reason: 'No recipient emails on file' })
    }

    const siteUrl = Deno.env.get('SITE_URL') || 'https://pawrtal.app'
    const orgName = (sub as any).organizations?.name || ''
    const subject = subjectFor(action, sub.title)
    const text = bodyFor({
      action,
      stage,
      title: sub.title,
      orgName,
      actorName: actor_name || null,
      comment: comment || null,
      siteUrl,
    })
    const html = htmlBodyFor({
      action,
      stage,
      title: sub.title,
      orgName,
      actorName: actor_name || null,
      comment: comment || null,
      siteUrl,
    })

    const client = new SMTPClient({
      connection: {
        hostname: 'smtp.gmail.com',
        port: 465,
        tls: true,
        auth: { username: gmailUser, password: gmailPass },
      },
    })

    await client.send({
      from: `RSO Pawrtal <${gmailUser}>`,
      to: recipients,
      subject,
      content: text,
      html,
    })

    await client.close()

    return json({ sent: true, recipients })
  } catch (err) {
    console.error('notify-status-email error', err)
    return json({ error: 'Send failed', detail: String(err) }, 500)
  }
})
