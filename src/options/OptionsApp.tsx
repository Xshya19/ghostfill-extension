import React, { useState, useEffect, useCallback, useRef } from 'react';

import logo from '../assets/icons/icon.png';
import { storageService } from '../services/storageService';
import { UserSettings, DEFAULT_SETTINGS } from '../types/storage.types';
import { createLogger } from '../utils/logger';

import Sidebar, { TabId } from './components/Sidebar';
import AboutTab from './components/tabs/AboutTab';
import AdvancedTab from './components/tabs/AdvancedTab';
import AutomationTab from './components/tabs/AutomationTab';
import EmailTab from './components/tabs/EmailTab';
import GeneralTab from './components/tabs/GeneralTab';
import PasswordTab from './components/tabs/PasswordTab';
import PrivacyTab from './components/tabs/PrivacyTab';

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
// MAIN OPTIONS APP COMPONENT
// ==========================================

const OptionsApp: React.FC = () => {
    const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
    const [sessionSecrets, setSessionSecrets] = useState<SessionSecretsState>({
        customDomainKey: '',
        llmApiKey: '',
    });
    const [saved, setSaved] = useState(false);
    const [loading, setLoading] = useState(true);
    const [formErrors, setFormErrors] = useState<SettingsFormErrors>({});
    const [touchedFields, setTouchedFields] = useState<Set<string>>(new Set());
    const [activeTab, setActiveTab] = useState<TabId>('general');

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

    const validateSettings = useCallback((settingsToValidate: UserSettings): SettingsFormErrors => {
        const errors: SettingsFormErrors = {};
        const pwd = settingsToValidate.passwordDefaults;

        if (pwd.length < 8) {
            errors.passwordDefaults = { length: 'Password length must be at least 8' };
        }
        if (pwd.length > 128) {
            errors.passwordDefaults = { length: 'Password length cannot exceed 128' };
        }

        return errors;
    }, []);

    const getFieldError = useCallback((field: string): string | undefined => {
        if (field.includes('.')) {
            const [parent, child] = field.split('.');
            if (parent === 'passwordDefaults' && formErrors.passwordDefaults) {
                return formErrors.passwordDefaults[child as keyof UserSettings['passwordDefaults']];
            }
        }
        return (formErrors as Record<string, string>)[field];
    }, [formErrors]);

    const fieldHasError = useCallback((field: string): boolean => {
        return touchedFields.has(field) && Boolean(getFieldError(field));
    }, [touchedFields, getFieldError]);

    const handleFieldBlur = useCallback((field: string) => {
        setTouchedFields((prev) => new Set(prev).add(field));
    }, []);

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
        const errors = validateSettings(settings);
        setFormErrors(errors);

        const allFields = new Set<string>([
            'checkIntervalSeconds',
            'historyRetentionDays',
            'passwordDefaults.length',
            'customDomainUrl',
        ]);
        setTouchedFields(allFields);

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

    // Auto-save on change
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
        setTouchedFields((prev) => new Set(prev).add(key as string));
    };

    const handleSessionSecretChange = (key: 'customDomainKey' | 'llmApiKey', value: string) => {
        setSessionSecrets((prev) => ({ ...prev, [key]: value }));
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
        setTouchedFields((prev) => new Set(prev).add(`passwordDefaults.${key}`));
    };

    const handleSettingsImport = (imported: UserSettings) => {
        setSettings(imported);
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
    };

    // ==========================================
    // MODAL FOCUS MANAGEMENT
    // ==========================================

    useEffect(() => {
        if (!confirmModal.open) { return; }

        previouslyFocusedRef.current = document.activeElement as HTMLElement;

        const modal = modalRef.current;
        if (!modal) { return; }

        const focusableSelectors = [
            'button:not([disabled])',
            'a[href]',
            '[tabindex]:not([tabindex="-1"])',
        ].join(', ');

        const focusableElements = modal.querySelectorAll<HTMLElement>(focusableSelectors);
        firstFocusableRef.current = focusableElements[0] || null;
        lastFocusableRef.current = focusableElements[focusableElements.length - 1] || null;

        firstFocusableRef.current?.focus();

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                setConfirmModal((prev) => ({ ...prev, open: false }));
                return;
            }

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

    const handleClearData = () => {
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
    // TAB RENDER
    // ==========================================

    const renderActiveTab = () => {
        switch (activeTab) {
            case 'general':
                return (
                    <GeneralTab
                        settings={settings}
                        onSettingChange={handleChange}
                    />
                );
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
                return (
                    <AutomationTab
                        settings={settings}
                        onSettingChange={handleChange}
                    />
                );
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
                        sessionSecrets={sessionSecrets}
                        onSessionSecretChange={handleSessionSecretChange}
                        onReset={handleReset}
                        onClearData={handleClearData}
                        onSettingsImport={handleSettingsImport}
                    />
                );
            case 'about':
                return <AboutTab />;
            default:
                return null;
        }
    };

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

            <div className="dashboard-layout">
                <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />

                <main className="options-main" role="main" id="main-content">
                    {renderActiveTab()}
                </main>
            </div>

            <footer className="options-footer" role="contentinfo">
                <p>GhostFill v{version} • Local AI • No API keys needed</p>
            </footer>

            {/* Screen reader announcements */}
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
                    ✓ Changes Saved
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
