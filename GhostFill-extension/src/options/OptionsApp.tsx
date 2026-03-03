import React, { useState, useEffect, useCallback, useRef } from 'react';

import logo from '../assets/icons/icon.png';
import { storageService } from '../services/storageService';
import { UserSettings, DEFAULT_SETTINGS } from '../types/storage.types';
import { createLogger } from '../utils/logger';

const log = createLogger('OptionsApp');

// ==========================================
// VALIDATION TYPES
// ==========================================

type SettingsFormErrors = Record<string, string> & {
    passwordDefaults?: Record<string, string>;
};

// Session secrets state (API keys stored in memory only)
interface SessionSecretsState {
    customDomainKey: string;
    llmApiKey: string;
}

// ==========================================
// REUSABLE TOGGLE COMPONENT
// ==========================================

/**
 * Accessible Toggle Switch component
 * - Keyboard navigation (Enter/Space)
 * - Proper ARIA attributes
 * - Focus visible states
 * - WCAG 2.1 AA compliant
 */
interface ToggleProps {
    checked: boolean;
    onChange: (checked: boolean) => void;
    ariaLabel?: string;
    ariaLabelledBy?: string;
    id?: string;
    disabled?: boolean;
}

const ToggleSwitch: React.FC<ToggleProps> = ({
    checked,
    onChange,
    ariaLabel,
    ariaLabelledBy,
    id,
    disabled = false,
}) => {
    const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
        // WCAG 2.1.1 - Keyboard: Allow Enter and Space to toggle
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (!disabled) {
                onChange(!checked);
            }
        }
    };

    return (
        <button
            id={id}
            className={`toggle ${checked ? 'toggle--active' : ''}`}
            onClick={() => !disabled && onChange(!checked)}
            onKeyDown={handleKeyDown}
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

// ==========================================
// MAIN OPTIONS APP COMPONENT
// ==========================================

const OptionsApp: React.FC = () => {
    const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
    // Session secrets state (API keys stored in memory only, not persisted)
    const [sessionSecrets, setSessionSecrets] = useState<SessionSecretsState>({
        customDomainKey: '',
        llmApiKey: '',
    });
    const [saved, setSaved] = useState(false);
    const [loading, setLoading] = useState(true);
    const [formErrors, setFormErrors] = useState<SettingsFormErrors>({});
    const [touchedFields, setTouchedFields] = useState<Set<string>>(new Set());

    const version = chrome.runtime.getManifest().version;
    const isFirstLoad = useRef(true);
    const previousSettingsRef = useRef<UserSettings | null>(null);
    
    // Focus management for modal
    const modalRef = useRef<HTMLDivElement>(null);
    const firstFocusableRef = useRef<HTMLElement | null>(null);
    const lastFocusableRef = useRef<HTMLElement | null>(null);
    const previouslyFocusedRef = useRef<HTMLElement | null>(null);

    const [confirmModal, setConfirmModal] = useState<{
        open: boolean;
        title: string;
        message: string;
        action: () => void;
        type: 'danger' | 'warning';
    }>({ open: false, title: '', message: '', action: () => { }, type: 'warning' });

    // ==========================================
    // VALIDATION FUNCTIONS
    // ==========================================

    /**
     * Validate settings
     * Returns validation errors for display
     */
    const validateSettings = useCallback((settingsToValidate: UserSettings): SettingsFormErrors => {
        const errors: SettingsFormErrors = {};
        const pwd = settingsToValidate.passwordDefaults;

        // Password validation
        if (pwd.length < 8) {
            errors.passwordDefaults = { length: 'Password length must be at least 8' };
        }
        if (pwd.length > 128) {
            errors.passwordDefaults = { length: 'Password length cannot exceed 128' };
        }

        return errors;
    }, []);

    /**
     * Get error message for a specific field
     */
    const getFieldError = useCallback((field: string): string | undefined => {
        if (field.includes('.')) {
            const [parent, child] = field.split('.');
            if (parent === 'passwordDefaults' && formErrors.passwordDefaults) {
                return formErrors.passwordDefaults[child as keyof UserSettings['passwordDefaults']];
            }
        }
        return (formErrors as Record<string, string>)[field];
    }, [formErrors]);

    /**
     * Check if a field has been touched and has an error
     */
    const fieldHasError = useCallback((field: string): boolean => {
        return touchedFields.has(field) && Boolean(getFieldError(field));
    }, [touchedFields, getFieldError]);

    // ==========================================
    // DATA LOADING
    // ==========================================

    const loadSettings = useCallback(async () => {
        try {
            const response = await chrome.runtime.sendMessage({ action: 'GET_SETTINGS' });
            if (response?.settings && typeof response.settings === 'object') {
                const loadedSettings = response.settings as UserSettings;
                setSettings(loadedSettings);
                previousSettingsRef.current = loadedSettings;
            }
            // SECURITY FIX: Load session secrets from memory (not persisted)
            setSessionSecrets({
                customDomainKey: storageService.getCustomDomainKey() || '',
                llmApiKey: storageService.getLLMApiKey() || '',
            });
        } catch (error) {
            log.error('Failed to load settings', error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadSettings();
    }, [loadSettings]);

    // ==========================================
    // SAVE FUNCTIONALITY
    // ==========================================

    const saveSettings = async () => {
        // Validate before saving
        const errors = validateSettings(settings);
        setFormErrors(errors);
        
        // Mark all fields as touched
        const allFields = new Set<string>([
            'checkIntervalSeconds',
            'historyRetentionDays',
            'passwordDefaults.length',
            'customDomainUrl',
        ]);
        setTouchedFields(allFields);

        // Don't save if there are errors
        if (Object.keys(errors).length > 0) {
            log.error('Validation failed', errors);
            return false;
        }

        try {
            await chrome.runtime.sendMessage({
                action: 'UPDATE_SETTINGS',
                payload: settings,
            });
            setSaved(true);
            setTimeout(() => setSaved(false), 2500);
            previousSettingsRef.current = { ...settings };
            return true;
        } catch (error) {
            log.error('Failed to save settings', error);
            return false;
        }
    };

    // Auto-save on change — skip the very first render
    useEffect(() => {
        if (isFirstLoad.current) {
            isFirstLoad.current = false;
            return;
        }
        if (!loading) {
            saveSettings();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [settings]);

    // ==========================================
    // CHANGE HANDLERS
    // ==========================================

    const handleChange = <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => {
        setSettings((prev) => ({ ...prev, [key]: value }));
        // Mark field as touched when changed
        setTouchedFields((prev) => new Set(prev).add(key as string));
    };

    // SECURITY FIX: Handler for session secrets (API keys stored in memory only)
    const handleSessionSecretChange = (key: 'customDomainKey' | 'llmApiKey', value: string) => {
        setSessionSecrets((prev) => ({ ...prev, [key]: value }));
        // SECURITY FIX: Save to session storage immediately (not persisted to disk)
        try {
            if (key === 'customDomainKey') {
                if (value) {
                    storageService.setCustomDomainKey(value);
                } else {
                    storageService.clearSessionSecrets();
                }
            } else if (key === 'llmApiKey') {
                if (value) {
                    storageService.setLLMApiKey(value);
                } else {
                    storageService.clearSessionSecrets();
                }
            }
        } catch (error) {
            log.error('Failed to set session secret', error);
        }
    };

    const handlePasswordDefaultChange = <K extends keyof UserSettings['passwordDefaults']>(
        key: K,
        value: UserSettings['passwordDefaults'][K]
    ) => {
        setSettings((prev) => ({
            ...prev,
            passwordDefaults: {
                ...prev.passwordDefaults,
                [key]: value,
            },
        }));
        // Mark field as touched
        setTouchedFields((prev) => new Set(prev).add(`passwordDefaults.${key}`));
    };

    // ==========================================
    // MODAL FOCUS MANAGEMENT
    // ==========================================

    // Focus trap for confirmation modal
    useEffect(() => {
        if (!confirmModal.open) {return;}

        // Store previously focused element
        previouslyFocusedRef.current = document.activeElement as HTMLElement;

        const modal = modalRef.current;
        if (!modal) {return;}

        // Get all focusable elements
        const focusableSelectors = [
            'button:not([disabled])',
            'a[href]',
            '[tabindex]:not([tabindex="-1"])',
        ].join(', ');

        const focusableElements = modal.querySelectorAll<HTMLElement>(focusableSelectors);
        firstFocusableRef.current = focusableElements[0] || null;
        lastFocusableRef.current = focusableElements[focusableElements.length - 1] || null;

        // Focus first element
        firstFocusableRef.current?.focus();

        const handleKeyDown = (e: KeyboardEvent) => {
            // ESC closes modal
            if (e.key === 'Escape') {
                e.preventDefault();
                setConfirmModal((prev) => ({ ...prev, open: false }));
                return;
            }

            // Focus trap - WCAG 2.4.3 Focus Order
            if (e.key === 'Tab') {
                if (e.shiftKey) {
                    if (document.activeElement === firstFocusableRef.current) {
                        e.preventDefault();
                        lastFocusableRef.current?.focus();
                    }
                } else {
                    if (document.activeElement === lastFocusableRef.current) {
                        e.preventDefault();
                        firstFocusableRef.current?.focus();
                    }
                }
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            // Return focus to previously focused element - WCAG 2.4.3
            previouslyFocusedRef.current?.focus();
        };
    }, [confirmModal.open]);

    // ==========================================
    // ACTION HANDLERS
    // ==========================================

    const handleReset = () => {
        setConfirmModal({
            open: true,
            title: 'Reset Settings?',
            message: 'This will restore all settings to their default values. Your saved data will not be deleted.',
            type: 'warning',
            action: () => {
                setSettings(DEFAULT_SETTINGS);
                setFormErrors({});
                setTouchedFields(new Set());
                setSaved(true);
                setTimeout(() => setSaved(false), 2000);
            }
        });
    };

    const handleClearData = async () => {
        setConfirmModal({
            open: true,
            title: 'Clear All Data?',
            message: 'This action cannot be undone. It will permanently delete all generated emails, passwords, and history.',
            type: 'danger',
            action: async () => {
                await chrome.storage.local.clear();
                window.location.reload();
            }
        });
    };

    const closeModal = useCallback(() => {
        setConfirmModal((prev) => ({ ...prev, open: false }));
    }, []);

    // ==========================================
    // LOADING STATE
    // ==========================================

    if (loading) {
        return (
            <div className="loading" role="status" aria-live="polite">
                <div className="spinner" aria-hidden="true" />
                <p>Loading settings...</p>
            </div>
        );
    }

    // ==========================================
    // MAIN RENDER
    // ==========================================

    return (
        <div className="options-app" role="application" aria-label="GhostFill Settings">
            <div className="material-grain" aria-hidden="true" />
            <div className="ambient-scene" aria-hidden="true">
                <div className="blob blob-1" />
                <div className="blob blob-2" />
            </div>

            <header className="options-header" role="banner">
                <div className="header-content">
                    <div className="logo-box">
                        <img src={logo} alt="GhostFill" className="logo-img-options" />
                    </div>
                    <div>
                        <div>
                            <h1>GhostFill Settings</h1>
                            <p>Premium privacy experience</p>
                        </div>
                    </div>
                </div>
            </header>

            <main className="options-main" role="main" id="main-content">
                {/* Email Settings */}
                <section className="settings-section" aria-labelledby="email-section-title">
                    <h2 id="email-section-title">📧 Email Identity</h2>

                    <div className="setting-item">
                        <div className="setting-info">
                            <label htmlFor="preferred-email-service" style={{ fontSize: 15, fontWeight: 600 }}>Preferred Email Service</label>
                            <p style={{ opacity: 0.7 }}>Choose the default service for generating temporary emails</p>
                        </div>
                        <select
                            id="preferred-email-service"
                            value={settings.preferredEmailService}
                            onChange={(e) => handleChange('preferredEmailService', e.target.value as UserSettings['preferredEmailService'])}
                            aria-describedby="email-service-description"
                        >
                            <option value="tmailor">TMailor (500+ Rotating Domains) ⭐</option>
                            <option value="mailgw">Mail.gw</option>
                            <option value="mailtm">Mail.tm</option>
                            <option value="templol">TempMail.lol</option>
                            <option value="dropmail">DropMail</option>
                            <option value="guerrilla">Guerrilla Mail</option>
                            <option value="tempmail">1secmail.com</option>
                            <option value="custom">Custom Infrastructure (Private)</option>
                        </select>
                        <span id="email-service-description" className="sr-only">
                            Select your preferred email service provider
                        </span>
                    </div>

                    {settings.preferredEmailService === 'custom' && (
                        <div className="custom-domain-container" role="group" aria-label="Custom domain settings">
                            <div className="setting-item vertical-group">
                                <div className="setting-info" style={{ width: '100%' }}>
                                    <label htmlFor="custom-domain" style={{ fontSize: 13 }}>Custom Email Domain</label>
                                </div>
                                <input
                                    id="custom-domain"
                                    type="text"
                                    placeholder="e.g. mail.private.com"
                                    value={settings.customDomain || ''}
                                    onChange={(e) => handleChange('customDomain', e.target.value)}
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
                                    <label htmlFor="custom-domain-url" style={{ fontSize: 13 }}>API Endpoint (Cloudflare Worker)</label>
                                </div>
                                <input
                                    id="custom-domain-url"
                                    type="url"
                                    placeholder="https://my-worker.workers.dev/api"
                                    value={settings.customDomainUrl || ''}
                                    onChange={(e) => handleChange('customDomainUrl', e.target.value)}
                                    aria-invalid={fieldHasError('customDomainUrl')}
                                    aria-describedby={fieldHasError('customDomainUrl') ? 'custom-domain-url-error' : 'custom-domain-url-description'}
                                />
                                <span id="custom-domain-url-description" className="sr-only">
                                    Enter a valid URL for your custom API endpoint
                                </span>
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
                                        <span className="security-note" style={{ marginLeft: '8px', color: '#f59e0b', fontSize: '11px' }}>
                                            🔒 Stored in memory only (cleared on extension reload)
                                        </span>
                                    </label>
                                </div>
                                <input
                                    id="custom-domain-key"
                                    type="password"
                                    placeholder="Secret Token"
                                    value={sessionSecrets.customDomainKey}
                                    onChange={(e) => handleSessionSecretChange('customDomainKey', e.target.value)}
                                    autoComplete="off"
                                />
                            </div>
                        </div>
                    )}

                    <div className="setting-item">
                        <div className="setting-info">
                            <label id="auto-check-label">Auto-check Inbox</label>
                            <p>Automatically check for new emails in the background</p>
                        </div>
                        <ToggleSwitch
                            checked={settings.autoCheckInbox}
                            onChange={(checked) => handleChange('autoCheckInbox', checked)}
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
                            onChange={(e) => handleChange('checkIntervalSeconds', Number(e.target.value))}
                            onBlur={() => setTouchedFields((prev) => new Set(prev).add('checkIntervalSeconds'))}
                            aria-invalid={fieldHasError('checkIntervalSeconds')}
                            aria-describedby={fieldHasError('checkIntervalSeconds') ? 'check-interval-error' : 'check-interval-description'}
                        />
                        <span id="check-interval-description" className="sr-only">
                            Enter a value between 3 and 60 seconds
                        </span>
                        {fieldHasError('checkIntervalSeconds') && (
                            <span id="check-interval-error" className="field-error" role="alert">
                                {getFieldError('checkIntervalSeconds')}
                            </span>
                        )}
                    </div>
                </section>

                {/* Password Settings */}
                <section className="settings-section" aria-labelledby="password-section-title">
                    <h2 id="password-section-title">🔐 Password Defaults</h2>

                    <div className="setting-item">
                        <div className="setting-info">
                            <label htmlFor="password-length">Default Length</label>
                            <p>Default password length for new generations</p>
                        </div>
                        <input
                            id="password-length"
                            type="number"
                            min="8"
                            max="128"
                            value={settings.passwordDefaults.length}
                            onChange={(e) => handlePasswordDefaultChange('length', Number(e.target.value))}
                            onBlur={() => setTouchedFields((prev) => new Set(prev).add('passwordDefaults.length'))}
                            aria-invalid={fieldHasError('passwordDefaults.length')}
                            aria-describedby={fieldHasError('passwordDefaults.length') ? 'password-length-error' : 'password-length-description'}
                        />
                        <span id="password-length-description" className="sr-only">
                            Enter a value between 8 and 128 characters
                        </span>
                        {fieldHasError('passwordDefaults.length') && (
                            <span id="password-length-error" className="field-error" role="alert">
                                {getFieldError('passwordDefaults.length')}
                            </span>
                        )}
                    </div>

                    <div className="setting-item">
                        <div className="setting-info">
                            <label id="include-symbols-label">Include Symbols</label>
                            <p>Include special characters by default</p>
                        </div>
                        <ToggleSwitch
                            checked={settings.passwordDefaults.symbols}
                            onChange={(checked) => handlePasswordDefaultChange('symbols', checked)}
                            ariaLabel="Include symbols in passwords"
                            ariaLabelledBy="include-symbols-label"
                        />
                    </div>
                </section>

                {/* AI & Intelligence Settings */}
                <section className="settings-section" aria-labelledby="ai-section-title">
                    <h2 id="ai-section-title">🧠 AI & Intelligence</h2>

                    <div className="setting-item">
                        <div className="setting-info">
                            <label id="enable-ai-parser-label">Enable AI Parser</label>
                            <p>Use on-device AI to detect OTPs and analyze form fields (no API key needed)</p>
                        </div>
                        <ToggleSwitch
                            checked={settings.useLLMParser}
                            onChange={(checked) => handleChange('useLLMParser', checked)}
                            ariaLabel="Enable AI parser"
                            ariaLabelledBy="enable-ai-parser-label"
                        />
                    </div>

                    <div className="setting-item vertical-group">
                        <div className="setting-info" style={{ width: '100%' }}>
                            <label style={{ fontSize: 14, fontWeight: 600 }}>🔒 Powered by Local AI</label>
                            <p style={{ opacity: 0.7, lineHeight: 1.5 }}>
                                GhostFill uses a 3-layer on-device AI engine that runs entirely in your browser.
                                No data is ever sent to external servers. Works offline.
                            </p>
                        </div>
                        <div className="tech-pill-container" role="list" aria-label="AI features">
                            <span className="tech-pill indigo" role="listitem">Chrome AI (Gemini Nano)</span>
                            <span className="tech-pill purple" role="listitem">Smart Detection</span>
                            <span className="tech-pill blue" role="listitem">Pattern Engine</span>
                        </div>
                    </div>
                </section>

                {/* UI Settings */}
                <section className="settings-section" aria-labelledby="ui-section-title">
                    <h2 id="ui-section-title">🎨 Appearance</h2>

                    <div className="setting-item">
                        <div className="setting-info">
                            <label htmlFor="dark-mode">Dark Mode</label>
                            <p>Use dark color scheme</p>
                        </div>
                        <select
                            id="dark-mode"
                            value={String(settings.darkMode)}
                            onChange={(e) => {
                                const val = e.target.value;
                                handleChange('darkMode', val === 'system' ? 'system' : val === 'true');
                            }}
                            aria-describedby="dark-mode-description"
                        >
                            <option value="system">System</option>
                            <option value="false">Light</option>
                            <option value="true">Dark</option>
                        </select>
                        <span id="dark-mode-description" className="sr-only">
                            Choose dark mode, light mode, or follow system preference
                        </span>
                    </div>

                    <div className="setting-item">
                        <div className="setting-info">
                            <label id="show-floating-button-label">Show Floating Button</label>
                            <p>Display action button near input fields</p>
                        </div>
                        <ToggleSwitch
                            checked={settings.showFloatingButton}
                            onChange={(checked) => handleChange('showFloatingButton', checked)}
                            ariaLabel="Show floating button"
                            ariaLabelledBy="show-floating-button-label"
                        />
                    </div>
                </section>

                {/* Behavior Settings */}
                <section className="settings-section" aria-labelledby="behavior-section-title">
                    <h2 id="behavior-section-title">⚡ Behavior</h2>

                    <div className="setting-item">
                        <div className="setting-info">
                            <label id="auto-fill-otp-label">Auto-fill OTP</label>
                            <p>Automatically fill OTP fields when code is detected</p>
                        </div>
                        <ToggleSwitch
                            checked={settings.autoFillOTP}
                            onChange={(checked) => handleChange('autoFillOTP', checked)}
                            ariaLabel="Auto-fill OTP"
                            ariaLabelledBy="auto-fill-otp-label"
                        />
                    </div>

                    <div className="setting-item">
                        <div className="setting-info">
                            <label id="notifications-label">Notifications</label>
                            <p>Show notifications for new emails and OTPs</p>
                        </div>
                        <ToggleSwitch
                            checked={settings.notifications}
                            onChange={(checked) => handleChange('notifications', checked)}
                            ariaLabel="Enable notifications"
                            ariaLabelledBy="notifications-label"
                        />
                    </div>

                    <div className="setting-item">
                        <div className="setting-info">
                            <label id="keyboard-shortcuts-label">Keyboard Shortcuts</label>
                            <p>Enable keyboard shortcuts for quick actions</p>
                        </div>
                        <ToggleSwitch
                            checked={settings.keyboardShortcuts}
                            onChange={(checked) => handleChange('keyboardShortcuts', checked)}
                            ariaLabel="Enable keyboard shortcuts"
                            ariaLabelledBy="keyboard-shortcuts-label"
                        />
                    </div>

                    <div className="setting-item">
                        <div className="setting-info">
                            <label id="auto-confirm-links-label">Auto-confirm Verification Links</label>
                            <p>Automatically open verification links from emails (opens in new tab)</p>
                        </div>
                        <ToggleSwitch
                            checked={settings.autoConfirmLinks}
                            onChange={(checked) => handleChange('autoConfirmLinks', checked)}
                            ariaLabel="Auto-confirm verification links"
                            ariaLabelledBy="auto-confirm-links-label"
                        />
                    </div>
                </section>

                {/* Privacy Settings */}
                <section className="settings-section" aria-labelledby="privacy-section-title">
                    <h2 id="privacy-section-title">🔒 Privacy</h2>

                    <div className="setting-item">
                        <div className="setting-info">
                            <label id="save-history-label">Save History</label>
                            <p>Save generated emails and passwords to history</p>
                        </div>
                        <ToggleSwitch
                            checked={settings.saveHistory}
                            onChange={(checked) => handleChange('saveHistory', checked)}
                            ariaLabel="Save history"
                            ariaLabelledBy="save-history-label"
                        />
                    </div>

                    <div className="setting-item">
                        <div className="setting-info">
                            <label htmlFor="history-retention">History Retention</label>
                            <p>Days to keep history before auto-deletion</p>
                        </div>
                        <input
                            id="history-retention"
                            type="number"
                            min="1"
                            max="365"
                            value={settings.historyRetentionDays}
                            onChange={(e) => handleChange('historyRetentionDays', Number(e.target.value))}
                            onBlur={() => setTouchedFields((prev) => new Set(prev).add('historyRetentionDays'))}
                            aria-invalid={fieldHasError('historyRetentionDays')}
                            aria-describedby={fieldHasError('historyRetentionDays') ? 'history-retention-error' : 'history-retention-description'}
                        />
                        <span id="history-retention-description" className="sr-only">
                            Enter a value between 1 and 365 days
                        </span>
                        {fieldHasError('historyRetentionDays') && (
                            <span id="history-retention-error" className="field-error" role="alert">
                                {getFieldError('historyRetentionDays')}
                            </span>
                        )}
                    </div>
                </section>

                {/* Danger Zone */}
                <section className="settings-section danger" aria-labelledby="danger-section-title">
                    <h2 id="danger-section-title">⚠️ Danger Zone</h2>

                    <div className="setting-item">
                        <div className="setting-info">
                            <label>Reset Settings</label>
                            <p>Restore all settings to their defaults</p>
                        </div>
                        <button 
                            className="btn btn-secondary" 
                            onClick={handleReset}
                            type="button"
                            aria-label="Reset all settings to defaults"
                        >
                            Reset
                        </button>
                    </div>

                    <div className="setting-item">
                        <div className="setting-info">
                            <label>Clear All Data</label>
                            <p>Delete all emails, passwords, and history</p>
                        </div>
                        <button 
                            className="btn btn-danger" 
                            onClick={handleClearData}
                            type="button"
                            aria-label="Clear all stored data"
                        >
                            Clear Data
                        </button>
                    </div>
                </section>
            </main>

            <footer className="options-footer" role="contentinfo">
                <p>GhostFill v{version} • Local AI • No API keys needed</p>
            </footer>

            {/* Screen reader announcements - WCAG 4.1.3 Status Messages */}
            <div 
                role="status" 
                aria-live="polite" 
                aria-atomic="true" 
                className="sr-only"
            >
                {saved && 'Settings saved successfully'}
            </div>

            {/* Saved Toast */}
            {saved && (
                <div className="options-toast" role="alert" aria-live="assertive">
                    Changes Saved
                </div>
            )}

            {/* Confirmation Modal with Focus Trap */}
            {confirmModal.open && (
                <div 
                    className="modal-overlay" 
                    onClick={closeModal}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="confirm-modal-title"
                    aria-describedby="confirm-modal-description"
                >
                    <div 
                        ref={modalRef}
                        className="modal-content" 
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h3 id="confirm-modal-title">{confirmModal.title}</h3>
                        <p id="confirm-modal-description">
                            {confirmModal.message}
                        </p>
                        <div className="modal-actions" role="group" aria-label="Confirmation actions">
                            <button
                                className="btn btn-secondary"
                                onClick={closeModal}
                                type="button"
                            >
                                Cancel
                            </button>
                            <button
                                className={`btn ${confirmModal.type === 'danger' ? 'btn-danger' : 'btn-primary'}`}
                                onClick={() => {
                                    confirmModal.action();
                                    closeModal();
                                }}
                                type="button"
                            >
                                Confirm
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default OptionsApp;
