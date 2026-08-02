import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { User, Lock, Eye, EyeOff, AlertCircle, ShieldCheck, Loader2 } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import './Login.css'

export default function Login() {
  const { signIn } = useAuth()
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSubmitting(true)

    const { data, error: signInError } = await signIn(email, password)

    setSubmitting(false)

    if (signInError) {
      setError(
        signInError.message === 'ACCOUNT_DEACTIVATED'
          ? 'This account has been deactivated. Please contact SDAO.'
          : 'Incorrect email or password. Please try again.'
      )
      return
    }

    if (data?.user) {
      navigate('/dashboard')
    }
  }

  return (
    <div className="login-screen">
      <div className="login-bg" style={{ backgroundImage: "url('/nu-bg-updated.png')" }} />
      <div className="login-bg-overlay" />

      <div className="login-card-wrap">
        <form className="login-card" onSubmit={handleSubmit} noValidate>
          <span className="login-card__chip">
            <ShieldCheck size={14} />
            Student Development &amp; Activities Office
          </span>

          <img src="/pawrtal-logo.png" alt="RSO PAWrtal" className="login-card__logo" />

          <p className="login-card__sub">
            Sign in with your SDAO-issued credentials to manage your
            organization's activities and submissions.
          </p>

          {error && (
            <div className="login-error">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          <div className="field">
            <label htmlFor="email">Username</label>
            <div className="field-input">
              <User size={17} />
              <input
                id="email"
                type="text"
                autoComplete="username"
                placeholder="e.g. rmdelavina or scs-sc.president"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="field">
            <div className="field-label-row">
              <label htmlFor="password">Password</label>
              <button type="button" className="forgot-link">
                Forgot password?
              </button>
            </div>
            <div className="field-input">
              <Lock size={17} />
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button
                type="button"
                className="toggle-visibility"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </div>

          <label className="remember-me">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            Keep me signed in
          </label>

          <button className="btn-primary" type="submit" disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 size={16} className="spin" /> Signing in…
              </>
            ) : (
              'Sign in'
            )}
          </button>

          <p className="login-footnote">
            Accounts are created by SDAO Admins only. Contact your SDAO
            Admin for access.
          </p>
        </form>
      </div>
    </div>
  )
}
