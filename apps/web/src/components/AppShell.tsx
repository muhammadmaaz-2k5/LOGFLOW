import React, { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useProjects } from '../context/ProjectContext';
import { useTheme } from '../context/ThemeContext';
import { Icon } from './Icon';

export const AppShell: React.FC = () => {
  const { user, logout } = useAuth();
  const { projects, activeProject, setActiveProjectId } = useProjects();
  const { theme, toggleTheme } = useTheme();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const navigate = useNavigate();

  const navItems = [
    { to: '/', label: 'Overview', icon: 'dashboard', end: true },
    { to: '/logs', label: 'Logs Explorer', icon: 'logs' },
    { to: '/tail', label: 'Live Tail', icon: 'live-tail' },
    { to: '/alerts', label: 'Alerts', icon: 'alert' },
    { to: '/sources', label: 'Sources & Keys', icon: 'source' },
    { to: '/settings', label: 'Settings', icon: 'settings' }
  ];

  return (
    <div className="lf-app">
      <aside
        className={`lf-nav ${mobileMenuOpen ? 'lf-nav--open' : ''}`.trim()}
        aria-label="Main Navigation"
      >
        <div className="lf-nav__brand">
          <img
            src="/assets/brand/logo-full-dark-bg.svg"
            alt="LogFlow"
            height={32}
            style={{ display: 'block' }}
          />
          <button
            type="button"
            className="lf-btn lf-btn--ghost lf-btn--icon lf-mobile-toggle"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Close navigation menu"
          >
            <Icon name="x" />
          </button>
        </div>

        <div className="lf-nav__section">Observability</div>
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={() => setMobileMenuOpen(false)}
          >
            <Icon name={item.icon} size={18} />
            <span>{item.label}</span>
          </NavLink>
        ))}

        <div className="lf-nav__footer">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 10px',
              borderRadius: 'var(--lf-radius)',
              background: 'rgba(255,255,255,0.04)'
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  color: '#fff',
                  fontSize: '13px',
                  fontWeight: 600,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
              >
                {user?.name}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--lf-navy-300)' }}>
                {user?.role.toUpperCase()} · {user?.email}
              </div>
            </div>
            <button
              type="button"
              className="lf-btn lf-btn--ghost lf-btn--icon"
              onClick={() => {
                logout();
                navigate('/login');
              }}
              title="Sign out"
              aria-label="Sign out"
              style={{ color: 'var(--lf-navy-300)' }}
            >
              <Icon name="logout" size={16} />
            </button>
          </div>
        </div>
      </aside>

      <div className="lf-workspace">
        <header className="lf-topbar">
          <div className="lf-topbar__left">
            <button
              type="button"
              className="lf-btn lf-btn--secondary lf-btn--icon lf-mobile-toggle"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
            >
              <Icon name="menu" />
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="database" size={16} />
              <label htmlFor="project-switcher" style={{ fontSize: 12, color: 'var(--lf-text-muted)', fontWeight: 600 }}>
                Project:
              </label>
              <select
                id="project-switcher"
                className="lf-select"
                value={activeProject?.id ?? ''}
                onChange={(e) => setActiveProjectId(e.target.value)}
                aria-label="Select active project"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.retention_days}d retention)
                  </option>
                ))}
              </select>
            </div>

            {activeProject ? (
              <span className="lf-live" title="Ingestion pipeline online">
                {activeProject.events_per_minute ?? 0} evt/min
              </span>
            ) : null}
          </div>

          <div className="lf-topbar__right">
            <button
              type="button"
              className="lf-btn lf-btn--secondary"
              onClick={() => navigate('/tail')}
              title="Open real-time live tail"
            >
              <Icon name="live-tail" size={16} />
              <span>Live Tail</span>
            </button>

            <button
              type="button"
              className="lf-btn lf-btn--secondary lf-btn--icon"
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
              title={`Theme: ${theme === 'dark' ? 'Dark' : 'Light'}`}
            >
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={18} />
            </button>
          </div>
        </header>

        <main className="lf-main" id="main-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
};
