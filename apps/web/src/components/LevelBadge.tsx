import React from 'react';
import type { LogLevel } from '@logflow/shared';

export const LevelBadge: React.FC<{ level: LogLevel }> = ({ level }) => {
  return (
    <span className={`lf-level lf-level--${level}`}>
      {level.toUpperCase()}
    </span>
  );
};

