import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, isSHSFacultyModerator } from './context/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'
import Login from './pages/Login'
import ForgotPassword from './pages/ForgotPassword'
import ChangePassword from './pages/ChangePassword'
import AddRecoveryEmail from './pages/AddRecoveryEmail'
import PrivacyNotice from './pages/PrivacyNotice'
import Dashboard from './pages/Dashboard'
import CalendarOfActivities from './pages/CalendarOfActivities'
import SubmissionBin from './pages/SubmissionBin'
import Templates from './pages/Templates'
import Clearance from './pages/Clearance'
import Assignments from './pages/Assignments'
import Accounts from './pages/Accounts'
import Settings from './pages/Settings'
import SystemInfo from './pages/SystemInfo'
import ExternalApproval from './pages/ExternalApproval'
import EventVerification from './pages/EventVerification'
import VenueRequest from './pages/VenueRequest'
import RescheduleRequests from './pages/RescheduleRequests'
import OrgRenewal from './pages/OrgRenewal'
import CurricularApply from './pages/CurricularApply'
import CurricularApproval from './pages/CurricularApproval'
import TrackCurricularActivity from './pages/TrackCurricularActivity'
import CurricularActivities from './pages/CurricularActivities'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/change-password" element={<ChangePassword />} />
          {/* Mandatory first-login gate — see ProtectedRoute.jsx. Every
              account must have a recovery Gmail on file before it can
              reach any other page. */}
          <Route path="/add-recovery-email" element={<AddRecoveryEmail />} />
          <Route path="/privacy-notice" element={<PrivacyNotice />} />
          {/* Public — no login. Advisers/Deans open this from a
              time-limited link sent by the submitting org; see
              src/lib/approvalLinks.js and migration 019. */}
          <Route path="/approve/:token" element={<ExternalApproval />} />
          {/* Public — no login. This is what the QR code printed on an
              approved ACP Form points to; see src/lib/eventVerification.js
              and migration 021. */}
          <Route path="/verify/:token" element={<EventVerification />} />
          {/* Public — no login. Faculty applying for a Curricular Activity
              via an SDAO-generated link (migration 074). */}
          <Route path="/curricular/apply/:token" element={<CurricularApply />} />
          {/* Public — no login. Dean/SDG Representative review link. */}
          <Route path="/curricular/approve/:token" element={<CurricularApproval />} />
          {/* Public — no login. "Track My Activity" from the login page —
              event code only, no faculty PII returned. */}
          <Route path="/track" element={<TrackCurricularActivity />} />

          <Route
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/calendar" element={<CalendarOfActivities />} />
            {/* FMO is a limited tier — Dashboard + Calendar only — so every
                other route below explicitly excludes 'fmo'. Executive
                Director is likewise limited to Dashboard + Calendar +
                Submission Bin (bypass-approve only), so it's excluded from
                Templates/Clearance/Assignments/Accounts too. SHS Principal
                gets the same trimmed shape as Executive Director — one
                approval step, not a daily admin user. SDAO-SHS gets the
                full College-admin-shaped nav (minus Accounts), scoped to
                department = 'shs' server-side (migration 052). SHS Faculty
                (migration 054/055) is trimmed even further — Dashboard +
                Calendar + Venue Request only, so it's excluded from every
                route below too. */}
            <Route
              path="/submissions"
              element={<ProtectedRoute excludeRoles={['fmo', 'shs_faculty']}><SubmissionBin /></ProtectedRoute>}
            />
            {/* SHS Principal DOES get Templates (unlike Clearance/Assignments) —
                it can see and upload SHS Templates only, scoped server-side
                (migration 053). */}
            <Route
              path="/templates"
              element={<ProtectedRoute excludeRoles={['fmo', 'executive_director', 'shs_faculty']}><Templates /></ProtectedRoute>}
            />
            <Route
              path="/clearance"
              element={<ProtectedRoute excludeRoles={['fmo', 'executive_director', 'shs_principal', 'shs_faculty']}><Clearance /></ProtectedRoute>}
            />
            {/* No allowedRoles here on purpose — RSO Officers need this page too,
                to see and act on tasks assigned to them. Assignments.jsx itself
                already gates creation/review controls to admin-tier roles. */}
            <Route
              path="/assignments"
              element={<ProtectedRoute excludeRoles={['fmo', 'executive_director', 'shs_principal', 'shs_faculty']}><Assignments /></ProtectedRoute>}
            />
            <Route
              path="/accounts"
              element={
                <ProtectedRoute
                  allowedRoles={[
                    'sdao_assistant', 'crso_chairperson', 'qmo',
                    'sdao_supervisor', 'academic_director', 'system_admin',
                    // SDAO-SHS and SHS Principal also get Accounts, but
                    // strictly limited to SHS orgs + SHS RSO/Moderator +
                    // SHS Faculty accounts — see the department gating in
                    // Accounts.jsx itself.
                    'sdao_shs', 'shs_principal',
                  ]}
                >
                  <Accounts />
                </ProtectedRoute>
              }
            />
            {/* SHS Faculty submits Venue Requests here; SDAO-SHS and SHS
                Principal work the approval queue from the same page (see
                VenueRequest.jsx) — Faculty -> SDAO-SHS -> SHS Principal. */}
            <Route
              path="/venue-requests"
              element={
                // extraAllow lets an SHS Faculty-Moderator (role
                // 'rso_officer' + Moderator org_membership on an SHS
                // org) reach this Faculty route too — see
                // isSHSFacultyModerator in AuthContext.jsx.
                <ProtectedRoute allowedRoles={['shs_faculty', 'sdao_shs', 'shs_principal']} extraAllow={isSHSFacultyModerator}>
                  <VenueRequest />
                </ProtectedRoute>
              }
            />
            {/* Reschedule chain: org (rso_officer) -> SDAO Assistant ->
                SDAO Supervisor -> Academic Director, separate routing
                from the original ACP approval chain (migration 062).
                Same exclusions as Submission Bin/Clearance/Assignments. */}
            <Route
              path="/reschedule-requests"
              element={<ProtectedRoute excludeRoles={['fmo', 'executive_director', 'shs_principal', 'shs_faculty']}><RescheduleRequests /></ProtectedRoute>}
            />
            {/* Annual RSO renewal: org (President) submits requirements;
                SDAO Assistant/Supervisor/Academic Director work the
                approval queue. Not an SHS concern (no shs_shs/shs_faculty/
                shs_principal here), same exclusions as Reschedule Requests. */}
            <Route
              path="/renewal"
              element={<ProtectedRoute excludeRoles={['fmo', 'executive_director', 'shs_principal', 'shs_faculty', 'sdao_shs']}><OrgRenewal /></ProtectedRoute>}
            />
            {/* Faculty Curricular Activities: SDAO/Admin generate apply
                links and work the Dean -> SDG Rep -> Academic Director
                queue (migration 074). Not an RSO-org concern, so no SHS/
                FMO/ED roles here. */}
            <Route
              path="/curricular-activities"
              element={
                <ProtectedRoute allowedRoles={['sdao_assistant', 'sdao_supervisor', 'academic_director', 'system_admin']}>
                  <CurricularActivities />
                </ProtectedRoute>
              }
            />
            <Route
              path="/settings"
              element={<Settings />}
            />
            <Route
              path="/about"
              element={<SystemInfo />}
            />
          </Route>

          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
