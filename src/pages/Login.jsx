import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { User, Lock, Eye, EyeOff, AlertCircle, ShieldCheck, Loader2, Search } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import './Login.css'

// Renders the remaining cooldown as "12:45" and counts down live so the
// person doesn't have to keep re-submitting the form to check.
function useCountdown(targetIso) {
  const [remainingMs, setRemainingMs] = useState(() =>
    targetIso ? new Date(targetIso).getTime() - Date.now() : 0
  )

  useEffect(() => {
    if (!targetIso) return
    const tick = () => setRemainingMs(new Date(targetIso).getTime() - Date.now())
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [targetIso])

  if (!targetIso || remainingMs <= 0) return null
  const totalSeconds = Math.ceil(remainingMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export default function Login() {
  const { signIn } = useAuth()
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState('')
  const [errorKind, setErrorKind] = useState(null) // null | 'cooldown' | 'locked'
  const [cooldownUntil, setCooldownUntil] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const countdown = useCountdown(errorKind === 'cooldown' ? cooldownUntil : null)

  // If the countdown finishes while the person is still looking at the
  // page, swap the message so they know they can try again.
  useEffect(() => {
    if (errorKind === 'cooldown' && !countdown) {
      setError('You can try signing in again now.')
      setErrorKind(null)
      setCooldownUntil(null)
    }
  }, [errorKind, countdown])

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setErrorKind(null)
    setCooldownUntil(null)
    setSubmitting(true)

    const { data, error: signInError } = await signIn(email, password)

    setSubmitting(false)

    if (signInError) {
      if (signInError.message === 'ACCOUNT_DEACTIVATED') {
        setError('This account has been deactivated. Please contact SDAO.')
      } else if (signInError.message === 'ACCOUNT_LOCKED') {
        setError(
          'This account has been locked for security reasons. Please contact your SDAO Administrator to have it reset.'
        )
        setErrorKind('locked')
      } else if (signInError.message === 'ACCOUNT_COOLDOWN') {
        setErrorKind('cooldown')
        setCooldownUntil(signInError.cooldownUntil)
      } else {
        setError('Incorrect username or password. Please try again.')
      }
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

          {errorKind === 'cooldown' && countdown ? (
            <div className="login-error">
              <AlertCircle size={16} />
              <span>
                Too many incorrect attempts. Please try again in <strong>{countdown}</strong>.
              </span>
            </div>
          ) : (
            error && (
              <div className="login-error">
                <AlertCircle size={16} />
                <span>{error}</span>
              </div>
            )
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
              <Link to="/forgot-password" className="forgot-link">
                Forgot password?
              </Link>
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

          <button
            className="btn-primary"
            type="submit"
            disabled={submitting || errorKind === 'locked' || (errorKind === 'cooldown' && !!countdown)}
          >
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

          <Link to="/track" className="track-activity-btn">
            <Search size={15} />
            Track My Activity
          </Link>
        </form>
      </div>
    </div>
  )
}
