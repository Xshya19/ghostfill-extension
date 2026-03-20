import React from 'react';

export type TabId =
  | 'general'
  | 'email'
  | 'password'
  | 'automation'
  | 'privacy'
  | 'advanced'
  | 'about';

interface TabItem {
  id: TabId;
  label: string;
  icon: string;
}

const TABS: TabItem[] = [
  { id: 'general', label: 'General', icon: '🎨' },
  { id: 'email', label: 'Email', icon: '📧' },
  { id: 'password', label: 'Passwords', icon: '🔐' },
  { id: 'automation', label: 'Automation', icon: '⚡' },
  { id: 'privacy', label: 'Privacy', icon: '🔒' },
  { id: 'advanced', label: 'Advanced', icon: '🧠' },
  { id: 'about', label: 'About', icon: 'ℹ️' },
];

interface SidebarProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ activeTab, onTabChange }) => {
  return (
    <nav className="settings-sidebar" role="tablist" aria-label="Settings navigation">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={activeTab === tab.id}
          aria-controls={`tabpanel-${tab.id}`}
          id={`tab-${tab.id}`}
          className={`sidebar-tab${activeTab === tab.id ? ' sidebar-tab--active' : ''}`}
          onClick={() => onTabChange(tab.id)}
          type="button"
        >
          <span className="sidebar-tab-icon" aria-hidden="true">
            {tab.icon}
          </span>
          <span className="sidebar-tab-label">{tab.label}</span>
        </button>
      ))}
    </nav>
  );
};

export default Sidebar;
