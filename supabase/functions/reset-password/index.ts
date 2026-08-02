// supabase/functions/reset-password/index.ts
//
// Resets an existing account's password back to the fixed SDAO default
// ("password123") and flags must_change_password so the holder is forced
// to set a new one on their next sign-in. Needs the service-role key,
// hence an Edge Function. Deploy with: supabase functions deploy reset-password

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ADMIN_ROLES = [
  'sdao_assistant', 'crso_chairperson', 'qmo',
  'sdao_supervisor', 'academic_director', 'system_admin',
]

const DEFAULT_PASSWORD = 'password123'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Missing authorization header.' }, 401)

    const admin = createClient(
      Deno.env.get('SUPABASE_URL'),
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    )

    const jwt = authHeader.replace('Bearer ', '')
    const { data: { user }, error: userErr } = await admin.auth.getUser(jwt)
    if (userErr || !user) return json({ error: 'Invalid or expired session.' }, 401)

    const { data: caller } = await admin.from('profiles').select('role, is_active').eq('id', user.id).single()
    if (!caller || !caller.is_active || !ADMIN_ROLES.includes(caller.role)) {
      return json({ error: 'Only admin-tier accounts can reset passwords.' }, 403)
    }

    const { profile_id } = await req.json()
    if (!profile_id) return json({ error: 'profile_id is required.' }, 400)

    const { data: target } = await admin.from('profiles').select('id, email').eq('id', profile_id).single()
    if (!target) return json({ error: 'Account not found.' }, 404)

    const { error: updateErr } = await admin.auth.admin.updateUserById(profile_id, {
      password: DEFAULT_PASSWORD,
    })
    if (updateErr) return json({ error: updateErr.message }, 400)

    await admin.from('profiles').update({ must_change_password: true }).eq('id', profile_id)

    return json({ success: true, email: target.email, temp_password: DEFAULT_PASSWORD })
  } catch (e) {
    return json({ error: e.message || 'Unexpected error.' }, 500)
  }
})
