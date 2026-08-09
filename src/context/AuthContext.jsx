import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { clearPrivacyAcknowledgement } from '../lib/privacyNotice'

const AuthContext = createContext(null)

// Supabase's auth.users.email column requires a valid email format, but
// PAWrtal accounts log in with a bare username (see seed SQL + Login.jsx).
// This hidden suffix is appended automatically so the bare username the
// person types turns into a valid address before it ever reaches
// Supabase's auth layer. It must match the domain used when the
// auth.users rows were seeded.
const AUTH_EMAIL_DOMAIN = '@pawrtal.local'

function toAuthEmail(usernameOrEmail) {
  const value = (usernameOrEmail || '').trim()
  if (value.includes('@')) return value.toLowerCase()
  return `${value.toLowerCase()}${AUTH_EMAIL_DOMAIN}`
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  async function loadProfile(userId) {
    const { data, error } = await supabase
      .from('profiles')
      .select(`
        id, full_name, email, role, photo_url, must_change_password, is_active,
        org_memberships:org_memberships ( org_id, position, is_primary, organizations ( name, acronym, category, logo_url, adviser_name, accreditation_status, contact_email, contact_number, is_active ) ),
        admin_viewer_scopes ( scope )
      `)
      .eq('id', userId)
      .single()

    if (error) {
      console.error('Failed to load profile', error)
      setProfile(null)
      return null
    }
    setProfile(data)
    return data
  }

  // If an admin deactivates an account, this signs it out immediately —
  // both on explicit sign-in and on any existing/refreshed session.
  async function enforceActive(loadedProfile) {
    if (loadedProfile && loadedProfile.is_active === false) {
      await supabase.auth.signOut()
      setSession(null)
      setProfile(null)
      return false
    }
    return true
  }

  useEffect(() => {
    let cancelled = false

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (cancelled) return
      setSession(session)
      if (session?.user) {
        const p = await loadProfile(session.user.id)
        await enforceActive(p)
      }
      setLoading(false)
    })

    // IMPORTANT: never call another Supabase method (e.g. supabase.from(...))
    // directly/synchronously inside onAuthStateChange. GoTrue can fire this
    // callback while it still holds an internal Web Locks lock (e.g. during
    // a token refresh), and making another Supabase call in that same tick
    // deadlocks the client — the request never even leaves the browser, it
    // just hangs forever waiting on the lock. This is why login worked once
    // but silently hung after the page sat idle and the token had to
    // auto-refresh on reload. Deferring with setTimeout(...,0) escapes that
    // lock context before touching the client again.
    // See: https://github.com/supabase/supabase-js/issues/2111 and
    // https://github.com/supabase/supabase-js/issues/1401
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return
      setSession(session)
      if (session?.user) {
        setTimeout(async () => {
          if (cancelled) return
          const p = await loadProfile(session.user.id)
          if (cancelled) return
          await enforceActive(p)
        }, 0)
      } else {
        setProfile(null)
      }
    })

    return () => {
      cancelled = true
      listener.subscription.unsubscribe()
    }
  }, [])

  async function signIn(username, password) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: toAuthEmail(username),
      password,
    })
    if (error) return { error }

    // Force the Data Privacy Notice to show again for this fresh login,
    // even if this browser tab previously had it acknowledged (e.g. a
    // different user logging in on a shared machine, or this user
    // logging back in after signing out).
    clearPrivacyAcknowledgement(data.user.id)

    const loadedProfile = await loadProfile(data.user.id)
    const stillActive = await enforceActive(loadedProfile)
    if (!stillActive) {
      return { error: { message: 'ACCOUNT_DEACTIVATED' } }
    }
    return { data }
  }

  async function signOut() {
    await supabase.auth.signOut()
    setProfile(null)
  }

  async function completePasswordChange(newPassword) {
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) return { error }
    await supabase
      .from('profiles')
      .update({ must_change_password: false })
      .eq('id', session.user.id)
    await loadProfile(session.user.id)
    return { success: true }
  }

  async function refreshProfile() {
    if (session?.user) await loadProfile(session.user.id)
  }

  const value = { session, profile, loading, signIn, signOut, completePasswordChange, refreshProfile }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

// Role helpers, used across the app for gating UI + queries.
export const ADMIN_ROLES = [
  'sdao_assistant',
  'crso_chairperson',
  'qmo',
  'sdao_supervisor',
  'academic_director',
  'system_admin',
  'executive_director',
]

export function isAdminTier(role) {
  return ADMIN_ROLES.includes(role)
}

// FMO (Facilities Management Office) — a limited tier, not admin.
// Access is restricted to Dashboard + Calendar (see Layout.jsx /
// App.jsx), but on the calendar it can block venue dates and
// reschedule bookings.
export function isFMO(role) {
  return role === 'fmo'
}

// Executive Director — top-tier "personal account" role, same as FMO in
// that it's not built for broad UI navigation. Access is intentionally
// limited to Dashboard (full analytics, since it's in ADMIN_ROLES),
// Calendar, and Submission Bin (where it can bypass-approve any
// submission at any stage — see SubmissionBin.jsx). Every other admin
// route (Accounts, Templates, Clearance, Assignments) explicitly
// excludes it — see App.jsx.
export function isExecutiveDirector(role) {
  return role === 'executive_director'
}
