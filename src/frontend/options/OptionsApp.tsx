import { Sun, Moon, Search, X, Check, AlertCircle, Clock, Loader2 } from 'lucide-react';
import React, { useState, useEffect, useCallback, useRef, useMemo, useId } from 'react';

import { storageService } from '../../services/storageService';
import { applyTheme, resolveTheme } from '../../shared/theme';
import { UserSettings, DEFAULT_SETTINGS } from '../../types/storage.types';
import { APP_VERSION } from '../../utils/core';
import { createLogger } from '../../utils/logger';
import { t } from '../i18n';
import { GhostLogo } from '../popup/components/SharedComponents';
import { Button } from '../ui';

import {
  AboutTab,
  AdvancedTab,
  AutomationTab,
  EmailTab,
  GeneralTab,
  PasswordTab,
  PrivacyTab,
  EMAIL_SERVICE_OPTIONS,
} from './components/OptionsTabs';
import { Sidebar, TabId } from './components/OptionsUI';

const log = createLogger('OptionsApp');

const hasRuntimeMessaging = (): boolean =>
  typeof chrome !== 'undefined' && typeof chrome.runtime?.sendMessage === 'function';

// ═══════════════════════════════════════════════════════════════
//  §1  T Y P E S
// ═══════════════════════════════════════════════════════════════

export type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'failed' | 'invalid';

type SettingsFormErrors = Record<string, string> & {
  passwordDefaults?: Record<string, string>;
};

interface SessionSecretsState {
  customDomainKey: string;
}

interface ConfirmModalState {
  open: boolean;
  title: string;
  message: string;
  action: () => void;
  type: 'danger' | 'warning';
  confirmText?: string;
  showCancel?: boolean;
}

const EMPTY_MODAL: ConfirmModalState = {
  open: false,
  title: '',
  message: '',
  action: () => {},
  type: 'warning',
};

const TAB_ORDER: Array<{ id: TabId; label: string; hint: string }> = [
  { id: 'general', label: 'General', hint: 'Appearance, notifications, and app data' },
  { id: 'email', label: 'Email', hint: 'Providers and custom domains' },
  { id: 'password', label: 'Passwords', hint: 'Secure password defaults' },
  { id: 'automation', label: 'Automation', hint: 'Verification codes, links, and shortcuts' },
  { id: 'privacy', label: 'Privacy', hint: 'History and data retention' },
  { id: 'advanced', label: 'Advanced', hint: 'Debug logging, console help, import, and reset' },
  { id: 'about', label: 'About', hint: 'Version, storage, and support' },
];

// ═══════════════════════════════════════════════════════════════
//  §2  V A L I D A T I O N
// ═══════════════════════════════════════════════════════════════

function validateSettings(s: UserSettings): SettingsFormErrors {
  const errors: SettingsFormErrors = {};

  // PERMANENT FIX 2026-06-21: previously only `passwordDefaults.length`
  // was actually validated. The other three fields claimed by
  // ALL_VALIDATED_FIELDS were never checked — silently accepting
  // nonsensical values. Now they are.
  const { length } = s.passwordDefaults;
  if (length < 8) {
    errors.passwordDefaults = {
      ...errors.passwordDefaults,
      length: t('passwordLengthMin'),
    };
  } else if (length > 128) {
    errors.passwordDefaults = {
      ...errors.passwordDefaults,
      length: t('passwordLengthMax'),
    };
  }

  if (
    !s.passwordDefaults.uppercase &&
    !s.passwordDefaults.lowercase &&
    !s.passwordDefaults.numbers &&
    !s.passwordDefaults.symbols
  ) {
    errors.passwordDefaults = {
      ...errors.passwordDefaults,
      characterSet: t('passwordCharacterTypeRequired'),
    };
  }

  // checkIntervalSeconds: 3..60 integer seconds.
  if (
    !Number.isFinite(s.checkIntervalSeconds) ||
    !Number.isInteger(s.checkIntervalSeconds) ||
    s.checkIntervalSeconds < 3 ||
    s.checkIntervalSeconds > 60
  ) {
    errors.checkIntervalSeconds = t('checkIntervalRange');
  }

  // historyRetentionDays: 1..365 integer days.
  if (
    !Number.isFinite(s.historyRetentionDays) ||
    !Number.isInteger(s.historyRetentionDays) ||
    s.historyRetentionDays < 1 ||
    s.historyRetentionDays > 365
  ) {
    errors.historyRetentionDays = t('historyRetentionRange');
  }

  // A custom provider needs both fields; inactive custom values stay saved
  // for later edits without blocking a different provider's settings.
  if (s.preferredEmailService === 'custom') {
    const domain = s.customDomain?.trim() ?? '';
    if (!domain) {
      errors.customDomain = t('customDomainRequired');
    } else if (
      /^https?:\/\//i.test(domain) ||
      !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(domain) ||
      domain.includes('..')
    ) {
      errors.customDomain = t('customDomainHostInvalid');
    }

    const endpoint = s.customDomainUrl?.trim() ?? '';
    if (!endpoint) {
      errors.customDomainUrl = t('customDomainUrlRequired');
    } else {
      try {
        const url = new URL(endpoint);
        if (url.protocol !== 'https:') {
          errors.customDomainUrl = t('customDomainHttps');
        } else if (url.hostname.length === 0) {
          errors.customDomainUrl = t('customDomainInvalid');
        }
      } catch {
        errors.customDomainUrl = t('customDomainInvalid');
      }
    }
  }

  // preferredEmailService: must be a service the backend zod enum knows.
  // Without this, an unknown value sails through to UPDATE_SETTINGS and the
  // service worker rejects the whole save ("backend rejected" with no field
  // hint and a retry that can never succeed).
  if (!EMAIL_SERVICE_OPTIONS.some((o) => o.value === (s.preferredEmailService as string))) {
    errors.preferredEmailService = `Unknown email service: ${String(s.preferredEmailService)}`;
  }

  return errors;
}

