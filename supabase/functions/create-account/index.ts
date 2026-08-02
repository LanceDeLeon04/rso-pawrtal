// supabase/functions/create-account/index.ts
//
// Only admin-tier accounts can create new accounts (per spec). Creating
// another person's auth.users row requires the service-role key, which
// must never reach the browser — hence this runs as an Edge Function.
// Deploy with: supabase functions deploy create-account
// Secrets (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY) are provided
// automatically by the Supabase platform for Edge Functions.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ADMIN_ROLES = [
  'sdao_assistant', 'crso_chairperson', 'qmo',
  'sdao_supervisor', 'academic_director', 'system_admin',
]
const VALID_ROLES = ['rso_officer', ...ADMIN_ROLES]
const VALID_SCOPES = ['events', 'calendar', 'submissions', 'clearance', 'all']

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

function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  let pw = ''
  for (let i = 0; i < 12; i++) pw += chars[Math.floor(Math.random() * chars.length)]
  return pw
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

    // Verify the caller is a signed-in, active, admin-tier user.
    const jwt = authHeader.replace('Bearer ', '')
    const { data: { user }, error: userErr } = await admin.auth.getUser(jwt)
    if (userErr || !user) return json({ error: 'Invalid or expired session.' }, 401)

    const { data: caller } = await admin.from('profiles').select('role, is_active').eq('id', user.id).single()
    if (!caller || !caller.is_active || !ADMIN_ROLES.includes(caller.role)) {
      return json({ error: 'Only admin-tier accounts can create new accounts.' }, 403)
    }

    const body = await req.json()
    const { full_name, username, role, org_id, position, is_primary, viewer_scopes } = body

    if (!full_name?.trim() || !username?.trim() || !role) {
      return json({ error: 'Full name, username, and role are required.' }, 400)
    }
    if (!VALID_ROLES.includes(role)) {
      return json({ error: 'Invalid role.' }, 400)
    }
    if (role === 'rso_officer' && (!org_id || !position?.trim())) {
      return json({ error: 'RSO Officer accounts need an organization and position.' }, 400)
    }
    if (viewer_scopes?.some((s) => !VALID_SCOPES.includes(s))) {
      return json({ error: 'Invalid viewer scope.' }, 400)
    }

    const email = username.includes('@') ? username.trim() : `${username.trim()}@pawrtal.local`
    const tempPassword = generatePassword()

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
    })
    if (createErr) return json({ error: createErr.message }, 400)

    const { error: profileErr } = await admin.from('profiles').insert({
      id: created.user.id,
      full_name: full_name.trim(),
      email,
      role,
      must_change_password: true,
      created_by: user.id,
    })
    if (profileErr) {
      await admin.auth.admin.deleteUser(created.user.id) // roll back the orphaned auth user
      return json({ error: profileErr.message }, 400)
    }

    if (role === 'rso_officer' && org_id && position) {
      const { error: memErr } = await admin.from('org_memberships').insert({
        profile_id: created.user.id,
        org_id,
        position: position.trim(),
        is_primary: is_primary !== false,
      })
      if (memErr) return json({ error: `Account created, but org assignment failed: ${memErr.message}` }, 207)
    }

    if (viewer_scopes?.length) {
      const { error: scopeErr } = await admin.from('admin_viewer_scopes').insert(
        viewer_scopes.map((scope) => ({ profile_id: created.user.id, scope }))
      )
      if (scopeErr) return json({ error: `Account created, but viewer scopes failed: ${scopeErr.message}` }, 207)
    }

    return json({ success: true, email, temp_password: tempPassword })
  } catch (e) {
    return json({ error: e.message || 'Unexpected error.' }, 500)
  }
})
