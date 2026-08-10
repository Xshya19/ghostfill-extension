// Options Settings Tabs Component Collection
// Merged: GeneralTab, PasswordTab, EmailTab, AutomationTab, PrivacyTab, AdvancedTab, AboutTab, ProviderHealthMeter

import {
  Palette,
  Bell,
  Save,
  Lock,
  Zap,
  Keyboard,
  MailCheck,
  Terminal,
  AlertTriangle,
  Info,
  Database,
  Code,
  Check,
  Inbox,
  KeyRound,
  Mail,
  X,
} from 'lucide-react';
import React, { useState, useEffect, useRef } from 'react';

import { storageService } from '../../services/storageService';
import { Button } from '../../shared/ui';
import { UserSettings, DEFAULT_SETTINGS } from '../../types/storage.types';
import { createLogger } from '../../utils/logger';

import { SettingsSection, ToggleSwitch } from './OptionsUIComponents';

const t = (key: string): string => {
  try {
    return chrome.i18n.getMessage(key) || key;
  } catch {
    return key;
  }
};

const log = createLogger('OptionsTabs');
const GMAIL_CLIENT_ID_PATTERN = /^[a-z0-9-]+\.apps\.googleusercontent\.com$/i;
const SAVE_FEEDBACK_MS = 1800;

// ─── Provider Health Meter Component ──────────────────────────────────────────
interface ProviderHealthStatus {
  name: string;
  successRate: number;
  consecutiveFailures: number;
  avgResponseTime: number;
  circuitOpen: boolean;
}

