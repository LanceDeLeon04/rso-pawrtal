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
// SDAO-SHS and SHS Principal are allowed to call this function too (see
// SHS_REVIEWER_ROLES below), but only ever to create 'rso_officer' (SHS
// org accounts) or 'shs_faculty' accounts — never anything from
// ADMIN_ROLES/OTHER_CREATABLE_ROLES. That narrower allow-list is
// enforced separately below, after the caller-role check.
const SHS_REVIEWER_ROLES = ['sdao_shs', 'shs_principal']
// Keep in sync with OTHER_CREATABLE_ROLES in src/pages/Accounts.jsx — that
// dropdown offers 'executive_director', 'sdao_shs', and 'shs_principal' as
// selectable roles. 'executive_director' was missing here originally, and
// then 'sdao_shs'/'shs_principal' were missed again when the SHS
// sub-system (migrations 052a/052b) added them — each time, every attempt
// to create that role was rejected with "Invalid role." (surfaced
// client-side only as a generic "Could not create the account" error) and
// no account was ever created.
const VALID_ROLES = ['rso_officer', 'fmo', 'executive_director', 'sdao_shs', 'shs_principal', 'shs_faculty', ...ADMIN_ROLES]
// Roles SDAO-SHS / SHS Principal are allowed to hand out — SHS org
// accounts and SHS Faculty accounts only (migration 054/055).
const SHS_REVIEWER_CREATABLE_ROLES = ['rso_officer', 'shs_faculty']
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
  // Fixed default per SDAO's account-creation policy — every new account
  // (and every password reset) starts on this password and must be
  // changed on first sign-in (must_change_password is always set true).
  return 'password123'
}

