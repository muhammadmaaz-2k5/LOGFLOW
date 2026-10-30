import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ProjectProvider } from './context/ProjectContext';
import { ThemeProvider } from './context/ThemeContext';
import { AlertsPage } from './pages/AlertsPage';
import { LiveTailPage } from './pages/LiveTailPage';
import { LoginPage } from './pages/LoginPage';
import { LogsExplorerPage } from './pages/LogsExplorerPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { OverviewPage } from './pages/OverviewPage';
import { RegisterPage } from './pages/RegisterPage';
import { SettingsPage } from './pages/SettingsPage';
import { SourcesPage } from './pages/SourcesPage';

const ProtectedRoutes: React.FC = () => {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: 'var(--lf-text-muted)' }}>
        Loading LogFlow workspace…
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return (
    <ProjectProvider>
      <AppShell />
    </ProjectProvider>
  );
};

export const App: React.FC = () => {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route element={<ProtectedRoutes />}>
              <Route index element={<OverviewPage />} />
              <Route path="logs" element={<LogsExplorerPage />} />
              <Route path="tail" element={<LiveTailPage />} />
              <Route path="alerts" element={<AlertsPage />} />
              <Route path="sources" element={<SourcesPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
};

