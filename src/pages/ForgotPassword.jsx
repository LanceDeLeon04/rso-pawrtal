import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { User, Lock, KeyRound, AlertCircle, ShieldCheck, Loader2, CheckCircle2, ArrowLeft } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import './Login.css'

// Three-step flow, all against public (no-session) Edge Functions:
//   1. username -> send-password-reset-otp emails a 6-digit code to the
//      account's recovery_email (Gmail on file), if any.
//   2. code + new password -> verify-password-reset-otp checks the code
//      and sets the password.
//   3. success -> back to /login.
export default function ForgotPassword() {
  const navigate = useNavigate()

  const [step, setStep] = useState('username') // 'username' | 'otp' | 'done'
  const [username, setUsername] = useState('')
  const [otp, setOtp] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSendCode(e) {
    e.preventDefault()
    setError('')
    if (!username.trim()) return
    setSubmitting(true)
    const { data, error: fnErr } = await supabase.functions.invoke('send-password-reset-otp', {
      body: { username: username.trim() },
    })
    setSubmitting(false)
    if (fnErr || data?.error) {
      setError(data?.error || 'Could not send the code. Please try again.')
      return
    }
    setNotice(
      "If that account has a Gmail address on file, we've sent a 6-digit code to it. " +
      "Didn't get an account with a Gmail on file? Ask your SDAO Admin to add one for you."
    )
    setStep('otp')
  }

  async function handleReset(e) {
    e.preventDefault()
    setError('')

    if (!/^\d{6}$/.test(otp.trim())) {
      setError('Enter the 6-digit code from your email.')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }

    setSubmitting(true)
    const { data, error: fnErr } = await supabase.functions.invoke('verify-password-reset-otp', {
      body: { username: username.trim(), otp: otp.trim(), new_password: password },
    })
    setSubmitting(false)

    if (fnErr || data?.error) {
      setError(data?.error || 'Could not reset your password. Please try again.')
      return
    }
    setStep('done')
  }

  return (
    <div className="login-screen">
      <div className="login-bg" style={{ backgroundImage: "url('/nu-bg-updated.png')" }} />
      <div className="login-bg-overlay" />

      <div className="login-card-wrap">
        <form
          className="login-card"
          onSubmit={step === 'username' ? handleSendCode : step === 'otp' ? handleReset : (e) => e.preventDefault()}
          noValidate
        >
          <span className="login-card__chip">
            <ShieldCheck size={14} />
            Password Reset
          </span>

          <img src="/pawrtal-logo.png" alt="RSO PAWrtal" className="login-card__logo" />

          {step === 'username' && (
            <>
              <p className="login-card__sub">
                Enter your PAWrtal username. If your account has a Gmail
                address on file, we'll email a 6-digit verification code to it.
              </p>

              {error && (
                <div className="login-error">
                  <AlertCircle size={16} />
                  <span>{error}</span>
                </div>
              )}

              <div className="field">
                <label htmlFor="username">Username</label>
                <div className="field-input">
                  <User size={17} />
                  <input
                    id="username"
                    type="text"
                    autoComplete="username"
                    placeholder="e.g. rmdelavina or scs-sc.president"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                  />
                </div>
              </div>

              <button className="btn-primary" type="submit" disabled={submitting}>
                {submitting ? (
                  <>
                    <Loader2 size={16} className="spin" /> Sending code…
                  </>
                ) : (
                  'Send verification code'
                )}
              </button>
            </>
          )}

          {step === 'otp' && (
            <>
              <p className="login-card__sub">{notice}</p>

              {error && (
                <div className="login-error">
                  <AlertCircle size={16} />
                  <span>{error}</span>
                </div>
              )}

              <div className="field">
                <label htmlFor="otp">6-digit code</label>
                <div className="field-input">
                  <KeyRound size={17} />
                  <input
                    id="otp"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    placeholder="123456"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    required
                  />
                </div>
              </div>

              <div className="field">
                <label htmlFor="new-password">New password</label>
                <div className="field-input">
                  <Lock size={17} />
                  <input
                    id="new-password"
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
                <label htmlFor="confirm-password">Confirm new password</label>
                <div className="field-input">
                  <CheckCircle2 size={17} />
                  <input
                    id="confirm-password"
                    type="password"
                    autoComplete="new-password"
                    placeholder="Re-enter password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                  />
                </div>
              </div>

              <button className="btn-primary" type="submit" disabled={submitting}>
                {submitting ? (
                  <>
                    <Loader2 size={16} className="spin" /> Resetting…
                  </>
                ) : (
                  'Reset password'
                )}
              </button>

              <button
                type="button"
                className="forgot-link"
                style={{ marginTop: 10 }}
                onClick={() => { setStep('username'); setOtp(''); setError(''); }}
              >
                <ArrowLeft size={13} style={{ verticalAlign: -2 }} /> Use a different username / resend code
              </button>
            </>
          )}

          {step === 'done' && (
            <>
              <div className="login-error" style={{ background: '#f0fdf4', color: '#15803d', borderColor: '#bbf7d0' }}>
                <CheckCircle2 size={16} />
                <span>Your password has been reset. You can now sign in with your new password.</span>
              </div>
              <button className="btn-primary" type="button" onClick={() => navigate('/login')}>
                Back to sign in
              </button>
            </>
          )}

          {step !== 'done' && (
            <p className="login-footnote">
              Remembered your password? <Link to="/login">Back to sign in</Link>
            </p>
          )}
        </form>
      </div>
    </div>
  )
}
