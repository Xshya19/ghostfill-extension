import { Check, Inbox, KeyRound, Mail, Save, X } from 'lucide-react';
import React, { useEffect, useState } from 'react';

import { storageService } from '../../../services/storageService';
import { Button } from '../../../shared/ui';
import { UserSettings } from '../../../types/storage.types';
import { ProviderHealthMeter } from '../ProviderHealthMeter';
import SettingsSection from '../SettingsSection';
import ToggleSwitch from '../ToggleSwitch';

const t = (key: string): string => {
  try {
    return chrome.i18n.getMessage(key) || key;
  } catch {
    return key;
  }
};

const GMAIL_CLIENT_ID_PATTERN = /^[a-z0-9-]+\.apps\.googleusercontent\.com$/i;
const SAVE_FEEDBACK_MS = 1800;

interface EmailTabProps {
  settings: UserSettings;
  onSettingChange: (key: keyof UserSettings, value: UserSettings[keyof UserSettings]) => void;
  sessionSecrets: { customDomainKey: string; llmApiKey: string };
  onSessionSecretChange: (key: 'customDomainKey' | 'llmApiKey', value: string) => void;
  fieldHasError: (field: string) => boolean;
  getFieldError: (field: string) => string | undefined;
  onFieldBlur: (field: string) => void;
}

const EmailTab: React.FC<EmailTabProps> = ({
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
            <option value="mailtm">Mail.tm (fastest and most reliable)</option>
            <option value="maildrop">Maildrop</option>
            <option value="mailgw">Mail.gw</option>
            <option value="guerrilla">Guerrilla Mail</option>
            <option value="tempmail">1secmail.com</option>
            <option value="driftz">Driftz.net</option>
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

export default EmailTab;