// RSO accounts belong to a *position* (e.g. "SCS-SC President"), not a
// person — the login username is derived from org acronym + position so
// it's stable and predictable, and can't drift from whatever a person
// happens to type. Slugify: lowercase, spaces/punctuation -> single dashes.
function slugify(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
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
    const callerIsAdmin = caller?.is_active && ADMIN_ROLES.includes(caller.role)
    const callerIsShsReviewer = caller?.is_active && SHS_REVIEWER_ROLES.includes(caller.role)
    if (!callerIsAdmin && !callerIsShsReviewer) {
      return json({ error: 'Only admin-tier accounts can create new accounts.' }, 403)
    }

    const body = await req.json()
    const { full_name, username, role, org_id, position, is_primary, viewer_scopes, is_faculty_moderator } = body

    if (!full_name?.trim() || !role) {
      return json({ error: 'Full name and role are required.' }, 400)
    }
    if (!VALID_ROLES.includes(role)) {
      return json({ error: 'Invalid role.' }, 400)
    }
    // Faculty-Moderator: submitted from the SHS Faculty form's "Also a
    // Moderator?" checkbox. Role must still be 'rso_officer' (it's
    // fundamentally the org's Moderator — see migration 057) but it's
    // created with a personal username like Faculty, not an
    // org+position-derived one, so it's handled as its own branch below
    // rather than falling into either the RSO or personal-account path.
    if (is_faculty_moderator && role !== 'rso_officer') {
      return json({ error: 'Faculty-Moderator accounts must have role rso_officer.' }, 400)
    }
    // SDAO-SHS / SHS Principal get a much narrower allow-list than full
    // admin-tier callers — they can only ever create SHS org accounts or
    // SHS Faculty accounts, never another admin/FMO/Executive Director.
    if (callerIsShsReviewer && !SHS_REVIEWER_CREATABLE_ROLES.includes(role)) {
      return json({ error: 'SDAO-SHS and the SHS Principal can only create RSO/Moderator or SHS Faculty accounts.' }, 403)
    }
    if (callerIsShsReviewer && role === 'rso_officer' && org_id) {
      const { data: org } = await admin.from('organizations').select('department').eq('id', org_id).single()
      if (!org || org.department !== 'shs') {
        return json({ error: 'SDAO-SHS and the SHS Principal can only create accounts for SHS organizations.' }, 403)
      }
    }
    if (viewer_scopes?.some((s) => !VALID_SCOPES.includes(s))) {
      return json({ error: 'Invalid viewer scope.' }, 400)
    }

    let email
    let usernameSlug
    // Position actually used to create the org_membership row below.
    // Forced to 'Moderator' for the Faculty-Moderator branch regardless
    // of whatever the client sent, since that's the only position this
    // creation path is allowed to hand out.
    let effectivePosition = position

    if (is_faculty_moderator) {
      // ---------- FACULTY-MODERATOR (personal username + Moderator membership) ----------
      // Same personal-username shape as the plain SHS Faculty branch
      // below, but also links an org_memberships row so this account is
      // fundamentally the org's Moderator (role stays 'rso_officer' —
      // see migration 057 / isSHSFacultyModerator in AuthContext.jsx).
      if (!username?.trim()) {
        return json({ error: 'Username is required.' }, 400)
      }
      if (username.includes('@')) {
        return json({ error: 'Username should not include "@" — accounts use username@pawrtal.local.' }, 400)
      }
      if (!org_id) {
        return json({ error: 'Select which SHS RSO this faculty member moderates.' }, 400)
      }

      const { data: org, error: orgErr } = await admin
        .from('organizations')
        .select('id, department')
        .eq('id', org_id)
        .single()
      if (orgErr || !org) return json({ error: 'Organization not found.' }, 400)
      if (org.department !== 'shs') {
        return json({ error: 'Faculty-Moderator accounts can only be linked to an SHS RSO.' }, 400)
      }

      effectivePosition = 'Moderator'
      const { data: existingMembership } = await admin
        .from('org_memberships')
        .select('id, profiles ( full_name )')
        .eq('org_id', org_id)
        .eq('position', effectivePosition)
        .maybeSingle()
      if (existingMembership) {
        const holder = existingMembership.profiles?.full_name
        return json({
          error: `This org already has a Moderator account${holder ? ` (${holder})` : ''}. `
            + 'Edit the current holder\'s name instead of creating a new one.',
        }, 409)
      }

      usernameSlug = username.trim()
      email = `${usernameSlug}@pawrtal.local`
    } else if (role === 'rso_officer') {
      // ---------- POSITION-BASED (RSO) ----------
      // The account belongs to the position, not whoever currently holds
      // it. Username is always derived server-side from org + position —
      // never taken from client input — so it can't be spoofed or
      // mistyped, and stays stable when the holder changes.
      if (!org_id || !position?.trim()) {
        return json({ error: 'RSO accounts need an organization and a position.' }, 400)
      }

      const { data: org, error: orgErr } = await admin
        .from('organizations')
        .select('id, acronym, department')
        .eq('id', org_id)
        .single()
      if (orgErr || !org) return json({ error: 'Organization not found.' }, 400)

      // SHS Moderator accounts only come from the Faculty-Moderator
      // branch above (is_faculty_moderator: true) — this plain RSO path
      // is deliberately blocked for position "Moderator" on an SHS org
      // so it can't be created with an org+position-derived username
      // (bypassing the personal-username + Venue Request wiring).
      if (org.department === 'shs' && position.trim() === 'Moderator') {
        return json({ error: 'Create this org\'s Moderator from "Create SHS Faculty Account" instead (check "Also a Moderator?").' }, 400)
      }

      // One account per org+position. If it already exists, the caller
      // should rename the current holder instead of creating a duplicate.
      const { data: existingMembership } = await admin
        .from('org_memberships')
        .select('id, profiles ( full_name )')
        .eq('org_id', org_id)
        .eq('position', position.trim())
        .maybeSingle()
      if (existingMembership) {
        const holder = existingMembership.profiles?.full_name
        return json({
          error: `An account for this position already exists${holder ? ` (currently held by ${holder})` : ''}. ` +
            'Edit the current holder\'s name instead of creating a new account.',
        }, 409)
      }

      effectivePosition = position.trim()
      usernameSlug = `${slugify(org.acronym)}.${slugify(effectivePosition)}`
      email = `${usernameSlug}@pawrtal.local`
    } else {
      // ---------- PERSONAL (SDAO / Admins / Academic Directors / Faculty / etc) ----------
      if (!username?.trim()) {
        return json({ error: 'Username is required.' }, 400)
      }
      if (username.includes('@')) {
        return json({ error: 'Username should not include "@" — accounts use username@pawrtal.local.' }, 400)
      }
      usernameSlug = username.trim()
      email = `${usernameSlug}@pawrtal.local`
    }

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

    if (role === 'rso_officer') {
      const { error: memErr } = await admin.from('org_memberships').insert({
        profile_id: created.user.id,
        org_id,
        position: effectivePosition.trim(),
        is_primary: is_primary !== false,
      })
      if (memErr) {
        // Roll back fully — a position account with no membership row is
        // not a valid RSO account and would just confuse the next attempt.
        await admin.from('profiles').delete().eq('id', created.user.id)
        await admin.auth.admin.deleteUser(created.user.id)
        return json({ error: `Could not link this account to the position: ${memErr.message}` }, 400)
      }
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
