import { useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, CalendarDays, Inbox, FileText, ShieldCheck,
  ClipboardList, Users, Settings as SettingsIcon, LogOut,
  Bell, ChevronsLeft, ChevronsRight, ChevronDown, Building2, X, Info,
} from 'lucide-react'
import {
  useAuth, isAdminTier, isFMO, isExecutiveDirector,
  isSHSReviewer, seesAllDepartments, DEPARTMENT_LABELS,
} from '../context/AuthContext'
import './Layout.css'

// Executive Director is admin-tier (full Dashboard analytics) but, like
// FMO, only gets a slice of the nav — Dashboard, Calendar, and
// Submission Bin (bypass-approve only). See App.jsx for the matching
// route guards.
//
// SDAO-SHS gets the same slice of nav as a College admin (Dashboard,
// Calendar, Submission Bin, Templates, Clearance, Assignments) minus
// Accounts, all scoped server-side to department = 'shs' (migration
// 052). SHS Principal is a single internal approval step, not a daily
// dashboard user, so it's trimmed further to Dashboard/Calendar/
// Submission Bin — same shape as Executive Director.
const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/calendar', label: 'Calendar of Activities', icon: CalendarDays },
  { to: '/submissions', label: 'Submission Bin', icon: Inbox, hideForFMO: true },
  { to: '/templates', label: 'Templates', icon: FileText, hideForFMO: true, hideForED: true },
  { to: '/clearance', label: 'Clearance', icon: ShieldCheck, hideForFMO: true, hideForED: true, hideForShsPrincipal: true },
  { to: '/assignments', label: 'Assignments', icon: ClipboardList, hideForFMO: true, hideForED: true, hideForShsPrincipal: true },
  { to: '/accounts', label: 'Accounts', icon: Users, adminOnly: true, hideForFMO: true, hideForED: true },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
  { to: '/about', label: 'About the System', icon: Info },
]

const ACCREDITATION_LABELS = {
  accredited: 'Accredited',
  probationary: 'Probationary',
  pending: 'Pending',
}

const ROLE_LABELS = {
  rso_officer: 'RSO Officer',
  sdao_assistant: 'SDAO Assistant',
  crso_chairperson: 'CRSO Chairperson',
  qmo: 'QMO',
  sdao_supervisor: 'SDAO Supervisor',
  academic_director: 'Academic Director',
  system_admin: 'System Admin',
  fmo: 'Facilities Management Office',
  executive_director: 'Executive Director',
  sdao_shs: 'SDAO - SHS',
  shs_principal: 'SHS Principal',
}

function initialsOf(name) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase()
}

