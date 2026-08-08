// Tracks whether the current user has acknowledged the Data Privacy
// Notice for the *current* login. This is intentionally sessionStorage
// (not localStorage, and not a one-time flag on the profile row) so
// that:
//   - it survives a page refresh within the same tab/session, but
//   - it does NOT survive signing out and logging back in — the
//     notice must be shown again on every fresh login, and
//   - it does NOT leak across tabs/devices via localStorage.
//
// The permanent, auditable record of acceptance lives in the
// `privacy_consents` table (migration 033) and is written once per
// acceptance regardless of this flag.

const KEY_PREFIX = 'pawrtal_privacy_ack:'

export function hasAcknowledgedPrivacy(userId) {
  if (!userId) return false
  try {
    return sessionStorage.getItem(KEY_PREFIX + userId) === '1'
  } catch {
    return false
  }
}

export function markPrivacyAcknowledged(userId) {
  if (!userId) return
  try {
    sessionStorage.setItem(KEY_PREFIX + userId, '1')
  } catch {
    // sessionStorage unavailable (e.g. private browsing edge cases) —
    // the notice will simply show again, which is the safe failure mode.
  }
}

export function clearPrivacyAcknowledgement(userId) {
  if (!userId) return
  try {
    sessionStorage.removeItem(KEY_PREFIX + userId)
  } catch {
    // no-op
  }
}
