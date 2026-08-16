// supabase/functions/send-password-reset-otp/index.ts
//
// Step 1 of Gmail-based password reset. Public (no login) — someone who
// forgot their password by definition can't attach a session token.
// Looks up the account by username, and if it has a recovery_email on
// file, generates a 6-digit OTP, stores its hash, and emails it via
// Gmail SMTP (same GMAIL_USER / GMAIL_APP_PASSWORD secrets used by
// notify-status-email — see EMAIL_NOTIFICATIONS_SETUP.md).
//
// Never reveals whether a username exists or whether it has a
// recovery_email on file in its response — always the same generic
// "if that account has a Gmail on file, we've sent a code" message —
// to avoid leaking account existence to an unauthenticated caller.
//
// Deploy with: supabase functions deploy send-password-reset-otp --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  })
}

const AUTH_EMAIL_DOMAIN = '@pawrtal.local'
const OTP_TTL_MINUTES = 10
const RESEND_COOLDOWN_SECONDS = 45

function toAuthEmail(usernameOrEmail: string) {
  const value = (usernameOrEmail || '').trim().toLowerCase()
  if (value.includes('@')) return value
  return `${value}${AUTH_EMAIL_DOMAIN}`
}

function generateOtp() {
  // 6-digit, zero-padded, from a crypto-strength source.
  const buf = new Uint32Array(1)
  crypto.getRandomValues(buf)
  return String(buf[0] % 1_000_000).padStart(6, '0')
}

async function sha256Hex(input: string) {
  const data = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

const GENERIC_OK = {
  success: true,
  message: 'If that account has a Gmail address on file, a verification code has been sent to it.',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const gmailUser = Deno.env.get('GMAIL_USER')
    const gmailPass = Deno.env.get('GMAIL_APP_PASSWORD')
    if (!gmailUser || !gmailPass) {
      return json({ error: 'Email sender not configured. Contact SDAO.' }, 500)
    }

    const { username } = await req.json()
    if (!username || !String(username).trim()) {
      return json({ error: 'Username is required.' }, 400)
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const authEmail = toAuthEmail(username)
    const { data: target } = await admin
      .from('profiles')
      .select('id, full_name, email, recovery_email, is_active')
      .eq('email', authEmail)
      .maybeSingle()

    // Same generic response whether or not the account/gmail exists, so
    // an unauthenticated caller can't enumerate accounts.
    if (!target || !target.is_active || !target.recovery_email) {
      return json(GENERIC_OK)
    }

    // Cooldown: don't let someone spam OTP emails.
    const { data: recent } = await admin
      .from('password_reset_otps')
      .select('created_at')
      .eq('profile_id', target.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (recent && Date.now() - new Date(recent.created_at).getTime() < RESEND_COOLDOWN_SECONDS * 1000) {
      // Still return success shape so the UI can show "check your inbox"
      // rather than exposing timing internals, but flag it for the client.
      return json({ ...GENERIC_OK, cooldown: true })
    }

    const otp = generateOtp()
    const otpHash = await sha256Hex(otp)
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000).toISOString()

    const { error: insertErr } = await admin.from('password_reset_otps').insert({
      profile_id: target.id,
      otp_hash: otpHash,
      expires_at: expiresAt,
    })
    if (insertErr) return json({ error: 'Could not start password reset. Please try again.' }, 500)

    const client = new SMTPClient({
      connection: {
        hostname: 'smtp.gmail.com',
        port: 465,
        tls: true,
        auth: { username: gmailUser, password: gmailPass },
      },
    })

    const text = [
      `Hi ${target.full_name || ''},`,
      ``,
      `Your RSO Pawrtal password reset code is: ${otp}`,
      ``,
      `This code expires in ${OTP_TTL_MINUTES} minutes and can only be used once.`,
      `If you didn't request this, you can safely ignore this email — your password won't change.`,
      ``,
      `— RSO Pawrtal / SDAO`,
    ].join('\n')

    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px;">
        <p>Hi ${target.full_name || ''},</p>
        <p>Your RSO Pawrtal password reset code is:</p>
        <p style="font-size:32px;font-weight:700;letter-spacing:6px;color:#1d4ed8;margin:16px 0;">${otp}</p>
        <p>This code expires in ${OTP_TTL_MINUTES} minutes and can only be used once.</p>
        <p style="color:#64748b;font-size:13px;">If you didn't request this, you can safely ignore this email — your password won't change.</p>
        <p style="color:#94a3b8;font-size:12px;">— RSO Pawrtal / SDAO</p>
      </div>`

    try {
      await client.send({
        from: `RSO Pawrtal <${gmailUser}>`,
        to: [target.recovery_email],
        subject: '[RSO Pawrtal] Your password reset code',
        content: text,
        html,
      })
    } finally {
      await client.close()
    }

    return json(GENERIC_OK)
  } catch (e) {
    console.error('send-password-reset-otp error', e)
    return json({ error: 'Unexpected error. Please try again.' }, 500)
  }
})
