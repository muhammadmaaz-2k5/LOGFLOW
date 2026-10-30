import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';

export const LoginPage: React.FC = () => {
  const { login } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  const [email, setEmail] = useState('alex@logflow.dev');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err: any) {
      setError(err.message || 'Sign in failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="lf-auth-page">
      <div className="lf-card lf-auth-card">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 'var(--lf-space-5)'
          }}
        >
          <img
            src={
              theme === 'dark'
                ? '/assets/brand/logo-full-dark-bg.svg'
                : '/assets/brand/logo-full-light-bg.svg'
            }
            alt="LogFlow"
            height={36}
          />
          <button
            type="button"
            className="lf-btn lf-btn--ghost lf-btn--icon"
            onClick={toggleTheme}
            aria-label="Toggle theme"
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={18} />
          </button>
        </div>

        <h2 style={{ fontSize: 'var(--lf-text-lg)', marginBottom: 4 }}>Sign in to LogFlow</h2>
        <p style={{ color: 'var(--lf-text-muted)', fontSize: 'var(--lf-text-sm)', marginTop: 0 }}>
          Centralized log search, live tailing, and real-time alerting.
        </p>

        {error ? (
          <div
            role="alert"
            style={{
              padding: '10px 12px',
              background: 'var(--lf-error-bg)',
              color: 'var(--lf-error)',
              borderRadius: 'var(--lf-radius)',
              fontSize: 'var(--lf-text-xs)',
              marginBottom: 'var(--lf-space-4)',
              display: 'flex',
              alignItems: 'center',
              gap: 8
            }}
          >
            <Icon name="error" size={16} />
            <span>{error}</span>
          </div>
        ) : null}

        <form onSubmit={handleSubmit}>
          <div className="lf-field">
            <label htmlFor="login-email" className="lf-label">
              Work Email
            </label>
            <input
              id="login-email"
              type="email"
              className="lf-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>

          <div className="lf-field">
            <label htmlFor="login-password" className="lf-label">
              Password
            </label>
            <input
              id="login-password"
              type="password"
              className="lf-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>

          <button
            type="submit"
            className="lf-btn lf-btn--primary"
            style={{ width: '100%', justifyContent: 'center' }}
            disabled={submitting}
          >
            <Icon name="lock" size={16} />
            <span>{submitting ? 'Signing in…' : 'Sign In'}</span>
          </button>

        </form>

        <div
          style={{
            marginTop: 'var(--lf-space-4)',
            paddingTop: 'var(--lf-space-3)',
            borderTop: '1px solid var(--lf-border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: 'var(--lf-text-xs)',
            color: 'var(--lf-text-muted)'
          }}
        >
          <span>New to LogFlow?</span>
          <Link to="/register">Create an account →</Link>
        </div>
      </div>
    </div>
  );
};