export const ProviderHealthMeter: React.FC = () => {
  const [healthData, setHealthData] = useState<ProviderHealthStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const fetchHealth = () => {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        try {
          chrome.runtime.sendMessage({ action: 'GET_PROVIDER_HEALTH' }, (res) => {
            if (!isMounted) {
              return;
            }
            if (chrome.runtime.lastError) {
              setError(chrome.runtime.lastError.message ?? 'Unable to reach service worker');
              setHealthData([]);
            } else if (res && res.success && Array.isArray(res.health)) {
              setHealthData(res.health);
              setError(null);
            } else {
              setError('No provider data returned');
            }
            setLoading(false);
          });
        } catch (e) {
          if (!isMounted) {
            return;
          }
          setError(e instanceof Error ? e.message : 'Unknown error');
          setLoading(false);
        }
      } else {
        setError('Service worker unavailable');
        setLoading(false);
      }
    };

    fetchHealth();
    const interval = setInterval(() => {
      if (document.hidden) {
        return;
      }
      fetchHealth();
    }, 10000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  if (loading) {
    return (
      <div className="provider-health-meter" aria-busy="true">
        <h4 className="health-title">{t('providerHealthTitle')}</h4>
        <div className="health-grid">
          {[0, 1, 2].map((i) => (
            <div key={i} className="health-pill-card">
              <span className="about-skeleton-row" style={{ width: '60%' }} />
              <span className="about-skeleton-row" style={{ width: '30%' }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error && healthData.length === 0) {
    return (
      <div className="provider-health-meter">
        <h4 className="health-title">{t('providerHealthTitle')}</h4>
        <div
          className="field-error"
          style={{
            padding: '10px 12px',
            background: 'rgba(var(--gf-coral-rgb), 0.08)',
            border: '1px solid rgba(var(--gf-coral-rgb), 0.25)',
            borderRadius: '8px',
          }}
        >
          {error}
        </div>
      </div>
    );
  }

  if (healthData.length === 0) {
    return null;
  }

  return (
    <div className="provider-health-meter">
      <h4 className="health-title">{t('providerHealthTitle')}</h4>
      <div className="health-grid">
        {healthData.map((h) => {
          const isWarning = h.successRate <= 0.7 && h.successRate > 0 && !h.circuitOpen;
          const isDead = h.circuitOpen || h.successRate === 0;

          let statusClass = 'health-status-good';
          if (isWarning) {
            statusClass = 'health-status-warning';
          }
          if (isDead) {
            statusClass = 'health-status-dead';
          }

          return (
            <div key={h.name} className="health-pill-card">
              <span className="health-provider-name">{h.name}</span>
              <div className="health-status-group">
                <span className="health-percent">{Math.round(h.successRate * 100)}%</span>
                <div
                  className={`health-dot ${statusClass}`}
                  title={`Response: ${Math.round(h.avgResponseTime)}ms | Failures: ${h.consecutiveFailures}`}
                  aria-label={
                    isDead
                      ? 'Provider is offline'
                      : isWarning
                        ? 'Provider is degraded'
                        : 'Provider is healthy'
                  }
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ─── General Tab Component ───────────────────────────────────────────────────
interface GeneralTabProps {
  settings: UserSettings;
  onSettingChange: (key: keyof UserSettings, value: UserSettings[keyof UserSettings]) => void;
}

export const GeneralTab: React.FC<GeneralTabProps> = ({ settings, onSettingChange }) => {
  return (
    <div role="tabpanel" id="tabpanel-general" aria-labelledby="tab-general">
      <SettingsSection id="appearance" title={t('appearanceSection')} icon={<Palette size={18} />}>
        <div className="setting-item">
          <div className="setting-info">
            <label htmlFor="dark-mode">{t('darkMode')}</label>
            <p>{t('darkModeDescription')}</p>
          </div>
          <select
            id="dark-mode"
            value={String(settings.darkMode)}
            onChange={(e) => {
              const val = e.target.value;
              onSettingChange('darkMode', val === 'system' ? 'system' : val === 'true');
            }}
            aria-describedby="dark-mode-description"
          >
            <option value="system">{t('themeSystem')}</option>
            <option value="false">{t('themeLight')}</option>
            <option value="true">{t('themeDark')}</option>
          </select>
          <span id="dark-mode-description" className="sr-only">
            {t('darkModeAriaDescription')}
          </span>
        </div>

        <div className="setting-item">
          <div className="setting-info">
            <label id="show-floating-button-label">{t('floatingButton')}</label>
            <p>{t('floatingButtonDescription')}</p>
          </div>
          <ToggleSwitch
            checked={settings.showFloatingButton}
            onChange={(checked) => onSettingChange('showFloatingButton', checked)}
            ariaLabel={t('floatingButtonAriaLabel')}
            ariaLabelledBy="show-floating-button-label"
          />
        </div>

        <div className="setting-item">
          <div className="setting-info">
            <label htmlFor="floating-position">{t('buttonPosition')}</label>
            <p>{t('buttonPositionDescription')}</p>
          </div>
          <select
            id="floating-position"
            value={settings.floatingButtonPosition}
            onChange={(e) =>
              onSettingChange('floatingButtonPosition', e.target.value as 'right' | 'left')
            }
          >
            <option value="right">{t('right')}</option>
            <option value="left">{t('left')}</option>
          </select>
        </div>
      </SettingsSection>

      <SettingsSection
        id="notifications"
        title={t('notificationsSection')}
        icon={<Bell size={18} />}
      >
        <div className="setting-item">
          <div className="setting-info">
            <label id="notifications-label">{t('desktopNotifications')}</label>
            <p>{t('desktopNotificationsDescription')}</p>
          </div>
          <ToggleSwitch
            checked={settings.notifications}
            onChange={(checked) => onSettingChange('notifications', checked)}
            ariaLabel={t('desktopNotificationsAriaLabel')}
            ariaLabelledBy="notifications-label"
          />
        </div>

        <div className="setting-item">
          <div className="setting-info">
            <label id="sound-enabled-label">
              {t('soundEffects')} <span className="coming-soon-label">({t('comingSoon')})</span>
            </label>
            <p>{t('soundEffectsDescription')}</p>
          </div>
          <ToggleSwitch
            checked={settings.soundEnabled}
            onChange={(checked) => onSettingChange('soundEnabled', checked)}
            ariaLabel={t('soundEffectsAriaLabel')}
            ariaLabelledBy="sound-enabled-label"
          />
        </div>
      </SettingsSection>

      <SettingsSection id="app-data" title={t('appDataSection')} icon={<Save size={18} />}>
        <div className="setting-item setting-item-col">
          <div className="setting-info setting-info-mb-8">
            <label>{t('applicationTutorial')}</label>
            <p>{t('applicationTutorialDescription')}</p>
          </div>
          <Button
            size="sm"
            onClick={async () => {
              await chrome.storage.local.set({ hasSeenOnboarding: false });
              console.warn(t('onboardingResetWarning'));
            }}
          >
            {t('replayOnboarding')}
          </Button>
        </div>
      </SettingsSection>
    </div>
  );
};

// ─── Password Tab Component ──────────────────────────────────────────────────
interface PasswordTabProps {
  settings: UserSettings;
  onPasswordDefaultChange: (
    key: keyof UserSettings['passwordDefaults'],
    value: UserSettings['passwordDefaults'][keyof UserSettings['passwordDefaults']]
  ) => void;
  fieldHasError: (field: string) => boolean;
  getFieldError: (field: string) => string | undefined;
  onFieldBlur: (field: string) => void;
}

export const PasswordTab: React.FC<PasswordTabProps> = ({
  settings,
  onPasswordDefaultChange,
  fieldHasError,
  getFieldError,
  onFieldBlur,
}) => {
  return (
    <div role="tabpanel" id="tabpanel-password" aria-labelledby="tab-password">
      <SettingsSection
        id="password-defaults"
        title={t('passwordDefaultsSection')}
        icon={<Lock size={18} />}
      >
        <div className="setting-item">
          <div className="setting-info">
            <label htmlFor="password-length">{t('defaultLength')}</label>
            <p>{t('defaultLengthDescription')}</p>
          </div>
          <input
            id="password-length"
            type="number"
            min="8"
            max="128"
            value={settings.passwordDefaults.length}
            onChange={(e) => onPasswordDefaultChange('length', Number(e.target.value))}
            onBlur={() => onFieldBlur('passwordDefaults.length')}
            aria-invalid={fieldHasError('passwordDefaults.length')}
            aria-describedby={
              fieldHasError('passwordDefaults.length')
                ? 'password-length-error'
                : 'password-length-desc'
            }
          />
          <span id="password-length-desc" className="sr-only">
            {t('defaultLengthAriaDescription')}
          </span>
          {fieldHasError('passwordDefaults.length') && (
            <span id="password-length-error" className="field-error" role="alert">
              {getFieldError('passwordDefaults.length')}
            </span>
          )}
        </div>

        <div className="setting-item">
          <div className="setting-info">
            <label id="uppercase-label">{t('uppercaseLetters')}</label>
            <p>{t('uppercaseLettersDescription')}</p>
          </div>
          <ToggleSwitch
            checked={settings.passwordDefaults.uppercase}
            onChange={(checked) => onPasswordDefaultChange('uppercase', checked)}
            ariaLabel={t('uppercaseLettersAriaLabel')}
            ariaLabelledBy="uppercase-label"
          />
        </div>

        <div className="setting-item">
          <div className="setting-info">
            <label id="lowercase-label">{t('lowercaseLetters')}</label>
            <p>{t('lowercaseLettersDescription')}</p>
          </div>
          <ToggleSwitch
            checked={settings.passwordDefaults.lowercase}
            onChange={(checked) => onPasswordDefaultChange('lowercase', checked)}
            ariaLabel={t('lowercaseLettersAriaLabel')}
            ariaLabelledBy="lowercase-label"
          />
        </div>

        <div className="setting-item">
          <div className="setting-info">
            <label id="numbers-label">{t('numbers')}</label>
            <p>{t('numbersDescription')}</p>
          </div>
          <ToggleSwitch
            checked={settings.passwordDefaults.numbers}
            onChange={(checked) => onPasswordDefaultChange('numbers', checked)}
            ariaLabel={t('numbersAriaLabel')}
            ariaLabelledBy="numbers-label"
          />
        </div>

        <div className="setting-item">
          <div className="setting-info">
            <label id="symbols-label">{t('symbols')}</label>
            <p>{t('symbolsDescription')}</p>
          </div>
          <ToggleSwitch
            checked={settings.passwordDefaults.symbols}
            onChange={(checked) => onPasswordDefaultChange('symbols', checked)}
            ariaLabel={t('symbolsAriaLabel')}
            ariaLabelledBy="symbols-label"
          />
        </div>

        <div className="setting-item">
          <div className="setting-info">
            <label id="exclude-ambiguous-label">{t('excludeAmbiguous')}</label>
            <p>{t('excludeAmbiguousDescription')}</p>
          </div>
          <ToggleSwitch
            checked={settings.passwordDefaults.excludeAmbiguous}
            onChange={(checked) => onPasswordDefaultChange('excludeAmbiguous', checked)}
            ariaLabel={t('excludeAmbiguousAriaLabel')}
            ariaLabelledBy="exclude-ambiguous-label"
          />
        </div>
      </SettingsSection>
    </div>
  );
};

// ─── Email Tab Component ─────────────────────────────────────────────────────
interface EmailTabProps {
  settings: UserSettings;
  onSettingChange: (key: keyof UserSettings, value: UserSettings[keyof UserSettings]) => void;
  sessionSecrets: { customDomainKey: string; llmApiKey: string };
  onSessionSecretChange: (key: 'customDomainKey' | 'llmApiKey', value: string) => void;
  fieldHasError: (field: string) => boolean;
  getFieldError: (field: string) => string | undefined;
  onFieldBlur: (field: string) => void;
}

export const EmailTab: React.FC<EmailTabProps> = ({
  settings,
  onSettingChange,
  sessionSecrets,
  onSessionSecretChange,
  fieldHasError,
  getFieldError,
  onFieldBlur,
}) => {
  const [gmailClientId, setGmailClientId] = useState('');
  const [gmailClientIdError, setGmailClientIdError] = useState<string | null>(null);
  const [gmailClientIdSaveStatus, setGmailClientIdSaveStatus] = useState<
    'idle' | 'saving' | 'saved'
  >('idle');

  useEffect(() => {
    let cancelled = false;

    void storageService
      .get('gmailClientId')
      .then((value) => {
        if (!cancelled) {
          setGmailClientId(typeof value === 'string' ? value : '');
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  const saveGmailClientId = async (): Promise<void> => {
    const nextClientId = gmailClientId.trim();
    setGmailClientIdError(null);

    if (nextClientId && !GMAIL_CLIENT_ID_PATTERN.test(nextClientId)) {
      setGmailClientIdError('Enter a valid Google OAuth Client ID.');
      return;
    }

    setGmailClientIdSaveStatus('saving');
    try {
      await storageService.set('gmailClientId', nextClientId);
      setGmailClientId(nextClientId);
      setGmailClientIdSaveStatus('saved');
      window.setTimeout(() => setGmailClientIdSaveStatus('idle'), SAVE_FEEDBACK_MS);
    } catch {
      setGmailClientIdSaveStatus('idle');
      setGmailClientIdError('Could not save Gmail Client ID.');
    }
  };

  return (
    <div role="tabpanel" id="tabpanel-email" aria-labelledby="tab-email">
      <SettingsSection
        id="email-service"
        title={t('emailServiceSection')}
        icon={<Mail size={18} />}
      >
        <div className="setting-item">
          <div className="setting-info">
            <label htmlFor="preferred-email-service" className="fs-15-fw-600">
              Preferred Email Service
            </label>
            <p>Choose the default service for generating temporary emails</p>
          </div>
          <select
            id="preferred-email-service"
            value={settings.preferredEmailService}
            onChange={(e) =>
              onSettingChange(
                'preferredEmailService',
                e.target.value as UserSettings['preferredEmailService']
              )
            }
          >
            <option value="catchmail">CatchMail.io (Fastest & 7-Day Retention)</option>
            <option value="mailcx">Mail.cx (Fast & SSE Real-time)</option>
            <option value="openinbox">OpenInbox.io (Fast & Webhook-ready)</option>
            <option value="mailboxtemp">MailboxTemp (Fast & 24h Retention)</option>
            <option value="dropmail">Dropmail.me (GraphQL & 4 Domains)</option>
            <option value="driftz">Driftz.net (.org/.mn Blocklist Bypass)</option>
            <option value="getnada">GetNada / Inboxes.com (4 Domains)</option>
            <option value="tempmailplus">Tempmail.plus / Mailto.plus (3 Domains)</option>
            <option value="evilmail">EvilMail.pro (evilmail.dev)</option>
            <option value="guerrilla">Guerrilla Mail (10 Stealth Domains: sharklasers, grr.la)</option>
            <option value="maildrop">Maildrop.cc (GraphQL)</option>
            <option value="tempmail">1secmail.com (9 Domains)</option>
            <option value="tempmaillol">TempMail.lol (API v2)</option>
            <option value="mailtm">Mail.tm (JWT Auth)</option>
            <option value="mailgw">Mail.gw (JWT Auth)</option>
            <option value="custom">Custom Infrastructure (Private)</option>
          </select>
        </div>

        <ProviderHealthMeter />

        {settings.preferredEmailService === 'custom' && (
          <div className="custom-domain-container" role="group" aria-label="Custom domain settings">
            <div className="setting-item vertical-group">
              <div className="setting-info w-full">
                <label htmlFor="custom-domain" className="fs-13">
                  Custom Email Domain
                </label>
              </div>
              <input
                id="custom-domain"
                type="text"
                placeholder="e.g. mail.private.com"
                value={settings.customDomain || ''}
                onChange={(e) => onSettingChange('customDomain', e.target.value)}
                aria-invalid={fieldHasError('customDomain')}
                aria-describedby={fieldHasError('customDomain') ? 'custom-domain-error' : undefined}
              />
              {fieldHasError('customDomain') && (
                <span id="custom-domain-error" className="field-error" role="alert">
                  {getFieldError('customDomain')}
                </span>
              )}
            </div>

            <div className="setting-item vertical-group">
              <div className="setting-info w-full">
                <label htmlFor="custom-domain-url" className="fs-13">
                  API Endpoint (Cloudflare Worker)
                </label>
              </div>
              <input
                id="custom-domain-url"
                type="url"
                placeholder="https://my-worker.workers.dev/api"
                value={settings.customDomainUrl || ''}
                onChange={(e) => onSettingChange('customDomainUrl', e.target.value)}
                aria-invalid={fieldHasError('customDomainUrl')}
                aria-describedby={
                  fieldHasError('customDomainUrl') ? 'custom-domain-url-error' : undefined
                }
              />
              {fieldHasError('customDomainUrl') && (
                <span id="custom-domain-url-error" className="field-error" role="alert">
                  {getFieldError('customDomainUrl')}
                </span>
              )}
            </div>

            <div className="setting-item vertical-group">
              <div className="setting-info w-full">
                <label htmlFor="custom-domain-key" className="fs-13">
                  API Key / Secret
                  <span className="security-note security-note-tab">
                    Stored in memory only (cleared on extension reload)
                  </span>
                </label>
              </div>
              <input
                id="custom-domain-key"
                type="password"
                placeholder="Secret Token"
                value={sessionSecrets.customDomainKey}
                onChange={(e) => onSessionSecretChange('customDomainKey', e.target.value)}
                autoComplete="off"
              />
            </div>
          </div>
        )}
      </SettingsSection>

      <SettingsSection
        id="gmail-oauth"
        title={t('gmailOauthSection')}
        icon={<KeyRound size={18} />}
      >
        <div className="setting-item vertical-group">
          <div className="setting-info w-full">
            <label htmlFor="gmail-client-id" className="fs-15-fw-600">
              OAuth Client ID
            </label>
            <p>Required for Gmail API sign-in.</p>
          </div>
          <input
            id="gmail-client-id"
            type="text"
            inputMode="text"
            spellCheck={false}
            autoComplete="off"
            placeholder="1234567890-example.apps.googleusercontent.com"
            value={gmailClientId}
            onChange={(e) => {
              setGmailClientId(e.target.value);
              setGmailClientIdError(null);
              setGmailClientIdSaveStatus('idle');
            }}
            aria-invalid={!!gmailClientIdError}
            aria-describedby={gmailClientIdError ? 'gmail-client-id-error' : undefined}
          />
          {gmailClientIdError && (
            <span id="gmail-client-id-error" className="field-error" role="alert">
              {gmailClientIdError}
            </span>
          )}
          <div className="gmail-client-id-actions">
            <Button
              type="button"
              variant="primary"
              size="sm"
              className={
                gmailClientIdSaveStatus === 'saving'
                  ? 'save-btn--saving'
                  : gmailClientIdSaveStatus === 'saved'
                    ? 'save-btn--saved'
                    : ''
              }
              onClick={() => void saveGmailClientId()}
              disabled={gmailClientIdSaveStatus === 'saving'}
            >
              {gmailClientIdSaveStatus === 'saved' ? <Check size={16} /> : <Save size={16} />}
              <span>{gmailClientIdSaveStatus === 'saved' ? 'Saved' : 'Save'}</span>
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                setGmailClientId('');
                setGmailClientIdError(null);
                setGmailClientIdSaveStatus('saving');
                void storageService
                  .set('gmailClientId', '')
                  .then(() => {
                    setGmailClientIdSaveStatus('saved');
                    window.setTimeout(() => setGmailClientIdSaveStatus('idle'), SAVE_FEEDBACK_MS);
                  })
                  .catch(() => {
                    setGmailClientIdSaveStatus('idle');
                    setGmailClientIdError('Could not clear Gmail Client ID.');
                  });
              }}
              disabled={gmailClientIdSaveStatus === 'saving'}
            >
              <X size={16} />
              <span>Clear</span>
            </Button>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        id="inbox-polling"
        title={t('inboxPollingSection')}
        icon={<Inbox size={18} />}
      >
        <div className="setting-item">
          <div className="setting-info">
            <label id="auto-check-label">Auto-check Inbox</label>
            <p>Automatically check for new emails in the background</p>
          </div>
          <ToggleSwitch
            checked={settings.autoCheckInbox}
            onChange={(checked) => onSettingChange('autoCheckInbox', checked)}
            ariaLabel="Auto-check inbox"
            ariaLabelledBy="auto-check-label"
          />
        </div>

        <div className="setting-item">
          <div className="setting-info">
            <label htmlFor="check-interval">Check Interval</label>
            <p>How often to check for new emails (seconds)</p>
          </div>
          <input
            id="check-interval"
            type="number"
            min="3"
            max="60"
            value={settings.checkIntervalSeconds}
            onChange={(e) => onSettingChange('checkIntervalSeconds', Number(e.target.value))}
            onBlur={() => onFieldBlur('checkIntervalSeconds')}
            aria-invalid={fieldHasError('checkIntervalSeconds')}
            aria-describedby={
              fieldHasError('checkIntervalSeconds') ? 'check-interval-error' : 'check-interval-desc'
            }
          />
          <span id="check-interval-desc" className="sr-only">
            Enter a value between 3 and 60 seconds
          </span>
          {fieldHasError('checkIntervalSeconds') && (
            <span id="check-interval-error" className="field-error" role="alert">
              {getFieldError('checkIntervalSeconds')}
            </span>
          )}
        </div>
      </SettingsSection>
    </div>
  );
};

// ─── Automation Tab Component ────────────────────────────────────────────────
interface CommandInfo {
  name: string;
  shortcut: string;
  description: string;
}

interface AutomationTabProps {
  settings: UserSettings;
  onSettingChange: (key: keyof UserSettings, value: UserSettings[keyof UserSettings]) => void;
}

const FALLBACK_COMMANDS: CommandInfo[] = [
  { name: '_execute_action', shortcut: 'Ctrl+Shift+E', description: 'Open GhostFill' },
  { name: 'generate-email', shortcut: 'Ctrl+Shift+M', description: 'Generate new email' },
  { name: 'generate-password', shortcut: 'Ctrl+Shift+G', description: 'Generate new password' },
  { name: 'auto-fill', shortcut: 'Ctrl+Shift+F', description: 'Auto-fill current form' },
];

const COMMAND_ORDER = ['_execute_action', 'generate-email', 'generate-password', 'auto-fill'];

const COMMAND_LABEL_KEYS: Record<string, string> = {
  '_execute_action': 'shortcutOpenGhostFill',
  'generate-email': 'shortcutGenerateEmail',
  'generate-password': 'shortcutGeneratePassword',
  'auto-fill': 'shortcutAutofillForm',
};

export const AutomationTab: React.FC<AutomationTabProps> = ({ settings, onSettingChange }) => {
  const [commands, setCommands] = useState<CommandInfo[]>(FALLBACK_COMMANDS);

  useEffect(() => {
    let cancelled = false;
    chrome.commands.getAll().then((cmds) => {
      if (cancelled) {
        return;
      }
      const byName = new Map(cmds.map((c) => [c.name, c]));
      const ordered = COMMAND_ORDER.map((name) => {
        const info = byName.get(name);
        return {
          name,
          shortcut: info?.shortcut || 'Not assigned',
          description: info?.description || '',
        } as CommandInfo;
      });
      setCommands(ordered);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div role="tabpanel" id="tabpanel-automation" aria-labelledby="tab-automation">
      <SettingsSection id="auto-fill" title={t('autofillSection')} icon={<Zap size={18} />}>
        <div className="setting-item">
          <div className="setting-info">
            <label id="auto-fill-otp-label">{t('autofillOTP')}</label>
            <p>{t('autofillOTPDescription')}</p>
          </div>
          <ToggleSwitch
            checked={settings.autoFillOTP}
            onChange={(checked) => onSettingChange('autoFillOTP', checked)}
            ariaLabel={t('autofillOTPAriaLabel')}
            ariaLabelledBy="auto-fill-otp-label"
          />
        </div>

        <div className="setting-item">
          <div className="setting-info">
            <label id="auto-confirm-links-label">{t('autoOpenVerificationLinks')}</label>
            <p>{t('autoOpenVerificationLinksDescription')}</p>
          </div>
          <ToggleSwitch
            checked={settings.autoConfirmLinks}
            onChange={(checked) => onSettingChange('autoConfirmLinks', checked)}
            ariaLabel={t('autoOpenVerificationLinksAriaLabel')}
            ariaLabelledBy="auto-confirm-links-label"
          />
        </div>
      </SettingsSection>

      <SettingsSection id="shortcuts" title={t('shortcutsSection')} icon={<Keyboard size={18} />}>
        <div className="setting-item">
          <div className="setting-info">
            <label id="keyboard-shortcuts-label">{t('enableShortcuts')}</label>
            <p>{t('enableShortcutsDescription')}</p>
          </div>
          <ToggleSwitch
            checked={settings.keyboardShortcuts}
            onChange={(checked) => onSettingChange('keyboardShortcuts', checked)}
            ariaLabel={t('enableShortcutsAriaLabel')}
            ariaLabelledBy="keyboard-shortcuts-label"
          />
        </div>

        <div
          className="shortcut-reference"
          role="group"
          aria-label={t('shortcutReferenceAriaLabel')}
        >
          <h3 className="shortcut-reference-title">{t('quickReference')}</h3>
          <div className="shortcut-list">
            {commands.map((cmd) => (
              <div className="shortcut-row" key={cmd.name}>
                <span className="shortcut-action">
                  {cmd.description || t(COMMAND_LABEL_KEYS[cmd.name] ?? '') || cmd.name}
                </span>
                <kbd className="shortcut-keys">{cmd.shortcut}</kbd>
              </div>
            ))}
          </div>
          <p className="shortcut-note">{t('customizeShortcutsNote')}</p>
        </div>
      </SettingsSection>
    </div>
  );
};

// ─── Privacy Tab Component ───────────────────────────────────────────────────
interface PrivacyTabProps {
  settings: UserSettings;
  onSettingChange: (key: keyof UserSettings, value: UserSettings[keyof UserSettings]) => void;
  fieldHasError: (field: string) => boolean;
  getFieldError: (field: string) => string | undefined;
  onFieldBlur: (field: string) => void;
}

export const PrivacyTab: React.FC<PrivacyTabProps> = ({
  settings,
  onSettingChange,
  fieldHasError,
  getFieldError,
  onFieldBlur,
}) => {
  return (
    <div role="tabpanel" id="tabpanel-privacy" aria-labelledby="tab-privacy">
      <SettingsSection id="history" title={t('historyDataSection')} icon={<Lock size={18} />}>
        <div className="setting-item">
          <div className="setting-info">
            <label id="save-history-label">{t('saveHistory')}</label>
            <p>{t('saveHistoryDescription')}</p>
          </div>
          <ToggleSwitch
            checked={settings.saveHistory}
            onChange={(checked) => onSettingChange('saveHistory', checked)}
            ariaLabel={t('saveHistoryAriaLabel')}
            ariaLabelledBy="save-history-label"
          />
        </div>

        <div className="setting-item">
          <div className="setting-info">
            <label htmlFor="history-retention">{t('historyRetention')}</label>
            <p>{t('historyRetentionDescription')}</p>
          </div>
          <input
            id="history-retention"
            type="number"
            min="1"
            max="365"
            value={settings.historyRetentionDays}
            onChange={(e) => onSettingChange('historyRetentionDays', Number(e.target.value))}
            onBlur={() => onFieldBlur('historyRetentionDays')}
            aria-invalid={fieldHasError('historyRetentionDays')}
            aria-describedby={
              fieldHasError('historyRetentionDays')
                ? 'history-retention-error'
                : 'history-retention-desc'
            }
          />
          <span id="history-retention-desc" className="sr-only">
            {t('historyRetentionAriaDescription')}
          </span>
          {fieldHasError('historyRetentionDays') && (
            <span id="history-retention-error" className="field-error" role="alert">
              {getFieldError('historyRetentionDays')}
            </span>
          )}
        </div>

        <div className="setting-item">
          <div className="setting-info">
            <label id="clear-on-close-label">{t('clearOnClose')}</label>
            <p>{t('clearOnCloseDescription')}</p>
          </div>
          <ToggleSwitch
            checked={settings.clearOnClose}
            onChange={(checked) => onSettingChange('clearOnClose', checked)}
            ariaLabel={t('clearOnCloseAriaLabel')}
            ariaLabelledBy="clear-on-close-label"
          />
        </div>
      </SettingsSection>

      <SettingsSection
        id="gmail-privacy"
        title={t('gmailPrivacySection')}
        icon={<MailCheck size={18} />}
      >
        <div className="setting-item">
          <div className="setting-info">
            <label id="gmail-session-fallback-label">{t('gmailSessionDetection')}</label>
            <p>{t('gmailSessionDetectionDescription')}</p>
          </div>
          <ToggleSwitch
            checked={settings.allowGmailSessionFallback}
            onChange={(checked) => onSettingChange('allowGmailSessionFallback', checked)}
            ariaLabel={t('gmailSessionDetectionAriaLabel')}
            ariaLabelledBy="gmail-session-fallback-label"
          />
        </div>
      </SettingsSection>
    </div>
  );
};

// ─── Advanced Tab Component ──────────────────────────────────────────────────
interface AdvancedTabProps {
  settings: UserSettings;
  onSettingChange: (key: keyof UserSettings, value: UserSettings[keyof UserSettings]) => void;
  sessionSecrets: { customDomainKey: string; llmApiKey: string };
  onSessionSecretChange: (key: 'customDomainKey' | 'llmApiKey', value: string) => void;
  onReset: () => void;
  onClearData: () => void;
  onSettingsImport: (imported: UserSettings) => void;
  onError?: (msg: string) => void;
}

export const AdvancedTab: React.FC<AdvancedTabProps> = ({
  settings,
  onSettingChange,
  sessionSecrets,
  onSessionSecretChange,
  onReset,
  onClearData,
  onSettingsImport,
  onError,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = () => {
    try {
      const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ghostfill-settings-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      log.error('Export failed:', err);
    }
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);

        const merged: UserSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
        for (const key of Object.keys(DEFAULT_SETTINGS)) {
          const k = key as keyof UserSettings;
          if (k in parsed) {
            const expectedType = typeof DEFAULT_SETTINGS[k];
            const actualType =
              parsed[k] === null ? 'null' : Array.isArray(parsed[k]) ? 'array' : typeof parsed[k];
            const typeMatches =
              actualType === expectedType ||
              (expectedType === 'object' && (actualType === 'object' || actualType === 'array'));
            if (typeMatches) {
              if (k === 'passwordDefaults' && typeof parsed[k] === 'object') {
                merged[k] = { ...DEFAULT_SETTINGS.passwordDefaults, ...parsed[k] };
              } else {
                (merged as any)[k] = parsed[k];
              }
            }
          }
        }

        onSettingsImport(merged);
      } catch (err) {
        log.error('Import failed:', err);
        if (onError) {
          onError('Invalid settings file. Please select a valid GhostFill settings JSON.');
        } else {
          console.warn('Invalid settings file. Please select a valid GhostFill settings JSON.');
        }
      }
    };
    reader.readAsText(file);

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div role="tabpanel" id="tabpanel-advanced" aria-labelledby="tab-advanced">
      <SettingsSection id="developer" title={t('developerSection')} icon={<Terminal size={18} />}>
        <div className="setting-item">
          <div className="setting-info">
            <label id="debug-mode-label">Debug Mode</label>
            <p>Enable verbose console logging for troubleshooting</p>
          </div>
          <ToggleSwitch
            checked={settings.debugMode}
            onChange={(checked) => onSettingChange('debugMode', checked)}
            ariaLabel="Debug mode"
            ariaLabelledBy="debug-mode-label"
          />
        </div>
      </SettingsSection>

      <SettingsSection id="llm" title="AI Assistance" icon={<Terminal size={18} />}>
        <div className="setting-item">
          <div className="setting-info">
            <label htmlFor="llm-api-key">LLM API key</label>
            <p>Used to power AI-assisted replies. Stored only in this browser session.</p>
          </div>
          <input
            id="llm-api-key"
            type="password"
            autoComplete="off"
            placeholder="sk-…"
            value={sessionSecrets.llmApiKey}
            onChange={(e) => onSessionSecretChange('llmApiKey', e.target.value)}
            aria-label="LLM API key"
          />
        </div>
      </SettingsSection>

      <SettingsSection id="backup" title={t('backupRestoreSection')} icon={<Save size={18} />}>
        <div className="setting-item">
          <div className="setting-info">
            <label>Export Settings</label>
            <p>Download your current settings as a JSON file</p>
          </div>
          <Button size="sm" type="button" onClick={handleExport}>
            Export
          </Button>
        </div>

        <div className="setting-item">
          <div className="setting-info">
            <label htmlFor="import-settings">Import Settings</label>
            <p>Load settings from a previously exported JSON file</p>
          </div>
          <button
            type="button"
            className="gf-btn gf-btn--sm import-btn"
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            aria-label="Import settings from JSON file"
          >
            Import
            <input
              ref={fileInputRef}
              id="import-settings"
              type="file"
              accept=".json"
              onChange={handleImport}
              className="sr-only"
              aria-hidden="true"
              tabIndex={-1}
            />
          </button>
        </div>
      </SettingsSection>

      <SettingsSection
        id="danger-zone"
        title="Danger Zone"
        icon={<AlertTriangle size={18} />}
        variant="danger"
      >
        <div className="setting-item">
          <div className="setting-info">
            <label>Reset Settings</label>
            <p>Restore all settings to their defaults</p>
          </div>
          <Button
            size="sm"
            onClick={onReset}
            type="button"
            aria-label="Reset all settings to defaults"
          >
            Reset
          </Button>
        </div>

        <div className="setting-item">
          <div className="setting-info">
            <label>Clear All Data</label>
            <p>Delete all emails, passwords, and history</p>
          </div>
          <Button
            variant="danger"
            size="sm"
            onClick={onClearData}
            type="button"
            aria-label="Clear all stored data"
          >
            Clear Data
          </Button>
        </div>
      </SettingsSection>
    </div>
  );
};

// ─── About Tab Component ─────────────────────────────────────────────────────
export const AboutTab: React.FC = () => {
  const version = React.useMemo(() => chrome.runtime.getManifest().version, []);
  const [storageUsage, setStorageUsage] = useState<{ used: number; quota: number } | null>(null);

  useEffect(() => {
    chrome.storage.local.getBytesInUse(null, (bytes) => {
      setStorageUsage({
        used: bytes,
        quota: 10 * 1024 * 1024,
      });
    });
  }, []);

  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const usagePercent = storageUsage
    ? Math.min((storageUsage.used / storageUsage.quota) * 100, 100)
    : 0;

  return (
    <div role="tabpanel" id="tabpanel-about" aria-labelledby="tab-about">
      <SettingsSection id="extension-info" title="GhostFill" icon={<Info size={18} />}>
        <div className="about-hero">
          <div className="about-version">
            <span className="version-badge">v{version}</span>
          </div>
          <p className="about-tagline">
            Disposable emails, secure passwords, and automatic OTP detection & fill.
            <br />
            100% Free & Open Source.
          </p>
        </div>

        <div className="about-links">
          <a
            href="https://github.com/Xshya19/ghostfill-extension"
            target="_blank"
            rel="noopener noreferrer"
            className="about-link"
          >
            GitHub Repository
          </a>
          <a
            href="https://github.com/Xshya19/ghostfill-extension/issues"
            target="_blank"
            rel="noopener noreferrer"
            className="about-link"
          >
            🐛 Report a Bug
          </a>
          <a
            href="https://github.com/Xshya19/ghostfill-extension/blob/main/LICENSE"
            target="_blank"
            rel="noopener noreferrer"
            className="about-link"
          >
            📄 MIT License
          </a>
        </div>
      </SettingsSection>

      <SettingsSection id="storage-usage" title="Storage Usage" icon={<Database size={18} />}>
        {storageUsage ? (
          <div className="storage-monitor">
            <div className="storage-bar-wrapper">
              <div
                className="storage-bar-fill"
                style={{ width: `${Math.max(usagePercent, 2)}%` }}
                role="progressbar"
                aria-valuenow={Math.round(usagePercent)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Storage usage"
              />
            </div>
            <div className="storage-stats">
              <span>{formatBytes(storageUsage.used)} used</span>
              <span>{formatBytes(storageUsage.quota)} total</span>
            </div>
          </div>
        ) : (
          <p className="text-dimmed">{t('loadingStorageInfo')}</p>
        )}
      </SettingsSection>

      <SettingsSection id="tech-stack" title="Built With" icon={<Code size={18} />}>
        <div className="tech-pill-container" role="list" aria-label="Technologies used">
          <span className="tech-pill tech-pill-primary" role="listitem">
            React
          </span>
          <span className="tech-pill tech-pill-secondary" role="listitem">
            TypeScript
          </span>
          <span className="tech-pill tech-pill-accent" role="listitem">
            Webpack
          </span>
          <span className="tech-pill tech-pill-primary" role="listitem">
            Chrome MV3
          </span>
          <span className="tech-pill tech-pill-secondary" role="listitem">
            Framer Motion
          </span>
        </div>
      </SettingsSection>
    </div>
  );
};
