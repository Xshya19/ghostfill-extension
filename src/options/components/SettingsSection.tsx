import React from 'react';

interface SettingsSectionProps {
  id: string;
  title: string;
  icon: string;
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
      className={`settings-section${variant === 'danger' ? ' danger' : ''}`}
      aria-labelledby={`${id}-title`}
    >
      <h2 id={`${id}-title`}>
        {icon} {title}
      </h2>
      {children}
    </section>
  );
};

export default SettingsSection;
