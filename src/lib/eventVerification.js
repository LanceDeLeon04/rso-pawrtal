import { supabase } from './supabaseClient'

export function verificationLinkUrl(token) {
  return `${window.location.origin}/verify/${token}`
}

// Called at the moment an event application is approved. Stamps the
// event with approved_by/approved_at and makes sure it has a
// verification_token (reuses the existing one if this is a
// re-approval, so a previously printed QR code never breaks).
// Returns { data, error } where data is the updated events row.
export async function ensureEventVerificationToken(eventId) {
  const { data, error } = await supabase.rpc('ensure_event_verification_token', {
    p_event_id: eventId,
  })
  return { data, error }
}

// Public — resolves a verification token into the small set of fields
// shown on the /verify/:token page. Used by that page only.
export async function fetchEventVerification(token) {
  const { data, error } = await supabase.rpc('get_event_verification', {
    p_token: token,
  })
  return { data, error }
}
