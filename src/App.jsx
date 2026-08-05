import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'
import Login from './pages/Login'
import ChangePassword from './pages/ChangePassword'
import Dashboard from './pages/Dashboard'
import CalendarOfActivities from './pages/CalendarOfActivities'
import SubmissionBin from './pages/SubmissionBin'
import Templates from './pages/Templates'
import Clearance from './pages/Clearance'
import Assignments from './pages/Assignments'
import Accounts from './pages/Accounts'
import Settings from './pages/Settings'
import ExternalApproval from './pages/ExternalApproval'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/change-password" element={<ChangePassword />} />
          {/* Public — no login. Advisers/Deans open this from a
              time-limited link sent by the submitting org; see
              src/lib/approvalLinks.js and migration 019. */}
          <Route path="/approve/:token" element={<ExternalApproval />} />

          <Route
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/calendar" element={<CalendarOfActivities />} />
            <Route path="/submissions" element={<SubmissionBin />} />
            <Route path="/templates" element={<Templates />} />
            <Route path="/clearance" element={<Clearance />} />
            {/* No allowedRoles here on purpose — RSO Officers need this page too,
                to see and act on tasks assigned to them. Assignments.jsx itself
                already gates creation/review controls to admin-tier roles. */}
            <Route path="/assignments" element={<Assignments />} />
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
            <Route path="/settings" element={<Settings />} />
          </Route>

          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