export default function Layout() {
  const { profile, signOut } = useAuth()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [orgModalOpen, setOrgModalOpen] = useState(false)

  const admin = isAdminTier(profile?.role)
  const fmo = isFMO(profile?.role)
  const ed = isExecutiveDirector(profile?.role)
  const shsPrincipal = profile?.role === 'shs_principal'
  const shsReviewer = isSHSReviewer(profile?.role)
  const seesAllDepts = seesAllDepartments(profile?.role)
  const visibleNav = NAV_ITEMS.filter((item) =>
    // Accounts is admin-only, PLUS SDAO-SHS/SHS Principal, who get a
    // narrowed version of it (SHS orgs + SHS RSO/Moderator accounts
    // only — see Accounts.jsx).
    (!item.adminOnly || admin || shsReviewer)
    && (!fmo || !item.hideForFMO)
    && (!ed || !item.hideForED)
    && (!shsPrincipal || !item.hideForShsPrincipal))
  const activeItem = NAV_ITEMS.find((item) => location.pathname.startsWith(item.to))
  const org = profile?.org_memberships?.[0]?.organizations
  const orgLabel = org?.acronym
  const orgName = org?.name || org?.acronym
  const isCOLOrg = org?.category === 'COL'
  const roleLabel = profile?.role === 'rso_officer' && isCOLOrg
    ? 'COL Officer'
    : (ROLE_LABELS[profile?.role] || profile?.role)

  return (
    <div className="shell">
      <aside className={`sidebar ${collapsed ? 'sidebar--collapsed' : ''}`}>
        <div className="sidebar__brand">
          {collapsed ? (
            <img src="/icon.png" alt="RSO PAWrtal" className="sidebar__mark sidebar__mark--collapsed" />
          ) : (
            <>
              <img src="/nu-shield.svg" alt="NU" className="sidebar__nu-mark" />
              <img src="/pawrtal-logo.png" alt="RSO PAWrtal" className="sidebar__pawrtal-mark" />
            </>
          )}
        </div>

        <nav className="sidebar__nav">
          {visibleNav.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) => `sidebar__link ${isActive ? 'sidebar__link--active' : ''}`}
              title={collapsed ? label : undefined}
            >
              <Icon size={18} strokeWidth={2} />
              {!collapsed && <span>{label}</span>}
            </NavLink>
          ))}
        </nav>

        <button
          className="sidebar__collapse-btn"
          onClick={() => setCollapsed((v) => !v)}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronsRight size={16} /> : <><ChevronsLeft size={16} /><span>Collapse</span></>}
        </button>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar__title">
            <h1>{activeItem?.label || 'RSO PAWrtal'}</h1>
            {orgLabel && <span className="topbar__org-chip">{orgLabel}</span>}
            {isSHSReviewer(profile?.role) && (
              <span className="topbar__org-chip topbar__org-chip--shs">SHS</span>
            )}
            {seesAllDepts && (
              <span className="topbar__org-chip topbar__org-chip--all-dept">College + SHS</span>
            )}
          </div>

          <div className="topbar__actions">
            <button className="topbar__icon-btn" aria-label="Notifications">
              <Bell size={18} />
              <span className="topbar__dot" />
            </button>

            {org && (
              <button
                type="button"
                className="topbar__org"
                title={orgName}
                onClick={() => setOrgModalOpen(true)}
              >
                {org.logo_url ? (
                  <img src={org.logo_url} alt={orgName} className="topbar__org-logo" />
                ) : (
                  <div className="topbar__org-logo topbar__org-logo--fallback">
                    {orgName?.[0]?.toUpperCase() || '?'}
                  </div>
                )}
                <span className="topbar__org-tooltip">{orgName}</span>
              </button>
            )}

            <div className="topbar__user" onClick={() => setMenuOpen((v) => !v)}>
              {profile?.photo_url ? (
                <img src={profile.photo_url} alt="" className="topbar__avatar" />
              ) : (
                <div className="topbar__avatar topbar__avatar--fallback">
                  {initialsOf(profile?.full_name)}
                </div>
              )}
              <div className="topbar__user-meta">
                <span className="topbar__user-name">{profile?.full_name || '—'}</span>
                <span className="topbar__user-role">{roleLabel}</span>
              </div>
              <ChevronDown size={15} className="topbar__chevron" />

              {menuOpen && (
                <div className="topbar__menu" onClick={(e) => e.stopPropagation()}>
                  <NavLink to="/settings" className="topbar__menu-item" onClick={() => setMenuOpen(false)}>
                    <SettingsIcon size={15} /> Settings
                  </NavLink>
                  <button className="topbar__menu-item topbar__menu-item--danger" onClick={signOut}>
                    <LogOut size={15} /> Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="content">
          <Outlet />
        </main>

        <footer className="footer">
          <span>© {new Date().getFullYear()} NU Laguna — Student Development &amp; Activities Office</span>
          <span className="footer__sep">•</span>
          <span>RSO PAWrtal</span>
        </footer>
      </div>

      {orgModalOpen && org && (
        <OrgInfoModal org={org} orgName={orgName} onClose={() => setOrgModalOpen(false)} />
      )}
    </div>
  )
}

function OrgInfoModal({ org, orgName, onClose }) {
  return (
    <div className="topbar-org-modal__backdrop" onClick={onClose}>
      <div className="topbar-org-modal" onClick={(e) => e.stopPropagation()}>
        <button className="topbar-org-modal__close" onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>

        <div className="topbar-org-modal__head">
          {org.logo_url ? (
            <img src={org.logo_url} alt="" className="topbar-org-modal__logo" />
          ) : (
            <div className="topbar-org-modal__logo topbar-org-modal__logo--fallback">
              <Building2 size={22} />
            </div>
          )}
          <div>
            <h3>{org.acronym}</h3>
            <p>{orgName}</p>
          </div>
        </div>

        <section className="topbar-org-modal__section">
          <h4>Org Details</h4>
          <div className="topbar-org-modal__grid">
            <div><span>Category</span><strong>{org.category || '—'}</strong></div>
            <div><span>Adviser</span><strong>{org.adviser_name || '—'}</strong></div>
            <div><span>Accreditation</span><strong>{ACCREDITATION_LABELS[org.accreditation_status] || '—'}</strong></div>
            <div><span>Status</span><strong>{org.is_active ? 'Active' : 'Inactive'}</strong></div>
            <div><span>Contact Email</span><strong>{org.contact_email || '—'}</strong></div>
            <div><span>Contact Number</span><strong>{org.contact_number || '—'}</strong></div>
          </div>
        </section>
      </div>
    </div>
  )
}
