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
    })

    await client.close()

    return json({ sent: true, recipients })
  } catch (err) {
    console.error('notify-status-email error', err)
    return json({ error: 'Send failed', detail: String(err) }, 500)
  }
})
