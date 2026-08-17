import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Search, Loader2, AlertTriangle, CheckCircle2, XCircle, RotateCcw, ArrowLeft } from 'lucide-react'
import { trackCurricularActivity, CURRICULAR_CHAIN } from '../lib/curricularActivities'
import './TrackCurricularActivity.css'

function currentStepIndex(status) {
  if (status === 'rejected' || status === 'returned') return -1
  const idx = CURRICULAR_CHAIN.findIndex((s) => s.key === status)
  return idx === -1 ? CURRICULAR_CHAIN.length - 1 : idx
}

export default function TrackCurricularActivity() {
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!code.trim()) return
    setLoading(true)
    setError('')
    setResult(null)
    const { data, error: rpcError } = await trackCurricularActivity(code.trim())
    setLoading(false)
    if (rpcError || !data?.ok) {
      setError('No activity found with that event code. Please check and try again.')
      return
    }
    setResult(data)
  }

  const stepIdx = result ? currentStepIndex(result.status) : -1
  const terminal = result?.status === 'rejected' || result?.status === 'returned'

  return (
    <div className="track-screen">
      <div className="track-card">
        <Link to="/login" className="track-back"><ArrowLeft size={14} /> Back to login</Link>
        <h1>Track My Activity</h1>
        <p className="track-sub">Enter the event code you received by email to check where your Curricular Activity is in the approval chain.</p>

        <form onSubmit={handleSubmit} className="track-form">
          <div className="track-input-row">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="e.g. CA-2026-000123"
            />
            <button className="btn-primary" type="submit" disabled={loading}>
              {loading ? <Loader2 size={16} className="spin" /> : <Search size={16} />}
              Track
            </button>
          </div>
        </form>

        {error && <div className="track-error"><AlertTriangle size={16} /><span>{error}</span></div>}

        {result && (
          <div className="track-result">
            <h2>{result.title}</h2>
            <p className="track-code">{result.event_code}</p>

            {terminal ? (
              <div className={`track-terminal track-terminal--${result.status}`}>
                {result.status === 'rejected' ? <XCircle size={20} /> : <RotateCcw size={20} />}
                <span>{result.status === 'rejected' ? 'This application was rejected.' : 'This application was returned for revision.'}</span>
              </div>
            ) : (
              <ol className="track-steps">
                {CURRICULAR_CHAIN.map((step, i) => {
                  const state = i < stepIdx ? 'done' : i === stepIdx ? 'active' : 'pending'
                  return (
                    <li key={step.key} className={`track-step track-step--${state}`}>
                      <span className="track-step__dot">{state === 'done' ? <CheckCircle2 size={16} /> : i + 1}</span>
                      <span className="track-step__label">{step.label}</span>
                    </li>
                  )
                })}
              </ol>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
