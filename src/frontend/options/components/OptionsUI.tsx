import { Settings, Mail, Lock, Zap, Shield, Brain, Info } from 'lucide-react';
import React, { useCallback, useEffect, useId, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Settings navigation and field primitives
// ---------------------------------------------------------------------------

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
  }>;
}

// No per-row shortcut hint: the binding is Ctrl/Cmd+Alt+N, which "⌥N" states
// wrongly on Windows — and U+2325 has no glyph in IBM Plex Mono, so it rendered
// as a tofu box on every row. Ctrl+K search covers the same need, once.
const TAB_GROUPS: TabGroup[] = [
  {
    title: 'Configuration',
    items: [
      { id: 'general', label: 'General', icon: <Settings size={17} /> },
      { id: 'email', label: 'Email', icon: <Mail size={17} /> },
      { id: 'password', label: 'Passwords', icon: <Lock size={17} /> },
      { id: 'automation', label: 'Automation', icon: <Zap size={17} /> },
    ],
  },
  {
    title: 'System & privacy',
    items: [
      { id: 'privacy', label: 'Privacy', icon: <Shield size={17} /> },
      { id: 'advanced', label: 'Advanced', icon: <Brain size={17} /> },
    ],
  },
  {
    title: 'Information',
    items: [{ id: 'about', label: 'About', icon: <Info size={17} /> }],
  },
];

const ALL_TABS = TAB_GROUPS.flatMap((group) => group.items);

