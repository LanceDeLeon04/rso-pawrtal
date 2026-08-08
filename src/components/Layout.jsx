import { useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, CalendarDays, Inbox, FileText, ShieldCheck,
  ClipboardList, Users, Settings as SettingsIcon, LogOut,
  Bell, ChevronsLeft, ChevronsRight, ChevronDown,
} from 'lucide-react'
import { useAuth, isAdminTier, isFMO } from '../context/AuthContext'
import './Layout.css'

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/calendar', label: 'Calendar of Activities', icon: CalendarDays },
  { to: '/submissions', label: 'Submission Bin', icon: Inbox, hideForFMO: true },
  { to: '/templates', label: 'Templates', icon: FileText, hideForFMO: true },
  { to: '/clearance', label: 'Clearance', icon: ShieldCheck, hideForFMO: true },
  { to: '/assignments', label: 'Assignments', icon: ClipboardList, hideForFMO: true },
  { to: '/accounts', label: 'Accounts', icon: Users, adminOnly: true, hideForFMO: true },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
]

const ROLE_LABELS = {
  rso_officer: 'RSO Officer',
  sdao_assistant: 'SDAO Assistant',
  crso_chairperson: 'CRSO Chairperson',
  qmo: 'QMO',
  sdao_supervisor: 'SDAO Supervisor',
  academic_director: 'Academic Director',
  system_admin: 'System Admin',
  fmo: 'Facilities Management Office',
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

  const admin = isAdminTier(profile?.role)
  const fmo = isFMO(profile?.role)
  const visibleNav = NAV_ITEMS.filter((item) => (!item.adminOnly || admin) && (!fmo || !item.hideForFMO))
  const activeItem = NAV_ITEMS.find((item) => location.pathname.startsWith(item.to))
  const orgLabel = profile?.org_memberships?.[0]?.organizations?.acronym
  const isCOLOrg = profile?.org_memberships?.[0]?.organizations?.category === 'COL'
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
          </div>

          <div className="topbar__actions">
            <button className="topbar__icon-btn" aria-label="Notifications">
              <Bell size={18} />
              <span className="topbar__dot" />
            </button>

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
    </div>
  )
}
