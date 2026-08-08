import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'
import Login from './pages/Login'
import ChangePassword from './pages/ChangePassword'
import PrivacyNotice from './pages/PrivacyNotice'
import Dashboard from './pages/Dashboard'
import CalendarOfActivities from './pages/CalendarOfActivities'
import SubmissionBin from './pages/SubmissionBin'
import Templates from './pages/Templates'
import Clearance from './pages/Clearance'
import Assignments from './pages/Assignments'
import Accounts from './pages/Accounts'
import Settings from './pages/Settings'
import ExternalApproval from './pages/ExternalApproval'
import EventVerification from './pages/EventVerification'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/change-password" element={<ChangePassword />} />
          <Route path="/privacy-notice" element={<PrivacyNotice />} />
          {/* Public — no login. Advisers/Deans open this from a
              time-limited link sent by the submitting org; see
              src/lib/approvalLinks.js and migration 019. */}
          <Route path="/approve/:token" element={<ExternalApproval />} />
          {/* Public — no login. This is what the QR code printed on an
              approved ACP Form points to; see src/lib/eventVerification.js
              and migration 021. */}
          <Route path="/verify/:token" element={<EventVerification />} />

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
                other route below explicitly excludes 'fmo'. */}
            <Route
              path="/submissions"
              element={<ProtectedRoute excludeRoles={['fmo']}><SubmissionBin /></ProtectedRoute>}
            />
            <Route
              path="/templates"
              element={<ProtectedRoute excludeRoles={['fmo']}><Templates /></ProtectedRoute>}
            />
            <Route
              path="/clearance"
              element={<ProtectedRoute excludeRoles={['fmo']}><Clearance /></ProtectedRoute>}
            />
            {/* No allowedRoles here on purpose — RSO Officers need this page too,
                to see and act on tasks assigned to them. Assignments.jsx itself
                already gates creation/review controls to admin-tier roles. */}
            <Route
              path="/assignments"
              element={<ProtectedRoute excludeRoles={['fmo']}><Assignments /></ProtectedRoute>}
            />
            <Route
              path="/accounts"
              element={
                <ProtectedRoute
                  allowedRoles={[
                    'sdao_assistant', 'crso_chairperson', 'qmo',
                    'sdao_supervisor', 'academic_director', 'system_admin',
                  ]}
                >
                  <Accounts />
                </ProtectedRoute>
              }
            />
            <Route
              path="/settings"
              element={<Settings />}
            />
          </Route>

          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
