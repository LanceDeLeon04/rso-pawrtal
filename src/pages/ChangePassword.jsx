import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Lock, ShieldAlert, CheckCircle2 } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import './Login.css'

export default function ChangePassword() {
  const { completePasswordChange } = useAuth()
  const navigate = useNavigate()

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }

    setSubmitting(true)
    const { error: updateError } = await completePasswordChange(password)
    setSubmitting(false)

    if (updateError) {
      setError('Could not update password. Please try again.')
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
            For your account's security, please set a new password before
            continuing to your dashboard.
          </p>

          {error && (
            <div className="login-error">
              <ShieldAlert size={16} />
              <span>{error}</span>
            </div>
          )}

          <div className="field">
            <label htmlFor="password">New password</label>
            <div className="field-input">
              <Lock size={17} />
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                placeholder="At least 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="confirm">Confirm new password</label>
            <div className="field-input">
              <CheckCircle2 size={17} />
              <input
                id="confirm"
                type="password"
                autoComplete="new-password"
                placeholder="Re-enter password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
            </div>
          </div>

          <button className="btn-primary" type="submit" disabled={submitting} style={{ marginTop: 6 }}>
            {submitting ? 'Updating…' : 'Update password & continue'}
          </button>
        </form>
      </div>
    </div>
  )
}
