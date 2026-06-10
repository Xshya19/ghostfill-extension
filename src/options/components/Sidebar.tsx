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

interface TabItem {
  id: TabId;
  label: string;
  icon: React.ReactNode;
}

const TABS: TabItem[] = [
  { id: 'general', label: 'General', icon: <Settings size={18} /> },
  { id: 'email', label: 'Email', icon: <Mail size={18} /> },
  { id: 'password', label: 'Passwords', icon: <Lock size={18} /> },
  { id: 'automation', label: 'Automation', icon: <Zap size={18} /> },
  { id: 'privacy', label: 'Privacy', icon: <Shield size={18} /> },
  { id: 'advanced', label: 'Advanced', icon: <Brain size={18} /> },
  { id: 'about', label: 'About', icon: <Info size={18} /> },
];

interface SidebarProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ activeTab, onTabChange }) => {
  return (
    <nav className="settings-sidebar" role="tablist" aria-label="Settings navigation">
      {TABS.map((tab, index) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={activeTab === tab.id}
          aria-controls={`tabpanel-${tab.id}`}
          id={`tab-${tab.id}`}
          tabIndex={activeTab === tab.id ? 0 : -1}
          className={`sidebar-tab${activeTab === tab.id ? ' sidebar-tab--active' : ''}`}
          onClick={() => onTabChange(tab.id)}
          onKeyDown={(e) => {
            let targetIndex = -1;
            if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
              e.preventDefault();
              targetIndex = (index + 1) % TABS.length;
            } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
              e.preventDefault();
              targetIndex = (index - 1 + TABS.length) % TABS.length;
            } else if (e.key === 'Home') {
              e.preventDefault();
              targetIndex = 0;
            } else if (e.key === 'End') {
              e.preventDefault();
              targetIndex = TABS.length - 1;
            }
            if (targetIndex >= 0) {
              const target = TABS[targetIndex];
              if (target) {
                onTabChange(target.id);
                document.getElementById(`tab-${target.id}`)?.focus();
              }
            }
          }}
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
