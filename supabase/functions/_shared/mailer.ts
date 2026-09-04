// supabase/functions/_shared/mailer.ts
//
// Shared by every notify-*/send-* Edge Function that emails people.
//
// Routing rule:
//   - NU accounts (email ends in an address in NU_EMAIL_DOMAINS, e.g.
//     someone@nu-laguna.edu.ph) -> sent via Resend.
//   - Everyone else (personal Gmail/Outlook/etc.) -> sent via Gmail SMTP,
//     same as before.
//   - If Resend is not configured, errors, or is rate-limited/maxed out
//     (HTTP 429, or any non-2xx), the NU-bound email automatically falls
//     back to the same Gmail SMTP path. Nothing is ever silently dropped
//     because of a Resend problem.
//
// Required secrets:
//   GMAIL_USER            the Gmail address to send from (fallback + all
//                          non-NU recipients)
//   GMAIL_APP_PASSWORD    16-character Gmail App Password
//   RESEND_API_KEY        Resend API key (optional — if unset, NU mail
//                          just goes straight to the Gmail fallback)
//   RESEND_FROM           "Display Name <address@yourdomain.com>" to send
//                          NU mail from via Resend (must be a
//                          Resend-verified sender/domain)

import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

// Add more campus domains here if RSO Pawrtal ever spans other NU campuses.
const NU_EMAIL_DOMAINS = ['nu-laguna.edu.ph', 'students.nu-laguna.edu.ph']

export function isNuEmail(email: string): boolean {
  const lower = (email || '').trim().toLowerCase()
  return NU_EMAIL_DOMAINS.some((domain) => lower.endsWith('@' + domain))
}

export function splitByProvider(recipients: string[]): { nu: string[]; other: string[] } {
  const nu: string[] = []
  const other: string[] = []
  for (const email of recipients) {
    if (!email) continue
    if (isNuEmail(email)) nu.push(email)
    else other.push(email)
  }
  return { nu, other }
}

interface SendArgs {
  to: string[]
  subject: string
  text: string
  html: string
}

interface SmartMailConfig {
  fromName?: string
  gmailUser?: string
  gmailPass?: string
  resendApiKey?: string
  resendFrom?: string
}

async function sendViaGmail(cfg: SmartMailConfig, args: SendArgs) {
  if (!cfg.gmailUser || !cfg.gmailPass) {
    throw new Error('Gmail sender not configured (GMAIL_USER/GMAIL_APP_PASSWORD missing)')
  }
  const client = new SMTPClient({
    connection: {
      hostname: 'smtp.gmail.com',
      port: 465,
      tls: true,
      auth: { username: cfg.gmailUser, password: cfg.gmailPass },
    },
  })
  try {
    await client.send({
      from: `${cfg.fromName || 'RSO Pawrtal'} <${cfg.gmailUser}>`,
      to: args.to,
      subject: args.subject,
      content: args.text,
      html: args.html,
    })
  } finally {
    await client.close()
  }
}

async function sendViaResend(cfg: SmartMailConfig, args: SendArgs) {
  if (!cfg.resendApiKey || !cfg.resendFrom) {
    throw new Error('Resend not configured (RESEND_API_KEY/RESEND_FROM missing)')
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: cfg.resendFrom,
      to: args.to,
      subject: args.subject,
      text: args.text,
      html: args.html,
    }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    // Covers both "maxed out" (429 — over plan quota / rate limit) and any
    // other Resend failure; caller falls back to Gmail either way.
    throw new Error(`Resend responded ${res.status}: ${detail}`)
  }
  return res.json().catch(() => ({}))
}

export interface SendResult {
  channel: 'resend' | 'gmail' | 'gmail-fallback'
  to: string[]
}

/**
 * Sends one email to a mixed list of recipients, routing NU addresses
 * through Resend (falling back to Gmail if Resend fails/isn't set up)
 * and everyone else straight through Gmail.
 */
export async function sendSmartMail(cfg: SmartMailConfig, args: SendArgs): Promise<SendResult[]> {
  const { nu, other } = splitByProvider(args.to)
  const results: SendResult[] = []

  if (nu.length > 0) {
    let sentViaResend = false
    try {
      await sendViaResend(cfg, { ...args, to: nu })
      results.push({ channel: 'resend', to: nu })
      sentViaResend = true
    } catch (err) {
      console.error('Resend send failed/unavailable, falling back to Gmail for NU recipients:', err)
    }
    if (!sentViaResend) {
      await sendViaGmail(cfg, { ...args, to: nu })
      results.push({ channel: 'gmail-fallback', to: nu })
    }
  }

  if (other.length > 0) {
    await sendViaGmail(cfg, { ...args, to: other })
    results.push({ channel: 'gmail', to: other })
  }

  return results
}
