import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';

export const RegisterPage: React.FC = () => {
  const { register } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await register(name, email, password);
      navigate('/');
    } catch (err: any) {
      setError(err.message || 'Registration failed');
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

        <h2 style={{ fontSize: 'var(--lf-text-lg)', marginBottom: 4 }}>Create your workspace</h2>
        <p style={{ color: 'var(--lf-text-muted)', fontSize: 'var(--lf-text-sm)', marginTop: 0 }}>
          Start ingesting logs from your services in under 60 seconds.
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
            <label htmlFor="reg-name" className="lf-label">
              Full Name
            </label>
            <input
              id="reg-name"
              type="text"
              className="lf-input"
              placeholder="Alex Rivera"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div className="lf-field">
            <label htmlFor="reg-email" className="lf-label">
              Work Email
            </label>
            <input
              id="reg-email"
              type="email"
              className="lf-input"
              placeholder="alex@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="lf-field">
            <label htmlFor="reg-password" className="lf-label">
              Password (min 8 chars)
            </label>
            <input
              id="reg-password"
              type="password"
              className="lf-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
            />
          </div>

          <button
            type="submit"
            className="lf-btn lf-btn--primary"
            style={{ width: '100%', justifyContent: 'center' }}
            disabled={submitting}
          >
            <Icon name="user" size={16} />
            <span>{submitting ? 'Creating account…' : 'Create Account'}</span>
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
          <span>Already have an account?</span>
          <Link to="/login">Sign in →</Link>
        </div>
      </div>
    </div>
  );
};

