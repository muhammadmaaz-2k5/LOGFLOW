import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ProjectDto } from '@logflow/shared';
import { apiClient } from '../api/client';
import { useAuth } from './AuthContext';

interface ProjectContextValue {
  projects: ProjectDto[];
  activeProject: ProjectDto | null;
  setActiveProjectId: (id: string) => void;
  refreshProjects: () => Promise<void>;
  loading: boolean;
}

const ProjectContext = createContext<ProjectContextValue | undefined>(undefined);

export const ProjectProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [activeId, setActiveId] = useState<string>(() => {
    return localStorage.getItem('logflow_project_id') || 'prj_production_core';
  });
  const [loading, setLoading] = useState(false);

  const refreshProjects = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const res = await apiClient.getProjects();
      setProjects(res.projects);
      if (res.projects.length > 0 && !res.projects.some((p) => p.id === activeId)) {
        const firstId = res.projects[0].id;
        setActiveId(firstId);
        localStorage.setItem('logflow_project_id', firstId);
      }
    } finally {
      setLoading(false);
    }
  }, [user, activeId]);

  useEffect(() => {
    if (user) {
      refreshProjects();
    } else {
      setProjects([]);
    }
  }, [user, refreshProjects]);

  const setActiveProjectId = (id: string) => {
    setActiveId(id);
    localStorage.setItem('logflow_project_id', id);
  };

  const activeProject = projects.find((p) => p.id === activeId) ?? projects[0] ?? null;

  return (
    <ProjectContext.Provider
      value={{
        projects,
        activeProject,
        setActiveProjectId,
        refreshProjects,
        loading
      }}
    >
      {children}
    </ProjectContext.Provider>
  );
};

export const useProjects = () => {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error('useProjects must be used inside ProjectProvider');
  return ctx;
};

