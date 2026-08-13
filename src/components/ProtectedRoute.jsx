import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { hasAcknowledgedPrivacy } from '../lib/privacyNotice'

export default function ProtectedRoute({ children, allowedRoles, excludeRoles, extraAllow }) {
  const { session, profile, loading } = useAuth()

  if (loading) return null

  if (!session) return <Navigate to="/login" replace />

  if (profile?.must_change_password) {
    return <Navigate to="/change-password" replace />
  }

  // Data Privacy Notice must be re-acknowledged on every login before
  // any other page is reachable — see src/pages/PrivacyNotice.jsx.
  if (!hasAcknowledgedPrivacy(session.user.id)) {
    return <Navigate to="/privacy-notice" replace />
  }

  // extraAllow is an escape hatch for access that can't be expressed as
  // a plain role membership check — e.g. an SHS Faculty-Moderator, whose
  // role is 'rso_officer' but who should still reach a Faculty-only
  // route because of an org_membership (see isSHSFacultyModerator).
  if (allowedRoles && profile && !allowedRoles.includes(profile.role) && !(extraAllow && extraAllow(profile))) {
    return <Navigate to="/dashboard" replace />
  }

  // FMO (and any other excluded role) is limited to Dashboard + Calendar —
  // bounce it back to the Calendar rather than a page it can't use.
  if (excludeRoles && profile && excludeRoles.includes(profile.role)) {
    return <Navigate to="/calendar" replace />
  }

  return children
}
