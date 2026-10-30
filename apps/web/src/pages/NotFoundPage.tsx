import React from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';

export const NotFoundPage: React.FC = () => {
  return (
    <div className="lf-empty" style={{ minHeight: '70vh' }}>
      <img src="/assets/illustrations/error-404.svg" alt="404 page not found" />
      <h1 style={{ fontSize: 'var(--lf-text-xl)', marginBottom: 4 }}>Page Not Found</h1>
      <p style={{ color: 'var(--lf-text-muted)', maxWidth: 420, margin: '0 0 16px' }}>
        The route or log stream you requested could not be located in this workspace.
      </p>
      <Link to="/" className="lf-btn lf-btn--primary">
        <Icon name="dashboard" size={16} />
        <span>Back to Overview</span>
      </Link>
    </div>
  );
};

