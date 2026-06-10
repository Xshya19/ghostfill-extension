import React from 'react';

interface SettingsSectionProps {
  id: string;
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  variant?: 'default' | 'danger';
}

const SettingsSection: React.FC<SettingsSectionProps> = ({
  id,
  title,
  icon,
  children,
  variant = 'default',
}) => {
  return (
    <section
      className={`ghost-card settings-section${variant === 'danger' ? ' danger' : ''}`}
      aria-labelledby={`${id}-title`}
    >
      <h2 id={`${id}-title`}>
        <span className="section-icon" aria-hidden="true">
          {icon}
        </span>{' '}
        {title}
      </h2>
      {children}
    </section>
  );
};

export default SettingsSection;
