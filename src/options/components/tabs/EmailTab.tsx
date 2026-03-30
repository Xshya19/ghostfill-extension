import React from 'react';

import { UserSettings } from '../../../types/storage.types';
import { ProviderHealthMeter } from '../ProviderHealthMeter';
import SettingsSection from '../SettingsSection';
import ToggleSwitch from '../ToggleSwitch';

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
  return (
    <div role="tabpanel" id="tabpanel-email" aria-labelledby="tab-email">
      <SettingsSection id="email-service" title="Email Service" icon="📧">
        <div className="setting-item">
          <div className="setting-info">
            <label htmlFor="preferred-email-service" style={{ fontSize: 15, fontWeight: 600 }}>
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
            <option value="mailtm">Mail.tm (Fastest & Most Reliable) ⭐</option>
            <option value="maildrop">Maildrop</option>
            <option value="mailgw">Mail.gw</option>
            <option value="guerrilla">Guerrilla Mail</option>
            <option value="tempmail">1secmail.com</option>
            <option value="custom">Custom Infrastructure (Private)</option>
          </select>
        </div>

        <ProviderHealthMeter />

        {settings.preferredEmailService === 'custom' && (
          <div className="custom-domain-container" role="group" aria-label="Custom domain settings">
            <div className="setting-item vertical-group">
              <div className="setting-info" style={{ width: '100%' }}>
                <label htmlFor="custom-domain" style={{ fontSize: 13 }}>
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
              <div className="setting-info" style={{ width: '100%' }}>
                <label htmlFor="custom-domain-url" style={{ fontSize: 13 }}>
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
              <div className="setting-info" style={{ width: '100%' }}>
                <label htmlFor="custom-domain-key" style={{ fontSize: 13 }}>
                  API Key / Secret
                  <span
                    className="security-note"
                    style={{ marginLeft: '8px', color: '#f59e0b', fontSize: '11px' }}
                  >
                    🔒 Stored in memory only (cleared on extension reload)
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

      <SettingsSection id="inbox-polling" title="Inbox Polling" icon="📥">
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