/** All fields that should be touched on a full save attempt. */
const ALL_VALIDATED_FIELDS = new Set<string>([
  'checkIntervalSeconds',
  'historyRetentionDays',
  'passwordDefaults.length',
  'passwordDefaults.characterSet',
  'customDomain',
  'customDomainUrl',
  'preferredEmailService',
]);

// ═══════════════════════════════════════════════════════════════
//  §3  H O O K S
// ═══════════════════════════════════════════════════════════════

/**
 * Manages the confirmation modal's focus trap and keyboard handling.
 */
function useModalFocusTrap(
  isOpen: boolean,
  modalRef: React.RefObject<HTMLDivElement | null>,
  onClose: () => void
): void {
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const modal = modalRef.current;
    if (!modal) {
      return;
    }

    const focusableSelector = [
      'button:not([disabled])',
      'a[href]',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[contenteditable="true"]',
      '[tabindex]:not([tabindex="-1"])',
    ].join(', ');

    const focusableEls = modal.querySelectorAll<HTMLElement>(focusableSelector);
    const first = focusableEls[0] ?? null;
    const last = focusableEls[focusableEls.length - 1] ?? null;

    first?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }

      if (e.key !== 'Tab') {
        return;
      }

      if (!modal.contains(document.activeElement)) {
        e.preventDefault();
        (e.shiftKey ? last : first)?.focus();
        return;
      }

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus();
    };
  }, [isOpen, modalRef, onClose]);
}

/** Isolates modal siblings from both keyboard and assistive technology focus. */
function useSiblingIsolation(
  isOpen: boolean,
  overlayRef: React.RefObject<HTMLElement | null>
): void {
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const overlay = overlayRef.current;
    const parent = overlay?.parentElement;
    if (!overlay || !parent) {
      return;
    }

    const siblings = Array.from(parent.children).filter(
      (child): child is HTMLElement => child !== overlay
    );
    const previous = siblings.map((sibling) => ({
      sibling,
      inert: sibling.inert,
      ariaHidden: sibling.getAttribute('aria-hidden'),
    }));

    siblings.forEach((sibling) => {
      sibling.inert = true;
      sibling.setAttribute('aria-hidden', 'true');
    });

    return () => {
      previous.forEach(({ sibling, inert, ariaHidden }) => {
        sibling.inert = inert;
        if (ariaHidden === null) {
          sibling.removeAttribute('aria-hidden');
        } else {
          sibling.setAttribute('aria-hidden', ariaHidden);
        }
      });
    };
  }, [isOpen, overlayRef]);
}

// ═══════════════════════════════════════════════════════════════
//  §4  S U B - C O M P O N E N T S
// ═══════════════════════════════════════════════════════════════

// The handler accepts both Ctrl and Cmd, so the hint has to name the one this
// user actually has. Hardcoded "⌘K" was wrong on every Windows install.
const MOD_KEY = navigator.userAgent.includes('Mac') ? '⌘' : 'Ctrl';

/** Full-page loading spinner shown during initial data fetch. */
const LoadingSpinner: React.FC = () => (
  <div className="loading" role="status" aria-live="polite">
    <Loader2 size={28} className="gf-spin" aria-hidden="true" />
    <p>{t('loadingSettings')}</p>
  </div>
);

