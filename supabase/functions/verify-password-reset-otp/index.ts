// supabase/functions/verify-password-reset-otp/index.ts
//
// Step 2 of Gmail-based password reset. Public (no login). Takes the
// username, the 6-digit code emailed by send-password-reset-otp, and a
// new password; verifies the most recent unconsumed/unexpired OTP for
// that account, then sets the new password via the admin API.
//
// Deploy with: supabase functions deploy verify-password-reset-otp --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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
const MAX_ATTEMPTS = 5

function toAuthEmail(usernameOrEmail: string) {
  const value = (usernameOrEmail || '').trim().toLowerCase()
  if (value.includes('@')) return value
  return `${value}${AUTH_EMAIL_DOMAIN}`
}

async function sha256Hex(input: string) {
  const data = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const { username, otp, new_password } = await req.json()

    if (!username || !String(username).trim()) return json({ error: 'Username is required.' }, 400)
    if (!otp || !/^\d{6}$/.test(String(otp))) return json({ error: 'Enter the 6-digit code from your email.' }, 400)
    if (!new_password || String(new_password).length < 8) {
      return json({ error: 'Password must be at least 8 characters.' }, 400)
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const authEmail = toAuthEmail(username)
    const { data: target } = await admin
      .from('profiles')
      .select('id, is_active')
      .eq('email', authEmail)
      .maybeSingle()

    // Generic error — don't reveal account existence.
    const invalidMsg = { error: 'That code is invalid or has expired. Please request a new one.' }
    if (!target || !target.is_active) return json(invalidMsg, 400)

    const { data: record } = await admin
      .from('password_reset_otps')
      .select('id, otp_hash, expires_at, attempts, consumed_at')
      .eq('profile_id', target.id)
      .is('consumed_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!record) return json(invalidMsg, 400)
    if (new Date(record.expires_at).getTime() < Date.now()) return json(invalidMsg, 400)
    if (record.attempts >= MAX_ATTEMPTS) return json(invalidMsg, 400)

    const otpHash = await sha256Hex(String(otp))
    if (otpHash !== record.otp_hash) {
      await admin
        .from('password_reset_otps')
        .update({ attempts: record.attempts + 1 })
        .eq('id', record.id)
      return json(invalidMsg, 400)
    }

    // Correct code — consume it, then set the new password.
    await admin.from('password_reset_otps').update({ consumed_at: new Date().toISOString() }).eq('id', record.id)

    const { error: updateErr } = await admin.auth.admin.updateUserById(target.id, {
      password: String(new_password),
    })
    if (updateErr) return json({ error: updateErr.message || 'Could not update password. Please try again.' }, 400)

    await admin.from('profiles').update({ must_change_password: false }).eq('id', target.id)

    return json({ success: true })
  } catch (e) {
    console.error('verify-password-reset-otp error', e)
    return json({ error: 'Unexpected error. Please try again.' }, 500)
  }
})
