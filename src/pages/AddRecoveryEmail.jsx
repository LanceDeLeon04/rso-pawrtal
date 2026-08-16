import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Mail, ShieldAlert } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import './Login.css'

// Kept permissive to match the DB constraint (any real address works —
// some staff use a Google Workspace address rather than @gmail.com).
// The UI language nudges toward Gmail since that's what's supported end
// to end today (Gmail SMTP sender).
const GENERIC_EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

// Mandatory first-login gate — ProtectedRoute redirects here whenever
// profile.recovery_email is empty, before any other page is reachable.
// This is what powers Gmail-based password reset (send-password-reset-otp
// looks this column up), so every account needs one on file.
export default function AddRecoveryEmail() {
  const { updateRecoveryEmail } = useAuth()
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    const value = email.trim()
    if (!GENERIC_EMAIL_RE.test(value)) {
      setError('Enter a valid email address (e.g. name@gmail.com).')
      return
    }

    setSubmitting(true)
    const { error: updateErr } = await updateRecoveryEmail(value)
    setSubmitting(false)

    if (updateErr) {
      setError('Could not save your Gmail address. Please try again.')
      return
    }
    navigate('/dashboard')
  }

  return (
    <div className="login-screen">
      <div className="login-bg" style={{ backgroundImage: "url('/nu-bg-updated.png')" }} />
      <div className="login-bg-overlay" />

      <div className="login-card-wrap">
        <form className="login-card" onSubmit={handleSubmit} noValidate>
          <span className="login-card__chip">
            <ShieldAlert size={14} />
            First-time sign-in
          </span>

          <img src="/pawrtal-logo.png" alt="RSO PAWrtal" className="login-card__logo" />

          <p className="login-card__sub">
            Add your Gmail address so you can reset your password yourself
            next time, without waiting on an SDAO Admin. We'll only use it
            to send you a verification code when you request a reset.
          </p>

          {error && (
            <div className="login-error">
              <ShieldAlert size={16} />
              <span>{error}</span>
            </div>
          )}

          <div className="field">
            <label htmlFor="recovery-email">Gmail address</label>
            <div className="field-input">
              <Mail size={17} />
              <input
                id="recovery-email"
                type="email"
                autoComplete="email"
                placeholder="yourname@gmail.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
          </div>

          <button className="btn-primary" type="submit" disabled={submitting} style={{ marginTop: 6 }}>
            {submitting ? 'Saving…' : 'Save & continue'}
          </button>
        </form>
      </div>
    </div>
  )
}