/** Accessible live region for screen readers. */
const SAVE_LABELS = {
  idle: '',
  pending: 'Changes pending…',
  saving: 'Saving…',
  saved: 'Saved',
  failed: 'Save failed — retry?',
  invalid: 'Review settings to save',
} as const;

const ScreenReaderAnnouncer: React.FC<{ state: keyof typeof SAVE_LABELS }> = ({ state }) => (
  <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
    {state === 'saved' ? t('settingsSavedSuccessfully') : SAVE_LABELS[state]}
  </div>
);

/** Confirmation dialog with focus trap. */
const ConfirmModal: React.FC<{
  modal: ConfirmModalState;
  onClose: () => void;
  modalRef: React.RefObject<HTMLDivElement>;
}> = ({ modal, onClose, modalRef }) => {
  const overlayRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useSiblingIsolation(modal.open, overlayRef);
  useModalFocusTrap(modal.open, modalRef, onClose);

  if (!modal.open) {
    return null;
  }

  return (
    /* Backdrop clicks are a pointer convenience; Escape and the focus trap
       provide the keyboard path. */
    /* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions, jsx-a11y/no-noninteractive-element-interactions */
    <div
      ref={overlayRef}
      className="modal-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div
        ref={modalRef}
        className="modal-content liquid-glass"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <h3 id={titleId}>{modal.title}</h3>
        <p id={descriptionId}>{modal.message}</p>
        <div className="modal-actions" role="group" aria-label="Confirmation actions">
          {modal.showCancel !== false && (
            <Button onClick={onClose} type="button">
              {t('cancel')}
            </Button>
          )}
          <Button
            variant={modal.type === 'danger' ? 'danger' : 'primary'}
            onClick={() => {
              modal.action();
              onClose();
            }}
            type="button"
          >
            {modal.confirmText ?? t('confirm')}
          </Button>
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════
//  §5  M A I N   O P T I O N S   A P P
// ═══════════════════════════════════════════════════════════════

const OptionsApp: React.FC = () => {
  // ── State ────────────────────────────────────────────────
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [sessionSecrets, setSessionSecrets] = useState<SessionSecretsState>({
    customDomainKey: '',
  });
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [loading, setLoading] = useState(true);
  // Set when the initial GET_SETTINGS round-trip fails. While set, the form
  // shows DEFAULT_SETTINGS — which are NOT the user's — so autosave stays
  // off (it would otherwise overwrite real stored settings with defaults
  // plus one edit) and a banner explains + offers retry.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formErrors, setFormErrors] = useState<SettingsFormErrors>({});
  const [touchedFields, setTouchedFields] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<TabId>('general');
  const [tabMotion, setTabMotion] = useState<'pointer' | 'instant'>('instant');
  const [confirmModal, setConfirmModal] = useState<ConfirmModalState>(EMPTY_MODAL);
  // Ctrl+K command palette.
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const closeCommandPalette = useCallback(() => setCommandPaletteOpen(false), []);
  const selectTabInstant = useCallback((tab: TabId) => {
    setTabMotion('instant');
    setActiveTab(tab);
  }, []);
  const selectTabFromSidebar = useCallback((tab: TabId, input: 'pointer' | 'keyboard') => {
    setTabMotion(input === 'pointer' ? 'pointer' : 'instant');
    setActiveTab(tab);
  }, []);

  // ── Refs ─────────────────────────────────────────────────
  const isFirstLoad = useRef(true);
  const previousSettingsRef = useRef<UserSettings | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveTabRef = useRef<TabId>(activeTab);

  const version = APP_VERSION;

  useEffect(() => {
    if (previousActiveTabRef.current === activeTab) {
      return;
    }
    previousActiveTabRef.current = activeTab;
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [activeTab]);

  // ═══════════════════════════════════════════════════════════
  //  §5.1  V A L I D A T I O N   H E L P E R S
  // ═══════════════════════════════════════════════════════════

  const getFieldError = useCallback(
    (field: string): string | undefined => {
      if (field.includes('.')) {
        const [parent, child] = field.split('.');
        if (parent === 'passwordDefaults' && formErrors.passwordDefaults) {
          return formErrors.passwordDefaults[child as keyof typeof formErrors.passwordDefaults];
        }
      }
      return (formErrors as Record<string, string>)[field];
    },
    [formErrors]
  );

  const fieldHasError = useCallback(
    (field: string): boolean => touchedFields.has(field) && Boolean(getFieldError(field)),
    [touchedFields, getFieldError]
  );

  const handleFieldBlur = useCallback((field: string) => {
    setTouchedFields((prev) => {
      if (prev.has(field)) {
        return prev;
      }
      const next = new Set(prev);
      next.add(field);
      return next;
    });
  }, []);

  // ═══════════════════════════════════════════════════════════
  //  §5.2  D A T A   L O A D I N G
  // ═══════════════════════════════════════════════════════════

  const loadSettings = useCallback(async () => {
    setLoadError(null);
    if (!hasRuntimeMessaging()) {
      // Localhost builds are used for responsive and visual regression checks.
      // Render the real defaults without pretending they can be persisted.
      previousSettingsRef.current = DEFAULT_SETTINGS;
      setSettings(DEFAULT_SETTINGS);
      setLoading(false);
      return;
    }
    try {
      const response = await chrome.runtime.sendMessage({ action: 'GET_SETTINGS' });
      if (response?.settings && typeof response.settings === 'object') {
        const loaded = response.settings as UserSettings;
        setSettings(loaded);
        previousSettingsRef.current = loaded;
      } else {
        throw new Error(
          (response as { error?: unknown } | null)?.error
            ? String((response as { error?: unknown }).error)
            : 'Service worker returned no settings'
        );
      }
      const customDomainKey = (await storageService.getCustomDomainKey()) || '';
      setSessionSecrets({
        customDomainKey,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      log.error('Failed to load settings', error);
      setLoadError(reason);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    applyTheme(resolveTheme(settings.darkMode));
  }, [settings.darkMode]);

  // ═══════════════════════════════════════════════════════════
  //  §5.3  S A V E
  // ═══════════════════════════════════════════════════════════

  const settingsRef = useRef(settings);
  const immediateSaveRef = useRef<UserSettings | null>(null);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const isSavingRef = useRef(false);
  const pendingSaveRef = useRef(false);

  const saveSettings = useCallback(
    async (settingsOverride?: UserSettings, revealValidationErrors = false): Promise<boolean> => {
      if (isSavingRef.current) {
        pendingSaveRef.current = true;
        return false;
      }
      isSavingRef.current = true;
      try {
        const currentSettings = settingsOverride ?? settingsRef.current;
        const errors = validateSettings(currentSettings);
        setFormErrors(errors);
        if (revealValidationErrors || Object.keys(errors).length > 0) {
          setTouchedFields(ALL_VALIDATED_FIELDS);
        }

        if (Object.keys(errors).length > 0) {
          // Appearance is independent of the form fields below. An unfinished
          // custom provider or invalid number must not trap the popup in the
          // previous theme while this page already shows the new one.
          if (
            hasRuntimeMessaging() &&
            previousSettingsRef.current?.darkMode !== currentSettings.darkMode
          ) {
            try {
              const themeResponse = await chrome.runtime.sendMessage({
                action: 'UPDATE_SETTINGS',
                payload: { darkMode: currentSettings.darkMode },
              });
              if (themeResponse?.success && previousSettingsRef.current) {
                previousSettingsRef.current = {
                  ...previousSettingsRef.current,
                  darkMode: currentSettings.darkMode,
                };
              } else if (!themeResponse?.success) {
                log.error('Failed to save theme preference', themeResponse?.error);
              }
            } catch (error) {
              log.error('Failed to save theme preference', error);
            }
          }
          log.error('Validation failed', errors);
          setSaveState('invalid');
          return false;
        }

        // The localhost build is intentionally usable for visual regression and
        // accessibility checks. It has no extension service worker to persist to,
        // so keep its save state quiet instead of presenting a false failure.
        if (!hasRuntimeMessaging()) {
          previousSettingsRef.current = currentSettings;
          setSaveState('idle');
          return true;
        }

        try {
          const response = await chrome.runtime.sendMessage({
            action: 'UPDATE_SETTINGS',
            payload: currentSettings,
          });

          if (!response || !response.success) {
            const reason =
              response && typeof response.error === 'string' && response.error.length > 0
                ? `: ${response.error}`
                : '';
            log.error(`Failed to save settings: backend rejected${reason}`);
            setSaveState('failed');
            return false;
          }

          setSaveState('saved');
          if (savedToastTimerRef.current) {
            clearTimeout(savedToastTimerRef.current);
          }
          savedToastTimerRef.current = setTimeout(() => setSaveState('idle'), 2500);
          previousSettingsRef.current = { ...currentSettings };
          return true;
        } catch (error) {
          log.error('Failed to save settings', error);
          setSaveState('failed');
          return false;
        }
      } finally {
        isSavingRef.current = false;
        if (pendingSaveRef.current) {
          pendingSaveRef.current = false;
          setTimeout(() => void saveSettings(undefined, false), 100);
        }
      }
    },
    []
  );

  // Auto-save when settings change (skip first load)
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const secretSaveTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    return () => {
      if (savedToastTimerRef.current) {
        clearTimeout(savedToastTimerRef.current);
      }
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const timers = secretSaveTimersRef.current;
      for (const k in timers) {
        if (timers[k]) {
          clearTimeout(timers[k]);
        }
      }
    };
  }, []);

  useEffect(() => {
    if (isFirstLoad.current) {
      isFirstLoad.current = false;
      return;
    }
    // Never autosave from defaults after a failed load — that would
    // overwrite the user's real stored settings with DEFAULT_SETTINGS.
    if (loadError) {
      return;
    }
    // Loading changes `loading` and `settings` in the same render. Comparing
    // the exact object installed by loadSettings prevents that render from
    // being mistaken for a user edit and written straight back to storage.
    if (previousSettingsRef.current === settings) {
      return;
    }
    if (immediateSaveRef.current === settings) {
      immediateSaveRef.current = null;
      return;
    }
    if (!loading) {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
      // PERMANENT FIX 2026-06-21: surface the pending state immediately
      // so the user sees "Saving…" instead of nothing during the
      // 500ms debounce window. Flips back to idle/saved/failed when
      // saveSettings resolves.
      setSaveState('pending');
      autoSaveTimerRef.current = setTimeout(() => {
        setSaveState('saving');
        void saveSettings(undefined, false);
      }, 500);
      return () => {
        if (autoSaveTimerRef.current) {
          clearTimeout(autoSaveTimerRef.current);
        }
      };
    }
  }, [settings, loading, loadError, saveSettings]);

  // PERMANENT FIX 2026-06-21: beforeunload guard so unsaved changes
  // don't get lost if the user closes the tab during the debounce.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent): void => {
      if (saveState === 'pending' || saveState === 'saving' || saveState === 'invalid') {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [saveState]);

  // PERMANENT FIX 2026-06-21: Ctrl/Cmd+K opens a command palette that
  // jumps to any tab. Also supports Ctrl+Alt+1..7 to jump directly to
  // a tab number.
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandPaletteOpen(true);
        return;
      }
      if (mod && e.altKey && /^[1-7]$/.test(e.key)) {
        e.preventDefault();
        const order: TabId[] = [
          'general',
          'email',
          'password',
          'automation',
          'privacy',
          'advanced',
          'about',
        ];
        const idx = parseInt(e.key, 10) - 1;
        const next = order[idx];
        if (next) {
          selectTabInstant(next);
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [selectTabInstant]);

  // ═══════════════════════════════════════════════════════════
  //  §5.4  C H A N G E   H A N D L E R S
  // ═══════════════════════════════════════════════════════════

  const handleChange = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (key: keyof UserSettings, value: any) => {
      if (key === 'darkMode' && (value === true || value === false || value === 'system')) {
        const nextSettings = { ...settingsRef.current, darkMode: value };
        settingsRef.current = nextSettings;
        applyTheme(resolveTheme(value));
        if (!loadError) {
          if (!isSavingRef.current) {
            immediateSaveRef.current = nextSettings;
          }
          setSaveState('saving');
          void saveSettings(nextSettings, false);
        }
        setSettings(nextSettings);
        return;
      }
      setSettings((prev) => ({ ...prev, [key]: value }));
    },
    [loadError, saveSettings]
  );

  const handleSessionSecretChange = useCallback((key: 'customDomainKey', value: string) => {
    setSessionSecrets((prev) => ({ ...prev, [key]: value }));

    if (secretSaveTimersRef.current[key]) {
      clearTimeout(secretSaveTimersRef.current[key]);
    }

    secretSaveTimersRef.current[key] = setTimeout(() => {
      try {
        void (value
          ? storageService.setCustomDomainKey(value)
          : storageService.clearSessionSecret(key));
      } catch (error) {
        log.error('Failed to set session secret', error);
      }
    }, 500);
  }, []);

  const handlePasswordDefaultChange = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (key: keyof UserSettings['passwordDefaults'], value: any) => {
      setSettings((prev) => ({
        ...prev,
        passwordDefaults: { ...prev.passwordDefaults, [key]: value },
      }));
    },
    []
  );

  const handleSettingsImport = useCallback(
    (imported: UserSettings) => {
      settingsRef.current = imported;
      setSettings(imported);
      const validationErrors = validateSettings(imported);
      void saveSettings(imported, true).then((ok) => {
        if (!ok && Object.keys(validationErrors).length > 0) {
          const firstError = Object.keys(validationErrors)[0];
          const targetTab: TabId =
            firstError === 'passwordDefaults'
              ? 'password'
              : firstError === 'customDomain'
                ? 'email'
                : firstError === 'historyRetentionDays'
                  ? 'privacy'
                  : 'general';
          selectTabInstant(targetTab);
        }
      });
    },
    [saveSettings, selectTabInstant]
  );

  // ═══════════════════════════════════════════════════════════
  //  §5.5  M O D A L   &   A C T I O N S
  // ═══════════════════════════════════════════════════════════

  const closeModal = useCallback(() => {
    setConfirmModal((prev) => ({ ...prev, open: false }));
  }, []);

  const handleReset = useCallback(() => {
    setConfirmModal({
      open: true,
      title: t('resetSettingsTitle'),
      message: t('resetSettingsMessage'),
      type: 'warning',
      confirmText: t('resetSettingsAction'),
      action: () => {
        settingsRef.current = DEFAULT_SETTINGS;
        previousSettingsRef.current = DEFAULT_SETTINGS;
        if (autoSaveTimerRef.current) {
          clearTimeout(autoSaveTimerRef.current);
          autoSaveTimerRef.current = null;
        }
        setSettings(DEFAULT_SETTINGS);
        setFormErrors({});
        setTouchedFields(new Set());
        setSaveState('saving');
        // Persist immediately instead of relying on auto-save debounce
        void saveSettings(DEFAULT_SETTINGS, false);
      },
    });
  }, [saveSettings]);

  const handleClearData = useCallback(() => {
    setConfirmModal({
      open: true,
      title: t('clearAllDataTitle'),
      message: t('clearAllDataMessage'),
      type: 'danger',
      confirmText: t('clearAllDataAction'),
      action: () => {
        void (async () => {
          await storageService.clear();
          window.location.reload();
        })();
      },
    });
  }, []);

  // ═══════════════════════════════════════════════════════════
  //  §5.6  T A B   R O U T I N G
  // ═══════════════════════════════════════════════════════════

  const activeTabContent = useMemo(() => {
    switch (activeTab) {
      case 'general':
        return <GeneralTab settings={settings} onSettingChange={handleChange} />;

      case 'email':
        return (
          <EmailTab
            settings={settings}
            onSettingChange={handleChange}
            sessionSecrets={sessionSecrets}
            onSessionSecretChange={handleSessionSecretChange}
            fieldHasError={fieldHasError}
            getFieldError={getFieldError}
            onFieldBlur={handleFieldBlur}
          />
        );

      case 'password':
        return (
          <PasswordTab
            settings={settings}
            onPasswordDefaultChange={handlePasswordDefaultChange}
            fieldHasError={fieldHasError}
            getFieldError={getFieldError}
            onFieldBlur={handleFieldBlur}
          />
        );

      case 'automation':
        return <AutomationTab settings={settings} onSettingChange={handleChange} />;

      case 'privacy':
        return (
          <PrivacyTab
            settings={settings}
            onSettingChange={handleChange}
            fieldHasError={fieldHasError}
            getFieldError={getFieldError}
            onFieldBlur={handleFieldBlur}
          />
        );

      case 'advanced':
        return (
          <AdvancedTab
            settings={settings}
            onSettingChange={handleChange}
            onReset={handleReset}
            onClearData={handleClearData}
            onSettingsImport={handleSettingsImport}
            onError={(msg) => {
              setConfirmModal({
                open: true,
                title: t('errorTitle'),
                message: msg,
                type: 'warning',
                confirmText: t('acknowledge'),
                showCancel: false,
                action: () => {},
              });
            }}
          />
        );

      case 'about':
        return <AboutTab />;

      default:
        return null;
    }
  }, [
    activeTab,
    settings,
    sessionSecrets,
    handleChange,
    handleSessionSecretChange,
    handlePasswordDefaultChange,
    handleSettingsImport,
    handleReset,
    handleClearData,
    fieldHasError,
    getFieldError,
    handleFieldBlur,
  ]);

  // ═══════════════════════════════════════════════════════════
  //  §5.7  R E N D E R
  // ═══════════════════════════════════════════════════════════

  if (loading) {
    return <LoadingSpinner />;
  }

  const activePage = TAB_ORDER.find((tab) => tab.id === activeTab) ?? TAB_ORDER[0]!;

  const reviewInvalidSettings = (): void => {
    const errorTab: TabId = formErrors.passwordDefaults
      ? 'password'
      : formErrors.historyRetentionDays
        ? 'privacy'
        : 'email';
    selectTabInstant(errorTab);
    window.requestAnimationFrame(() => {
      const invalidControl = document.querySelector<HTMLElement>(
        '.tab-panel [aria-invalid="true"], .tab-panel .password-character-error'
      );
      invalidControl?.focus();
    });
  };

  return (
    <div className="options-app" aria-label="GhostFill Settings">
      <a className="options-skip-link" href="#main-content">
        Skip to settings
      </a>
      {/* ── Header ── */}
      <header className="options-header liquid-glass" role="banner">
        <div className="header-content">
          <div className="logo-box" aria-hidden="true">
            <GhostLogo size={32} />
          </div>
          <div className="header-text-group">
            <h1 className="spectral-title">{t('settingsTitle')}</h1>
            <p className="spectral-subtitle">{t('settingsSubtitle')}</p>
          </div>
          <div className="header-actions">
            <button
              className="command-palette-trigger-btn"
              aria-keyshortcuts="Control+k Meta+k"
              onClick={() => setCommandPaletteOpen(true)}
              type="button"
              aria-label="Search settings sections"
              title={`Search settings sections (${MOD_KEY}+K)`}
            >
              <Search size={15} />
              <span>Search</span>
              <kbd>{MOD_KEY} K</kbd>
            </button>
            <button
              className="theme-toggle-header-btn"
              onClick={() => {
                const isCurrentlyDark = resolveTheme(settings.darkMode) === 'dark';
                handleChange('darkMode', !isCurrentlyDark);
              }}
              type="button"
              aria-pressed={resolveTheme(settings.darkMode) === 'dark'}
              aria-label={`Current theme: ${resolveTheme(settings.darkMode)}. Switch to ${resolveTheme(settings.darkMode) === 'dark' ? 'light' : 'dark'}.`}
              title={`Current theme: ${resolveTheme(settings.darkMode)}. Switch to ${resolveTheme(settings.darkMode) === 'dark' ? 'light' : 'dark'}.`}
            >
              {resolveTheme(settings.darkMode) === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
              <span className="theme-toggle-label">
                {resolveTheme(settings.darkMode) === 'dark' ? 'Light' : 'Dark'}
              </span>
            </button>
          </div>
        </div>
      </header>

      {loadError && (
        <div className="settings-load-error" role="alert">
          <span>
            Couldn&apos;t load your saved settings ({loadError}). Showing defaults — changes
            won&apos;t autosave until loading succeeds.
          </span>
          <button
            type="button"
            className="gf-btn gf-btn--sm"
            onClick={() => {
              setLoading(true);
              void loadSettings();
            }}
          >
            Retry
          </button>
        </div>
      )}

      {/* ── Dashboard ── */}
      <div
        className="dashboard-layout"
        aria-hidden={confirmModal.open ? 'true' : undefined}
        ref={(el) => {
          if (el) {
            el.inert = confirmModal.open;
          }
        }}
      >
        <Sidebar activeTab={activeTab} onTabChange={selectTabFromSidebar} />
        <main
          className="options-main"
          id="main-content"
          tabIndex={-1}
          aria-labelledby="options-page-title"
        >
          <div key={activeTab} className="options-page-content" data-motion={tabMotion}>
            <div className="options-page-heading">
              <h2 id="options-page-title">{activePage.label}</h2>
              <p>{activePage.hint}</p>
            </div>
            <div
              id="settings-tab-panel"
              role="tabpanel"
              aria-labelledby={`tab-${activeTab}`}
              tabIndex={-1}
              className="tab-panel"
            >
              {activeTabContent}
            </div>
          </div>
        </main>
      </div>

      {/* ── Footer ── */}
      <footer className="options-footer" role="contentinfo">
        <p>GhostFill v{version}</p>
      </footer>

      {/* ── Live Announcements ── */}
      <ScreenReaderAnnouncer state={saveState} />

      {/* ── Save state, including the saved confirmation ── */}
      <SaveStatusIndicator
        state={saveState}
        onRetry={() => void saveSettings(undefined, true)}
        onReview={reviewInvalidSettings}
      />

      {/* ── Ctrl+K command palette ── */}
      <CommandPalette
        isOpen={commandPaletteOpen}
        onClose={closeCommandPalette}
        activeTab={activeTab}
        onSelectTab={selectTabInstant}
      />

      {/* ── Confirmation Modal ── */}
      <ConfirmModal modal={confirmModal} onClose={closeModal} modalRef={modalRef} />
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════
//  §12  S A V E   S T A T U S   I N D I C A T O R
// ═══════════════════════════════════════════════════════════════

const SaveStatusIndicator: React.FC<{
  state: 'idle' | 'pending' | 'saving' | 'saved' | 'failed' | 'invalid';
  onRetry: () => void;
  onReview: () => void;
}> = ({ state, onRetry, onReview }) => {
  if (state === 'idle') {
    return null;
  }
  const label = SAVE_LABELS[state];
  const cls = `options-save-indicator liquid-glass options-save-indicator-${state === 'invalid' ? 'failed' : state}`;
  const StatusIcon =
    state === 'saved' ? Check : state === 'failed' || state === 'invalid' ? AlertCircle : Clock;
  if (state === 'failed' || state === 'invalid') {
    return (
      <button type="button" className={cls} onClick={state === 'failed' ? onRetry : onReview}>
        <StatusIcon className="options-save-indicator-icon" size={17} aria-hidden="true" />
        <span>{label}</span>
      </button>
    );
  }
  return (
    <div className={cls} aria-hidden="true">
      <StatusIcon className="options-save-indicator-icon" size={17} />
      <span>{label}</span>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════
//  §13  C O M M A N D   P A L E T T E
// ═══════════════════════════════════════════════════════════════

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  activeTab: TabId;
  onSelectTab: (tab: TabId) => void;
}

const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  activeTab,
  onSelectTab,
}) => {
  const [query, setQuery] = useState('');
  const [highlightIdx, setHighlightIdx] = useState(0);
  const paletteRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  useSiblingIsolation(isOpen, overlayRef);
  useModalFocusTrap(isOpen, paletteRef, onClose);

  const q = query.trim().toLowerCase();
  const filtered = TAB_ORDER.filter(
    (t) => !q || t.label.toLowerCase().includes(q) || t.hint.toLowerCase().includes(q)
  );

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setHighlightIdx(0);
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      paletteRef.current
        ?.querySelector('.command-palette-item-active')
        ?.scrollIntoView({ block: 'nearest' });
    }
  }, [isOpen, highlightIdx, query]);

  if (!isOpen) {
    return null;
  }

  return (
    /* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions, jsx-a11y/no-noninteractive-element-interactions */
    <div ref={overlayRef} className="command-palette-overlay" onClick={onClose}>
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions, jsx-a11y/no-noninteractive-element-interactions */}
      <div
        ref={paletteRef}
        className="command-palette liquid-glass"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Jump to settings section"
      >
        <div className="command-palette-search">
          <Search size={19} aria-hidden="true" />
          <input
            id="command-palette-input"
            className="command-palette-input"
            placeholder="Search settings sections…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHighlightIdx(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setHighlightIdx((i) => Math.max(0, Math.min(i + 1, filtered.length - 1)));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setHighlightIdx((i) => Math.max(0, i - 1));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                const target = filtered[highlightIdx];
                if (target) {
                  onSelectTab(target.id);
                  onClose();
                }
              }
            }}
            aria-label="Search settings sections"
            autoComplete="off"
            spellCheck={false}
            role="combobox"
            aria-autocomplete="list"
            aria-controls="command-palette-list"
            aria-expanded="true"
            aria-activedescendant={
              filtered[highlightIdx] ? `command-option-${filtered[highlightIdx].id}` : undefined
            }
          />
          <button
            type="button"
            className="command-palette-close"
            aria-label="Close search"
            onClick={onClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <ul id="command-palette-list" className="command-palette-list" role="listbox">
          {filtered.length === 0 ? (
            <li className="command-palette-empty">No matches</li>
          ) : (
            filtered.map((t, idx) => (
              <li
                key={t.id}
                id={`command-option-${t.id}`}
                role="option"
                aria-selected={idx === highlightIdx}
                className={
                  idx === highlightIdx
                    ? 'command-palette-item command-palette-item-active'
                    : 'command-palette-item'
                }
                onMouseEnter={() => setHighlightIdx(idx)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelectTab(t.id);
                    onClose();
                  }
                }}
                onClick={() => {
                  onSelectTab(t.id);
                  onClose();
                }}
              >
                <span className="command-palette-item-label">{t.label}</span>
                <span className="command-palette-item-hint">{t.hint}</span>
                {t.id === activeTab && <span className="command-palette-item-badge">Current</span>}
              </li>
            ))
          )}
        </ul>
        <div className="command-palette-footer">
          <kbd>↑</kbd>
          <kbd>↓</kbd>
          <span>navigate</span>
          <kbd>↵</kbd>
          <span>select</span>
          <kbd>Esc</kbd>
          <span>close</span>
        </div>
      </div>
    </div>
  );
};

export default OptionsApp;
