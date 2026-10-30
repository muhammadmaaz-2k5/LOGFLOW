import React, { createContext, useContext, useEffect, useState } from 'react';
import type { UserDto } from '@logflow/shared';
import { apiClient } from '../api/client';

interface AuthContextValue {
  user: UserDto | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserDto | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('logflow_token');
    if (!token) {
      setLoading(false);
      return;
    }
    apiClient
      .me()
      .then((res) => setUser(res.user))
      .catch(() => {
        localStorage.removeItem('logflow_token');
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = async (email: string, password: string) => {
    const res = await apiClient.login(email, password);
    localStorage.setItem('logflow_token', res.token);
    setUser(res.user);
  };

  const register = async (name: string, email: string, password: string) => {
    const res = await apiClient.register(name, email, password);
    localStorage.setItem('logflow_token', res.token);
    setUser(res.user);
  };

  const logout = () => {
    localStorage.removeItem('logflow_token');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
};