interface SidebarProps {
  activeTab: TabId;
  onTabChange: (tab: TabId, input: 'pointer' | 'keyboard') => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, onTabChange }) => {
  const [compact, setCompact] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(max-width: 860px)').matches
      : false
  );

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      return;
    }
    const query = window.matchMedia('(max-width: 860px)');
    const update = () => setCompact(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return (
    <nav className="settings-sidebar liquid-glass" aria-label="Settings navigation">
      <div
        className="settings-tablist"
        role="tablist"
        aria-label="Settings sections"
        aria-orientation={compact ? 'horizontal' : 'vertical'}
      >
        {TAB_GROUPS.map((group, groupIdx) => (
          <div
            key={group.title}
            className="sidebar-group"
            role="group"
            aria-labelledby={`settings-nav-group-${groupIdx}`}
          >
            <div id={`settings-nav-group-${groupIdx}`} className="sidebar-nav-section-label">
              {group.title}
            </div>
            <div className="sidebar-nav">
              {group.items.map((tab) => {
                const globalIndex = ALL_TABS.findIndex((item) => item.id === tab.id);
                const isActive = activeTab === tab.id;

                return (
                  <button
                    key={tab.id}
                    role="tab"
                    aria-selected={isActive}
                    aria-controls="settings-tab-panel"
                    id={`tab-${tab.id}`}
                    tabIndex={isActive ? 0 : -1}
                    className={`sidebar-nav-item${isActive ? ' active' : ''}`}
                    onClick={(event) =>
                      onTabChange(tab.id, event.detail === 0 ? 'keyboard' : 'pointer')
                    }
                    onKeyDown={(event) => {
                      let targetIndex = -1;
                      if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
                        event.preventDefault();
                        targetIndex = (globalIndex + 1) % ALL_TABS.length;
                      } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
                        event.preventDefault();
                        targetIndex = (globalIndex - 1 + ALL_TABS.length) % ALL_TABS.length;
                      } else if (event.key === 'Home') {
                        event.preventDefault();
                        targetIndex = 0;
                      } else if (event.key === 'End') {
                        event.preventDefault();
                        targetIndex = ALL_TABS.length - 1;
                      }
                      if (targetIndex >= 0) {
                        const target = ALL_TABS[targetIndex];
                        if (target) {
                          onTabChange(target.id, 'keyboard');
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
                  </button>
                );
              })}
            </div>
            {groupIdx < TAB_GROUPS.length - 1 && <div className="sidebar-nav-divider" />}
          </div>
        ))}
      </div>
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
}) => (
  <section
    className={`settings-section${variant === 'danger' ? ' danger' : ''}`}
    aria-labelledby={`${id}-title`}
  >
    <h3 id={`${id}-title`}>
      <span className="section-icon" aria-hidden="true">
        {icon}
      </span>
      {title}
    </h3>
    {children}
  </section>
);

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
}) => (
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

export interface CustomSelectOption {
  value: string;
  label: string;
}

interface CustomSelectProps {
  id?: string | undefined;
  value: string;
  onChange: (value: string) => void;
  options: CustomSelectOption[];
  ariaLabel?: string | undefined;
  ariaDescribedBy?: string | undefined;
  ariaInvalid?: boolean | undefined;
  disabled?: boolean | undefined;
}

/**
 * Accessible, in-DOM select panel. Keeping this with the other options
 * primitives ensures its tokens and interaction behavior stay consistent with
 * the sidebar, cards, and toggles.
 */
export const CustomSelect: React.FC<CustomSelectProps> = ({
  id,
  value,
  onChange,
  options,
  ariaLabel,
  ariaDescribedBy,
  ariaInvalid,
  disabled = false,
}) => {
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(() =>
    Math.max(
      0,
      options.findIndex((option) => option.value === value)
    )
  );
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const typeaheadRef = useRef('');
  const typeaheadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listboxId = useId();

  const selected = options.find((option) => option.value === value);
  const selectedLabel = selected?.label ?? 'Select…';

  useEffect(() => {
    if (!open) {
      return;
    }
    const trigger = buttonRef.current;
    if (!trigger) {
      setOpenUp(false);
      return;
    }
    try {
      const rect = trigger.getBoundingClientRect();
      const panelH = Math.min(options.length * 44 + 12, 280, window.innerHeight * 0.45);
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      setOpenUp(spaceBelow < panelH + 12 && spaceAbove > panelH + 12);
    } catch {
      setOpenUp(false);
    }
  }, [open, options.length]);

  useEffect(() => {
    if (!open) {
      const idx = options.findIndex((option) => option.value === value);
      if (idx >= 0) {
        setHighlightIdx(idx);
      }
    }
  }, [value, options, open]);

  useEffect(() => {
    if (!open || !listRef.current) {
      return;
    }
    const element = listRef.current.querySelector<HTMLElement>(`[data-idx="${highlightIdx}"]`);
    if (element) {
      const itemBounds = element.getBoundingClientRect();
      const listBounds = listRef.current.getBoundingClientRect();
      listRef.current.scrollTop +=
        Math.min(0, itemBounds.top - listBounds.top) +
        Math.max(0, itemBounds.bottom - listBounds.bottom);
    }
  }, [highlightIdx, open]);

  const close = useCallback(() => {
    setOpen(false);
    buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onDown = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  useEffect(
    () => () => {
      if (typeaheadTimerRef.current) {
        clearTimeout(typeaheadTimerRef.current);
      }
    },
    []
  );

  const selectIdx = (idx: number) => {
    const option = options[idx];
    if (!option) {
      return;
    }
    onChange(option.value);
    setOpen(false);
  };

  const onTriggerKeyDown = (event: React.KeyboardEvent) => {
    if (disabled) {
      return;
    }
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' ', 'Spacebar'].includes(event.key)) {
        event.preventDefault();
        setOpen(true);
        const current = Math.max(
          0,
          options.findIndex((option) => option.value === value)
        );
        setHighlightIdx(current);
      }
      return;
    }
    if (
      event.key.length === 1 &&
      /^[a-z0-9]$/i.test(event.key) &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      event.preventDefault();
      const previousQuery = typeaheadRef.current;
      const query = `${previousQuery}${event.key}`.toLocaleLowerCase();
      typeaheadRef.current = query;
      if (typeaheadTimerRef.current) {
        clearTimeout(typeaheadTimerRef.current);
      }
      typeaheadTimerRef.current = setTimeout(() => {
        typeaheadRef.current = '';
      }, 700);
      const start = previousQuery
        ? (highlightIdx + 1) % Math.max(options.length, 1)
        : Math.max(0, highlightIdx);
      const matchIndex = Array.from(
        { length: options.length },
        (_, idx) => (start + idx) % options.length
      ).find((idx) => options[idx]?.label.toLocaleLowerCase().startsWith(query));
      if (matchIndex !== undefined) {
        setHighlightIdx(matchIndex);
      }
      return;
    }
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setHighlightIdx((index) => Math.min(options.length - 1, index + 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setHighlightIdx((index) => Math.max(0, index - 1));
        break;
      case 'Home':
        event.preventDefault();
        setHighlightIdx(0);
        break;
      case 'End':
        event.preventDefault();
        setHighlightIdx(options.length - 1);
        break;
      case 'Enter':
      case ' ':
      case 'Spacebar':
        event.preventDefault();
        selectIdx(highlightIdx);
        break;
      case 'Tab':
        setOpen(false);
        break;
      default:
        break;
    }
  };

  return (
    <div
      ref={wrapperRef}
      className="gf-custom-select"
      data-open={open ? 'true' : undefined}
      data-open-up={open && openUp ? 'true' : undefined}
    >
      <button
        ref={buttonRef}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open ? `${listboxId}-opt-${highlightIdx}` : undefined}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        aria-disabled={disabled ? 'true' : undefined}
        disabled={disabled}
        className="gf-custom-select-trigger"
        title={selectedLabel}
        onClick={() => {
          if (!disabled) {
            setOpen((isOpen) => !isOpen);
          }
        }}
        onKeyDown={onTriggerKeyDown}
      >
        <span className="gf-custom-select-value">{selectedLabel}</span>
        <span className="gf-custom-select-chevron" aria-hidden="true" />
      </button>

      {open && (
        <ul
          id={listboxId}
          ref={listRef}
          role="listbox"
          className="gf-custom-select-panel liquid-glass"
          aria-label={ariaLabel}
          tabIndex={-1}
        >
          {options.map((option, idx) => {
            const isSelected = option.value === value;
            const isHighlighted = idx === highlightIdx;
            return (
              <li
                key={option.value}
                id={`${listboxId}-opt-${idx}`}
                data-idx={idx}
                role="option"
                aria-selected={isSelected}
                className={[
                  'gf-custom-select-option',
                  isSelected ? 'is-selected' : '',
                  isHighlighted ? 'is-highlighted' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onMouseEnter={() => setHighlightIdx(idx)}
                onMouseDown={(event) => event.preventDefault()}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    selectIdx(idx);
                  }
                }}
                onClick={() => selectIdx(idx)}
              >
                <span className="gf-custom-select-option-label">{option.label}</span>
                {isSelected && (
                  <span className="gf-custom-select-check" aria-hidden="true">
                    ✓
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
