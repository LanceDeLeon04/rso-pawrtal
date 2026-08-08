import { useState } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { ShieldCheck, Lock, ChevronRight } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabaseClient'
import { markPrivacyAcknowledged } from '../lib/privacyNotice'
import './PrivacyNotice.css'

// Bump this whenever the notice text materially changes — it's stamped
// on every consent row (migration 033) so there's a record of exactly
// which version of the notice a person agreed to.
export const PRIVACY_NOTICE_VERSION = '2026-08-08'

export default function PrivacyNotice() {
  const { session, profile, signOut } = useAuth()
  const navigate = useNavigate()
  const [checked, setChecked] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // No active session — nothing to acknowledge yet, send them to log in.
  if (!session) return <Navigate to="/login" replace />
  // First-time sign-in still needs a password change before anything else.
  if (profile?.must_change_password) return <Navigate to="/change-password" replace />

  async function handleContinue() {
    if (!checked || submitting) return
    setSubmitting(true)
    setError('')

    const { error: insertError } = await supabase.from('privacy_consents').insert({
      profile_id: session.user.id,
      notice_version: PRIVACY_NOTICE_VERSION,
      user_agent: navigator.userAgent,
    })

    if (insertError) {
      console.error('Failed to log privacy consent', insertError)
      setError('Something went wrong recording your consent. Please try again.')
      setSubmitting(false)
      return
    }

    markPrivacyAcknowledged(session.user.id)
    navigate('/dashboard', { replace: true })
  }

  return (
    <div className="pn-screen">
      <div className="pn-card-wrap">
        <div className="pn-card">
          <div className="pn-card__header">
            <img src="/pawrtal-logo.png" alt="RSO PAWrtal" className="pn-card__logo" />
            <span className="pn-card__chip">
              <ShieldCheck size={14} />
              Data Privacy Notice
            </span>
          </div>

          <p className="pn-intro">
            Before you continue to your dashboard, please read and acknowledge
            how RSO PAWrtal collects, uses, and protects your personal data.
            This notice is shown at every sign-in in compliance with the
            Data Privacy Act of 2012.
          </p>

          <div className="pn-scroll">
            <section>
              <h3>1. Who we are and our legal basis</h3>
              <p>
                RSO PAWrtal ("the System") is the recognized student
                organization (RSO) management platform operated by the
                Student Development and Activities Office (SDAO) and the
                Council of Recognized Student Organizations, in support of
                the University's supervision of student organizations,
                events, and campus facilities. Processing of your personal
                data under this notice is carried out pursuant to Republic
                Act No. 10173, the Data Privacy Act of 2012 ("DPA"), its
                Implementing Rules and Regulations, and issuances of the
                National Privacy Commission (NPC). The System processes
                your data on the following legal bases, as applicable:
                consent (Section 12(a), DPA), performance of a contract or
                prior obligations to which you are a party as a
                registered officer, adviser, or member of a recognized
                organization (Section 12(b)), and compliance with a legal
                obligation of the University or the recognized organization
                (Section 12(c)).
              </p>
            </section>

            <section>
              <h3>2. What personal data we collect</h3>
              <p>Depending on your role, the System may collect and process:</p>
              <ul>
                <li>
                  <strong>Identity and contact information</strong> — full
                  name, username, institutional email address, contact
                  number, and photo.
                </li>
                <li>
                  <strong>Organizational information</strong> — your
                  organization, position, membership status, and
                  officer/adviser assignments.
                </li>
                <li>
                  <strong>Submission records</strong> — Event Applications,
                  Activity Concept Papers (ACP), activity reports, and their
                  attachments (which may include signatures, letters, and
                  supporting documents you or your organization upload).
                </li>
                <li>
                  <strong>Approval and clearance records</strong> — adviser
                  and dean signatures, approval timestamps, clearance and
                  task status.
                </li>
                <li>
                  <strong>Venue and calendar data</strong> — bookings,
                  reschedules, and venue-blocking records tied to your
                  organization's activities.
                </li>
                <li>
                  <strong>System and usage data</strong> — login timestamps,
                  IP address, browser/device information, and actions taken
                  within the System, for security and audit purposes.
                </li>
              </ul>
            </section>

            <section>
              <h3>3. Why we process your data</h3>
              <p>Your personal data is used to:</p>
              <ul>
                <li>Authenticate your account and enforce role-based access;</li>
                <li>
                  Process, route, and track Event Applications, ACP forms,
                  and activity reports through adviser, dean, and SDAO
                  approval;
                </li>
                <li>Manage venue bookings, blocks, and rescheduling to prevent conflicts;</li>
                <li>Monitor organizational clearance and compliance obligations;</li>
                <li>Generate verifiable, QR-linked approved documents;</li>
                <li>
                  Maintain security logs and an audit trail of consent and
                  account activity; and
                </li>
                <li>Communicate with you regarding your submissions, tasks, or account status.</li>
              </ul>
            </section>

            <section>
              <h3>4. Who we share your data with</h3>
              <p>
                Your data is accessible only to personnel and systems that
                need it to fulfill the purposes above, namely: SDAO staff,
                the CRSO chairperson and QMO, your organization's adviser
                and academic director, the Facilities Management Office
                (limited to calendar and venue-relevant data only), and
                system administrators for technical maintenance. The System
                does not sell your personal data, and does not share it with
                third parties for marketing purposes. Data may be disclosed
                where required by law, court order, or a lawful directive of
                a government agency such as the National Privacy Commission.
              </p>
            </section>

            <section>
              <h3>5. Data storage and security</h3>
              <p>
                Your data is stored on Supabase infrastructure with access
                controlled through row-level security policies scoped to
                your role and organization, encryption of data in transit,
                and authenticated, auditable access to uploaded files.
                Approval links and verification QR codes use time-limited or
                single-purpose tokens rather than exposing your data
                directly. Every acceptance of this notice is itself logged
                with a timestamp as part of our accountability obligations
                under the DPA.
              </p>
            </section>

            <section>
              <h3>6. Retention</h3>
              <p>
                Personal data is retained for as long as you remain an
                active officer, member, or account holder of a recognized
                organization, and thereafter only as long as necessary to
                comply with the University's institutional record-keeping
                requirements, to establish, exercise, or defend legal
                claims, or as otherwise required by applicable law. Data no
                longer needed for these purposes is disposed of or
                anonymized in a secure manner.
              </p>
            </section>

            <section>
              <h3>7. Your rights as a data subject</h3>
              <p>Under Sections 16 to 18 of the DPA, you have the right to:</p>
              <ul>
                <li>Be informed that your personal data will be, is being, or has been processed;</li>
                <li>Reasonable access to your personal data upon request;</li>
                <li>Object to processing, subject to legal or contractual restrictions;</li>
                <li>
                  Request correction of inaccurate or outdated personal
                  data;
                </li>
                <li>
                  Request erasure or blocking of data that is incomplete,
                  outdated, false, unlawfully obtained, or used for
                  unauthorized purposes, subject to the University's
                  lawful record-keeping obligations;
                </li>
                <li>Be indemnified for damages from inaccurate, incomplete, or unlawfully obtained data used against you;</li>
                <li>Data portability, where technically feasible; and</li>
                <li>Lodge a complaint with the National Privacy Commission.</li>
              </ul>
              <p>
                To exercise any of these rights, contact your organization's
                SDAO representative or the University's Data Protection
                Officer through official University channels.
              </p>
            </section>

            <section>
              <h3>8. Consent</h3>
              <p>
                By checking the box below and clicking "I Agree &amp;
                Continue," you acknowledge that you have read and
                understood this notice, and you consent to the collection,
                use, storage, and disclosure of your personal data as
                described, for as long as your account remains active.
                Withdrawing consent may limit or prevent your use of the
                System, including your ability to submit or process
                organizational documents.
              </p>
            </section>
          </div>

          {error && <div className="pn-error">{error}</div>}

          <label className="pn-check">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
            />
            <span>
              I have read and understood this Data Privacy Notice, and I
              agree to the collection and processing of my personal data as
              described above.
            </span>
          </label>

          <div className="pn-actions">
            <button type="button" className="pn-btn-secondary" onClick={signOut}>
              Log out instead
            </button>
            <button
              type="button"
              className="pn-btn-primary"
              disabled={!checked || submitting}
              onClick={handleContinue}
            >
              <Lock size={15} />
              {submitting ? 'Recording…' : 'I Agree & Continue'}
              <ChevronRight size={15} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
