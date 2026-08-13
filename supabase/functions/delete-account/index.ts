// supabase/functions/delete-account/index.ts
//
// Deletes an account entirely: the auth.users row, which cascades to
// profiles (profiles.id references auth.users(id) on delete cascade),
// which in turn cascades to org_memberships, admin_viewer_scopes, and
// profile_tags. Needs the service-role key, hence an Edge Function.
// Deploy with: supabase functions deploy delete-account

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ADMIN_ROLES = [
  'sdao_assistant', 'crso_chairperson', 'qmo',
  'sdao_supervisor', 'academic_director', 'system_admin',
]
// SDAO-SHS / SHS Principal may also delete accounts, but only the ones
// they're allowed to create in the first place — see create-account.
const SHS_REVIEWER_ROLES = ['sdao_shs', 'shs_principal']
const SHS_REVIEWER_MANAGEABLE_ROLES = ['rso_officer', 'shs_faculty']

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
    const callerIsAdmin = caller?.is_active && ADMIN_ROLES.includes(caller.role)
    const callerIsShsReviewer = caller?.is_active && SHS_REVIEWER_ROLES.includes(caller.role)
    if (!callerIsAdmin && !callerIsShsReviewer) {
      return json({ error: 'Only admin-tier accounts can delete accounts.' }, 403)
    }

    const { profile_id } = await req.json()
    if (!profile_id) return json({ error: 'profile_id is required.' }, 400)

    if (profile_id === user.id) {
      return json({ error: "You can't delete your own account while signed in as it." }, 400)
    }

    const { data: target } = await admin.from('profiles').select('id, role, full_name').eq('id', profile_id).single()
    if (!target) return json({ error: 'Account not found.' }, 404)

    if (callerIsShsReviewer && !SHS_REVIEWER_MANAGEABLE_ROLES.includes(target.role)) {
      return json({ error: 'SDAO-SHS and the SHS Principal can only manage SHS RSO/Moderator or SHS Faculty accounts.' }, 403)
    }

    // Guard rail: never let the last remaining system_admin be deleted —
    // that would lock everyone out of account management entirely.
    if (target.role === 'system_admin') {
      const { count } = await admin
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'system_admin')
        .eq('is_active', true)
      if ((count ?? 0) <= 1) {
        return json({ error: 'Cannot delete the last remaining System Admin account.' }, 400)
      }
    }

    const { error: delErr } = await admin.auth.admin.deleteUser(profile_id)
    if (delErr) return json({ error: delErr.message }, 400)

    return json({ success: true })
  } catch (e) {
    return json({ error: e.message || 'Unexpected error.' }, 500)
  }
})
