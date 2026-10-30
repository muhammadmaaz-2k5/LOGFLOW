import React from 'react';

interface IconProps {
  name: string;
  size?: number;
  className?: string;
  title?: string;
}

export const Icon: React.FC<IconProps> = ({ name, size = 18, className = '', title }) => {
  const cleanName = name.startsWith('lf-') ? name.slice(3) : name;
  return (
    <svg
      className={`lf-icon ${className}`.trim()}
      style={{ width: size, height: size }}
      aria-hidden={title ? undefined : 'true'}
      role={title ? 'img' : undefined}
    >
      {title ? <title>{title}</title> : null}
      <use href={`/assets/icons/sprite.svg#lf-${cleanName}`} />
    </svg>
  );
};

