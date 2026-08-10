// Options UI Layout & Primitive Components
// Merged: Sidebar, SettingsSection, and ToggleSwitch

import { Settings, Mail, Lock, Zap, Shield, Brain, Info } from 'lucide-react';
import React from 'react';

export type TabId =
  | 'general'
  | 'email'
  | 'password'
  | 'automation'
  | 'privacy'
  | 'advanced'
  | 'about';

interface TabGroup {
  title: string;
  items: Array<{
    id: TabId;
    label: string;
    icon: React.ReactNode;
    shortcut: string;
  }>;
}

const TAB_GROUPS: TabGroup[] = [
  {
    title: 'Configuration',
    items: [
      { id: 'general', label: 'General', icon: <Settings size={17} />, shortcut: '⌥1' },
      { id: 'email', label: 'Email', icon: <Mail size={17} />, shortcut: '⌥2' },
      { id: 'password', label: 'Passwords', icon: <Lock size={17} />, shortcut: '⌥3' },
      { id: 'automation', label: 'Automation', icon: <Zap size={17} />, shortcut: '⌥4' },
    ],
  },
  {
    title: 'System & Privacy',
    items: [
      { id: 'privacy', label: 'Privacy', icon: <Shield size={17} />, shortcut: '⌥5' },
      { id: 'advanced', label: 'Advanced', icon: <Brain size={17} />, shortcut: '⌥6' },
    ],
  },
  {
    title: 'Information',
    items: [
      { id: 'about', label: 'About', icon: <Info size={17} />, shortcut: '⌥7' },
    ],
  },
];

const ALL_TABS = TAB_GROUPS.flatMap((g) => g.items);

interface SidebarProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, onTabChange }) => {
  return (
    <nav className="settings-sidebar" role="tablist" aria-label="Settings navigation">
      {TAB_GROUPS.map((group, groupIdx) => (
        <div key={group.title} className="sidebar-group">
          <div className="sidebar-nav-section-label">{group.title}</div>
          <div className="sidebar-nav">
            {group.items.map((tab) => {
              const globalIndex = ALL_TABS.findIndex((t) => t.id === tab.id);
              const isActive = activeTab === tab.id;

              return (
                <button
                  key={tab.id}
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={`tabpanel-${tab.id}`}
                  id={`tab-${tab.id}`}
                  tabIndex={isActive ? 0 : -1}
                  className={`sidebar-nav-item${isActive ? ' active' : ''}`}
                  onClick={() => onTabChange(tab.id)}
                  onKeyDown={(e) => {
                    let targetIndex = -1;
                    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
                      e.preventDefault();
                      targetIndex = (globalIndex + 1) % ALL_TABS.length;
                    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
                      e.preventDefault();
                      targetIndex = (globalIndex - 1 + ALL_TABS.length) % ALL_TABS.length;
                    } else if (e.key === 'Home') {
                      e.preventDefault();
                      targetIndex = 0;
                    } else if (e.key === 'End') {
                      e.preventDefault();
                      targetIndex = ALL_TABS.length - 1;
                    }
                    if (targetIndex >= 0) {
                      const target = ALL_TABS[targetIndex];
                      if (target) {
                        onTabChange(target.id);
                        document.getElementById(`tab-${target.id}`)?.focus();
                      }
                    }
                  }}
                  type="button"
                >
                  <span className="sidebar-nav-icon" aria-hidden="true">
                    {tab.icon}
                  </span>
                  <span className="sidebar-tab-label">{tab.label}</span>
                  <span className="sidebar-tab-shortcut" aria-hidden="true">
                    {tab.shortcut}
                  </span>
                </button>
              );
            })}
          </div>
          {groupIdx < TAB_GROUPS.length - 1 && <div className="sidebar-nav-divider" />}
        </div>
      ))}
    </nav>
  );
};

interface SettingsSectionProps {
  id: string;
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  variant?: 'default' | 'danger';
}

export const SettingsSection: React.FC<SettingsSectionProps> = ({
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

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  id?: string;
  disabled?: boolean;
}

export const ToggleSwitch: React.FC<ToggleProps> = ({
  checked,
  onChange,
  ariaLabel,
  ariaLabelledBy,
  id,
  disabled = false,
}) => {
  return (
    <button
      id={id}
      className={`toggle ${checked ? 'toggle--active' : ''}`}
      onClick={() => !disabled && onChange(!checked)}
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      aria-disabled={disabled}
      type="button"
      disabled={disabled}
      tabIndex={disabled ? -1 : 0}
    >
      <span className="toggle-slider" aria-hidden="true" />
    </button>
  );
};
