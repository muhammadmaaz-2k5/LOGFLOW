import React, { useEffect, useState } from 'react';
import type { TeamRole, UserDto } from '@logflow/shared';
import { apiClient } from '../api/client';
import { Icon } from '../components/Icon';
import { useAuth } from '../context/AuthContext';
import { useProjects } from '../context/ProjectContext';
import { useTheme } from '../context/ThemeContext';

export const SettingsPage: React.FC = () => {
  const { user } = useAuth();
  const { activeProject, refreshProjects } = useProjects();
  const { theme, setTheme } = useTheme();

  const [retentionDays, setRetentionDays] = useState<number>(activeProject?.retention_days ?? 30);
  const [projectName, setProjectName] = useState<string>(activeProject?.name ?? '');
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const [members, setMembers] = useState<UserDto[]>([]);
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<TeamRole>('member');
  const [teamError, setTeamError] = useState<string | null>(null);

  useEffect(() => {
    if (activeProject) {
      setRetentionDays(activeProject.retention_days);
      setProjectName(activeProject.name);
    }
  }, [activeProject]);

  const loadTeam = async () => {
    const res = await apiClient.getTeamMembers();
    setMembers(res.members);
  };

  useEffect(() => {
    loadTeam();
  }, []);

  const handleSaveProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeProject) return;
    await apiClient.updateProject(activeProject.id, {
      name: projectName,
      retention_days: retentionDays
    });
    await refreshProjects();
    setSaveMessage('Project retention and settings saved.');
    setTimeout(() => setSaveMessage(null), 2500);
  };

  const handleInviteMember = async (e: React.FormEvent) => {
    e.preventDefault();
    setTeamError(null);
    try {
      await apiClient.inviteTeamMember({
        name: inviteName,
        email: inviteEmail,
        role: inviteRole
      });
      setInviteName('');
      setInviteEmail('');
      await loadTeam();
    } catch (err: any) {
      setTeamError(err.message);
    }
  };

  const handleChangeRole = async (userId: string, role: TeamRole) => {
    setTeamError(null);
    try {
      await apiClient.updateMemberRole(userId, role);
      await loadTeam();
    } catch (err: any) {
      setTeamError(err.message);
    }
  };

  const handleRemoveMember = async (userId: string) => {
    setTeamError(null);
    try {
      await apiClient.removeMember(userId);
      await loadTeam();
    } catch (err: any) {
      setTeamError(err.message);
    }
  };

  return (
    <div>
      <div className="lf-page-header">
        <div>
          <h1 className="lf-page-title">Workspace Settings</h1>
          <p className="lf-page-subtitle">
            Configure project log retention policies, team members & RBAC roles, and UI appearance.
          </p>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
          gap: 'var(--lf-space-5)',
          marginBottom: 'var(--lf-space-5)'
        }}
      >
        <div className="lf-card">
          <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="retention" size={18} />
            <span>Log Retention Policy</span>
          </h3>
          <p style={{ color: 'var(--lf-text-muted)', fontSize: 'var(--lf-text-sm)' }}>
            Events older than the retention window are automatically purged from the log storage adapter.
          </p>

          <form onSubmit={handleSaveProject}>
            <div className="lf-field">
              <label htmlFor="settings-proj-name" className="lf-label">
                Active Project Name
              </label>
              <input
                id="settings-proj-name"
                className="lf-input"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                required
              />
            </div>

            <div className="lf-field">
              <label htmlFor="settings-retention" className="lf-label">
                Retention Window (Days)
              </label>
              <select
                id="settings-retention"
                className="lf-select"
                style={{ width: '100%' }}
                value={retentionDays}
                onChange={(e) => setRetentionDays(Number(e.target.value))}
              >
                <option value={7}>7 days (Development)</option>
                <option value={14}>14 days (Staging)</option>
                <option value={30}>30 days (Standard Production)</option>
                <option value={60}>60 days (Extended)</option>
                <option value={90}>90 days (Compliance Quarter)</option>
                <option value={365}>365 days (Annual Archive)</option>
              </select>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button type="submit" className="lf-btn lf-btn--primary">
                <Icon name="check" size={16} />
                <span>Save Retention Policy</span>
              </button>
              {saveMessage ? (
                <span style={{ color: 'var(--lf-teal)', fontSize: 'var(--lf-text-xs)' }}>
                  {saveMessage}
                </span>
              ) : null}
            </div>
          </form>
        </div>

        <div className="lf-card">
          <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name={theme === 'dark' ? 'moon' : 'sun'} size={18} />
            <span>Appearance & Theme</span>
          </h3>
          <p style={{ color: 'var(--lf-text-muted)', fontSize: 'var(--lf-text-sm)' }}>
            Choose your preferred interface theme. Your choice is persisted on this device via{' '}
            <code>data-theme="dark"</code> on <code>&lt;html&gt;</code>.
          </p>

          <div style={{ display: 'flex', gap: 12, marginTop: 'var(--lf-space-4)' }}>
            <button
              type="button"
              className={`lf-btn ${theme === 'light' ? 'lf-btn--primary' : 'lf-btn--secondary'}`}
              onClick={() => setTheme('light')}
            >
              <Icon name="sun" size={16} />
              <span>Light Mode (Paper)</span>
            </button>

            <button
              type="button"
              className={`lf-btn ${theme === 'dark' ? 'lf-btn--primary' : 'lf-btn--secondary'}`}
              onClick={() => setTheme('dark')}
            >
              <Icon name="moon" size={16} />
              <span>Dark Mode (Trench Navy)</span>
            </button>
          </div>
        </div>
      </div>

      <div className="lf-card">
        <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="users" size={18} />
          <span>Team Members & Roles</span>
        </h3>

        {teamError ? (
          <div
            role="alert"
            style={{
              padding: '8px 12px',
              background: 'var(--lf-error-bg)',
              color: 'var(--lf-error)',
              borderRadius: 'var(--lf-radius)',
              fontSize: 'var(--lf-text-xs)',
              marginBottom: 'var(--lf-space-3)'
            }}
          >
            {teamError}
          </div>
        ) : null}

        <div className="lf-table-wrap" style={{ marginBottom: 'var(--lf-space-4)' }}>
          <table className="lf-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Joined</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}>
                  <td style={{ fontWeight: 600 }}>{m.name}</td>
                  <td>{m.email}</td>
                  <td>
                    <select
                      className="lf-select"
                      value={m.role}
                      disabled={user?.role !== 'admin'}
                      onChange={(e) => handleChangeRole(m.id, e.target.value as TeamRole)}
                      aria-label={`Role for ${m.name}`}
                    >
                      <option value="admin">Admin</option>
                      <option value="member">Member</option>
                      <option value="viewer">Viewer</option>
                    </select>
                  </td>
                  <td style={{ color: 'var(--lf-text-muted)', fontSize: 'var(--lf-text-xs)' }}>
                    {new Date(m.created_at).toLocaleDateString()}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {user?.role === 'admin' && m.id !== user.id ? (
                      <button
                        type="button"
                        className="lf-btn lf-btn--ghost"
                        style={{ color: 'var(--lf-error)' }}
                        onClick={() => handleRemoveMember(m.id)}
                      >
                        <Icon name="trash" size={15} />
                        <span>Remove</span>
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {user?.role === 'admin' ? (
          <form
            onSubmit={handleInviteMember}
            style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}
          >
            <div style={{ flex: 1, minWidth: 180 }}>
              <label htmlFor="invite-name" className="lf-label">
                Member Name
              </label>
              <input
                id="invite-name"
                className="lf-input"
                placeholder="Jordan Lee"
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
                required
              />
            </div>

            <div style={{ flex: 1, minWidth: 200 }}>
              <label htmlFor="invite-email" className="lf-label">
                Email Address
              </label>
              <input
                id="invite-email"
                type="email"
                className="lf-input"
                placeholder="jordan@logflow.dev"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                required
              />
            </div>

            <div style={{ width: 140 }}>
              <label htmlFor="invite-role" className="lf-label">
                Role
              </label>
              <select
                id="invite-role"
                className="lf-select"
                style={{ width: '100%' }}
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as TeamRole)}
              >
                <option value="admin">Admin</option>
                <option value="member">Member</option>
                <option value="viewer">Viewer</option>
              </select>
            </div>

            <button type="submit" className="lf-btn lf-btn--primary">
              <Icon name="plus" size={16} />
              <span>Add Team Member</span>
            </button>
          </form>
        ) : null}
      </div>
    </div>
  );
};

