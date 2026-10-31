import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowLeftRight, Banknote, BarChart3, Bell, Building2, CheckSquare, ClipboardList, FileWarning, Gauge, KeyRound, LifeBuoy,
  LogOut, Menu, Network, ScrollText, Settings, ShieldCheck, Landmark, UserCircle2, Users, UsersRound, Wallet,
} from 'lucide-react';
import { useAuth } from './auth';
import { useApi, initials, label } from './ui';

function navFor(auth) {
  const { can, isCustomer, role, user } = auth;
  if (isCustomer) {
    return [
      { section: 'Banking', items: [
        { to: '/', label: 'Dashboard', icon: Gauge, end: true },
        { to: '/accounts', label: 'My accounts', icon: Wallet },
        { to: '/transfer', label: 'Transfer money', icon: ArrowLeftRight },
        { to: '/beneficiaries', label: 'Beneficiaries', icon: UsersRound },
        { to: '/transactions', label: 'Transactions', icon: ScrollText },
      ] },
      { section: 'Help', items: [
        { to: '/service-requests', label: 'Service requests', icon: LifeBuoy },
        { to: '/disputes', label: 'Disputes', icon: FileWarning },
      ] },
    ];
  }
  const sections = [
    { section: 'Overview', items: [{ to: '/', label: 'Dashboard', icon: Gauge, end: true }] },
    { section: 'Banking', items: [
      can('customers:read') && { to: '/customers', label: 'Customers', icon: Users },
      can('accounts:read') && { to: '/accounts', label: 'Accounts', icon: Wallet },
      can('transactions:deposit', 'transactions:withdraw', 'transactions:transfer') && { to: '/teller', label: 'Teller operations', icon: Banknote },
      can('transactions:read') && { to: '/transactions', label: 'Transactions', icon: ScrollText },
      can('approvals:read') && { to: '/approvals', label: 'Approvals', icon: CheckSquare, badge: 'approvals' },
    ] },
    { section: 'Service', items: [
      can('service_requests:read') && { to: '/service-requests', label: 'Service requests', icon: LifeBuoy },
      can('disputes:read') && { to: '/disputes', label: 'Disputes', icon: FileWarning },
    ] },
    { section: 'Administration', items: [
      can('users:read') && { to: '/employees', label: 'Employees', icon: UserCircle2 },
      can('branches:manage') ? { to: '/branches', label: 'Branches', icon: Building2 } : (role === 'manager' && user.branchId && { to: `/branches/${user.branchId}`, label: 'My branch', icon: Building2 }),
      can('reports:branch', 'reports:system') && { to: '/reports', label: 'Reports', icon: BarChart3 },
      can('audit:read') && { to: '/audit-logs', label: 'Audit logs', icon: ClipboardList },
      can('settings:manage', 'roles:manage') && { to: '/settings', label: 'Settings & roles', icon: Settings },
      can('system:network', 'system:api_keys') && { to: '/security', label: 'Security & network', icon: Network },
    ] },
  ];
  return sections.map((s) => ({ ...s, items: s.items.filter(Boolean) })).filter((s) => s.items.length);
}

export function Layout() {
  const auth = useAuth();
  const { user, logout } = auth;
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef(null);
  const unread = useApi('/notifications/unread-count', null, { reloadKey: location.pathname });
  const approvals = useApi(auth.can('approvals:read') ? '/approvals' : null, { status: 'pending', pageSize: 1 }, { reloadKey: location.pathname });

  useEffect(() => { setOpen(false); setMenu(false); }, [location.pathname]);
  useEffect(() => {
    const close = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenu(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const count = unread.data ? unread.data.unread : 0;
  const pending = approvals.body && approvals.body.pagination ? approvals.body.pagination.total : 0;
  const doLogout = async () => { await logout(); navigate('/login'); };

  return (
    <div className="shell">
      <aside className={`sidebar ${open ? 'open' : ''}`} aria-label="Main navigation">
        <div className="brand"><div className="brand-mark">K</div><div>Kestrel Bank<small>{user.role === 'customer' ? 'Online banking' : 'Staff portal'}</small></div></div>
        {navFor(auth).map((s) => (
          <div className="nav-section" key={s.section}>
            <div className="nav-label">{s.section}</div>
            {s.items.map((it) => (
              <NavLink key={it.to} to={it.to} end={it.end} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                <it.icon size={17} />{it.label}
                {it.badge === 'approvals' && pending > 0 && <span className="badge-count">{pending}</span>}
              </NavLink>
            ))}
          </div>
        ))}
        <div className="sidebar-foot">Simulated environment for authorized security testing. All data is fictional.</div>
      </aside>
      <div className={`scrim ${open ? 'open' : ''}`} onClick={() => setOpen(false)} aria-hidden="true" />
      <div className="main">
        <div className="demo-banner">Demo environment — data resets when the server restarts. No real money moves.</div>
        <header className="topbar">
          <button type="button" className="icon-btn menu-btn" aria-label="Open menu" onClick={() => setOpen(true)}><Menu size={18} /></button>
          <div className="row muted" style={{ fontSize: 13 }}>
            {user.branchName && <><Landmark size={15} />{user.branchName}</>}
          </div>
          <div className="spacer" />
          <button type="button" className="icon-btn" aria-label={`Notifications (${count} unread)`} onClick={() => navigate('/notifications')}>
            <Bell size={17} />{count > 0 && <span className="dot">{count > 99 ? '99+' : count}</span>}
          </button>
          <div className="dropdown" ref={menuRef}>
            <button type="button" className="user-chip" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
              <span className="avatar">{initials(user.firstName, user.lastName)}</span>
              <span className="who"><b>{user.firstName} {user.lastName}</b><span>{label(user.role)}</span></span>
            </button>
            {menu && (
              <div className="dropdown-menu" role="menu">
                <div style={{ padding: '8px 10px' }} className="subtle">{user.email}</div>
                <button type="button" role="menuitem" onClick={() => navigate('/profile')}><UserCircle2 size={16} />Profile</button>
                <button type="button" role="menuitem" onClick={() => navigate('/profile?tab=security')}><KeyRound size={16} />Password & sessions</button>
                <button type="button" role="menuitem" onClick={() => navigate('/notifications')}><Bell size={16} />Notifications</button>
                {auth.can('audit:read') && <button type="button" role="menuitem" onClick={() => navigate('/security?tab=guardrails')}><ShieldCheck size={16} />Guardrail events</button>}
                <button type="button" role="menuitem" onClick={doLogout}><LogOut size={16} />Sign out</button>
              </div>
            )}
          </div>
        </header>
        <main className="content"><Outlet /></main>
      </div>
    </div>
  );
}
