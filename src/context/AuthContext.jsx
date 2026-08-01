import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

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
  return value.includes('@') ? value : `${value}${AUTH_EMAIL_DOMAIN}`
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  async function loadProfile(userId) {
    const { data, error } = await supabase
      .from('profiles')
      .select(`
        id, full_name, email, role, photo_url, must_change_password,
        org_memberships:org_memberships ( org_id, position, is_primary, organizations ( name, acronym ) ),
        admin_viewer_scopes ( scope )
      `)
      .eq('id', userId)
      .single()

    if (error) {
      console.error('Failed to load profile', error)
      setProfile(null)
    } else {
      setProfile(data)
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session?.user) loadProfile(session.user.id)
      setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (session?.user) {
        loadProfile(session.user.id)
      } else {
        setProfile(null)
      }
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  async function signIn(username, password) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: toAuthEmail(username),
      password,
    })
    if (error) return { error }
    await loadProfile(data.user.id)
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

  const value = { session, profile, loading, signIn, signOut, completePasswordChange }
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
]

export function isAdminTier(role) {
  return ADMIN_ROLES.includes(role)
}
