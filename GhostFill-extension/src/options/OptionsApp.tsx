import React, { useState, useEffect, useCallback } from 'react';
import { UserSettings, DEFAULT_SETTINGS, EmailService } from '../types';

import logo from '../assets/icons/icon.png';

const OptionsApp: React.FC = () => {
    const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
    const [saved, setSaved] = useState(false);
    const [loading, setLoading] = useState(true);
    const [confirmModal, setConfirmModal] = useState<{
        open: boolean;
        title: string;
        message: string;
        action: () => void;
        type: 'danger' | 'warning';
    }>({ open: false, title: '', message: '', action: () => { }, type: 'warning' });

    const loadSettings = useCallback(async () => {
        try {
            const response = await chrome.runtime.sendMessage({ action: 'GET_SETTINGS' });
            if (response?.settings) {
                setSettings(response.settings);
            }
        } catch (error) {
            console.error('Failed to load settings:', error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadSettings();
    }, [loadSettings]);

    const saveSettings = async () => {
        try {
            await chrome.runtime.sendMessage({
                action: 'UPDATE_SETTINGS',
                payload: settings,
            });
            setSaved(true);
            setTimeout(() => setSaved(false), 2500); // Longer confirmation
        } catch (error) {
            console.error('Failed to save settings:', error);
        }
    };

    // Auto-save on change
    useEffect(() => {
        if (!loading) {
            saveSettings();
        }
    }, [settings]);

    const handleChange = <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => {
        setSettings((prev) => ({ ...prev, [key]: value }));
    };

    const handleReset = () => {
        setConfirmModal({
            open: true,
            title: 'Reset Settings?',
            message: 'This will restore all settings to their default values. Your saved data will not be deleted.',
            type: 'warning',
            action: () => {
                setSettings(DEFAULT_SETTINGS);
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

    if (loading) {
        return (
            <div className="loading">
                <div className="spinner" />
                Loading settings...
            </div>
        );
    }

    return (
        <div className="options-app">
            <div className="material-grain" />
            <div className="ambient-scene">
                <div className="blob blob-1" />
                <div className="blob blob-2" />
            </div>

            <header className="options-header">
                <div className="header-content">
                    <div className="logo-box">
                        <img src={logo} alt="GhostFill" className="logo-img" style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                            transform: 'scale(1.25)',
                            filter: 'drop-shadow(0 4px 12px rgba(99, 102, 241, 0.25)) drop-shadow(0 2px 6px rgba(0, 0, 0, 0.15))'
                        }} />
                    </div>
                    <div>
                        <div>
                            <h1>GhostFill Settings</h1>
                            <p>Premium privacy experience</p>
                        </div>
                    </div>
                </div>
            </header>

            <main className="options-main">
                {/* Email Settings */}
                <section className="settings-section">
                    <h2>📧 Email Identity</h2>

                    <div className="setting-item">
                        <div className="setting-info">
                            <label style={{ fontSize: 15, fontWeight: 600 }}>Preferred Email Service</label>
                            <p style={{ opacity: 0.7 }}>Choose the default service for generating temporary emails</p>
                        </div>
                        <select
                            value={settings.preferredEmailService}
                            onChange={(e) => handleChange('preferredEmailService', e.target.value as 'mailgw' | 'mailtm' | 'dropmail' | 'guerrilla' | 'tempmail' | 'templol' | 'tmailor')}
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
                    </div>

                    {settings.preferredEmailService === 'custom' && (
                        <div style={{ background: 'var(--glass-bg-thick)', padding: '16px', borderRadius: '12px', marginTop: '12px', border: '1px solid var(--glass-border)' }}>
                            <div className="setting-item" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 8, border: 'none', padding: 0 }}>
                                <div className="setting-info" style={{ width: '100%' }}>
                                    <label style={{ fontSize: 13 }}>Custom Email Domain</label>
                                </div>
                                <input
                                    type="text"
                                    placeholder="e.g. mail.private.com"
                                    value={settings.customDomain || ''}
                                    onChange={(e) => handleChange('customDomain', e.target.value)}
                                    style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', background: 'rgba(0,0,0,0.05)', border: '1px solid rgba(0,0,0,0.1)' }}
                                />
                            </div>

                            <div className="setting-item" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 8, border: 'none', padding: '12px 0 0 0' }}>
                                <div className="setting-info" style={{ width: '100%' }}>
                                    <label style={{ fontSize: 13 }}>API Endpoint (Cloudflare Worker)</label>
                                </div>
                                <input
                                    type="text"
                                    placeholder="https://my-worker.workers.dev/api"
                                    value={settings.customDomainUrl || ''}
                                    onChange={(e) => handleChange('customDomainUrl', e.target.value)}
                                    style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', background: 'rgba(0,0,0,0.05)', border: '1px solid rgba(0,0,0,0.1)' }}
                                />
                            </div>

                            <div className="setting-item" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 8, border: 'none', padding: '12px 0 0 0' }}>
                                <div className="setting-info" style={{ width: '100%' }}>
                                    <label style={{ fontSize: 13 }}>API Key / Secret</label>
                                </div>
                                <input
                                    type="password"
                                    placeholder="Secret Token"
                                    value={settings.customDomainKey || ''}
                                    onChange={(e) => handleChange('customDomainKey', e.target.value)}
                                    style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', background: 'rgba(0,0,0,0.05)', border: '1px solid rgba(0,0,0,0.1)' }}
                                />
                            </div>
                        </div>
                    )}

                    <div className="setting-item">
                        <div className="setting-info">
                            <label>Auto-check Inbox</label>
                            <p>Automatically check for new emails in the background</p>
                        </div>
                        <label className="toggle">
                            <input
                                type="checkbox"
                                checked={settings.autoCheckInbox}
                                onChange={(e) => handleChange('autoCheckInbox', e.target.checked)}
                            />
                            <span className="toggle-slider" />
                        </label>
                    </div>

                    <div className="setting-item">
                        <div className="setting-info">
                            <label>Check Interval</label>
                            <p>How often to check for new emails (seconds)</p>
                        </div>
                        <input
                            type="number"
                            min="3"
                            max="60"
                            value={settings.checkIntervalSeconds}
                            onChange={(e) => handleChange('checkIntervalSeconds', Number(e.target.value))}
                        />
                    </div>
                </section>

                {/* Password Settings */}
                <section className="settings-section">
                    <h2>🔐 Password Defaults</h2>

                    <div className="setting-item">
                        <div className="setting-info">
                            <label>Default Length</label>
                            <p>Default password length for new generations</p>
                        </div>
                        <input
                            type="number"
                            min="8"
                            max="128"
                            value={settings.passwordDefaults.length}
                            onChange={(e) => handleChange('passwordDefaults', {
                                ...settings.passwordDefaults,
                                length: Number(e.target.value),
                            })}
                        />
                    </div>

                    <div className="setting-item">
                        <div className="setting-info">
                            <label>Include Symbols</label>
                            <p>Include special characters by default</p>
                        </div>
                        <label className="toggle">
                            <input
                                type="checkbox"
                                checked={settings.passwordDefaults.symbols}
                                onChange={(e) => handleChange('passwordDefaults', {
                                    ...settings.passwordDefaults,
                                    symbols: e.target.checked,
                                })}
                            />
                            <span className="toggle-slider" />
                        </label>
                    </div>
                </section>

                {/* AI & Intelligence Settings */}
                <section className="settings-section">
                    <h2>🧠 AI & Intelligence</h2>

                    <div className="setting-item">
                        <div className="setting-info">
                            <label>Enable AI Parser</label>
                            <p>Use local AI to detect OTPs and analyze form fields</p>
                        </div>
                        <label className="toggle">
                            <input
                                type="checkbox"
                                checked={settings.useLLMParser}
                                onChange={(e) => handleChange('useLLMParser', e.target.checked)}
                            />
                            <span className="toggle-slider" />
                        </label>
                    </div>

                    <div className="setting-item" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 12 }}>
                        <div className="setting-info" style={{ width: '100%' }}>
                            <label>Groq API Key (Free)</label>
                            <p>Required for AI-powered OTP extraction and smart form detection</p>
                        </div>
                        <input
                            type="password"
                            value={settings.llmApiKey || ''}
                            onChange={(e) => handleChange('llmApiKey', e.target.value)}
                            placeholder="gsk_..."
                            style={{ width: '100%', fontFamily: 'monospace' }}
                        />
                        <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: -4 }}>
                            Get your free key at <b>console.groq.com</b> → Llama 3.1 8B (560 tokens/sec, 100% free)
                        </p>
                    </div>
                </section>

                {/* UI Settings */}
                <section className="settings-section">
                    <h2>🎨 Appearance</h2>

                    <div className="setting-item">
                        <div className="setting-info">
                            <label>Dark Mode</label>
                            <p>Use dark color scheme</p>
                        </div>
                        <select
                            value={String(settings.darkMode)}
                            onChange={(e) => {
                                const val = e.target.value;
                                handleChange('darkMode', val === 'system' ? 'system' : val === 'true');
                            }}
                        >
                            <option value="system">System</option>
                            <option value="false">Light</option>
                            <option value="true">Dark</option>
                        </select>
                    </div>

                    <div className="setting-item">
                        <div className="setting-info">
                            <label>Show Floating Button</label>
                            <p>Display action button near input fields</p>
                        </div>
                        <label className="toggle">
                            <input
                                type="checkbox"
                                checked={settings.showFloatingButton}
                                onChange={(e) => handleChange('showFloatingButton', e.target.checked)}
                            />
                            <span className="toggle-slider" />
                        </label>
                    </div>
                </section>

                {/* Behavior Settings */}
                <section className="settings-section">
                    <h2>⚡ Behavior</h2>

                    <div className="setting-item">
                        <div className="setting-info">
                            <label>Auto-fill OTP</label>
                            <p>Automatically fill OTP fields when code is detected</p>
                        </div>
                        <label className="toggle">
                            <input
                                type="checkbox"
                                checked={settings.autoFillOTP}
                                onChange={(e) => handleChange('autoFillOTP', e.target.checked)}
                            />
                            <span className="toggle-slider" />
                        </label>
                    </div>

                    <div className="setting-item">
                        <div className="setting-info">
                            <label>Notifications</label>
                            <p>Show notifications for new emails and OTPs</p>
                        </div>
                        <label className="toggle">
                            <input
                                type="checkbox"
                                checked={settings.notifications}
                                onChange={(e) => handleChange('notifications', e.target.checked)}
                            />
                            <span className="toggle-slider" />
                        </label>
                    </div>

                    <div className="setting-item">
                        <div className="setting-info">
                            <label>Sound Effects</label>
                            <p>Play sound when new OTP is received</p>
                        </div>
                        <label className="toggle">
                            <input
                                type="checkbox"
                                checked={settings.soundEnabled}
                                onChange={(e) => handleChange('soundEnabled', e.target.checked)}
                            />
                            <span className="toggle-slider" />
                        </label>
                    </div>

                    <div className="setting-item">
                        <div className="setting-info">
                            <label>Keyboard Shortcuts</label>
                            <p>Enable keyboard shortcuts for quick actions</p>
                        </div>
                        <label className="toggle">
                            <input
                                type="checkbox"
                                checked={settings.keyboardShortcuts}
                                onChange={(e) => handleChange('keyboardShortcuts', e.target.checked)}
                            />
                            <span className="toggle-slider" />
                        </label>
                    </div>
                </section>

                {/* Privacy Settings */}
                <section className="settings-section">
                    <h2>🔒 Privacy</h2>

                    <div className="setting-item">
                        <div className="setting-info">
                            <label>Save History</label>
                            <p>Save generated emails and passwords to history</p>
                        </div>
                        <label className="toggle">
                            <input
                                type="checkbox"
                                checked={settings.saveHistory}
                                onChange={(e) => handleChange('saveHistory', e.target.checked)}
                            />
                            <span className="toggle-slider" />
                        </label>
                    </div>

                    <div className="setting-item">
                        <div className="setting-info">
                            <label>History Retention</label>
                            <p>Days to keep history before auto-deletion</p>
                        </div>
                        <input
                            type="number"
                            min="1"
                            max="365"
                            value={settings.historyRetentionDays}
                            onChange={(e) => handleChange('historyRetentionDays', Number(e.target.value))}
                        />
                    </div>
                </section>

                {/* Danger Zone */}
                <section className="settings-section danger">
                    <h2>⚠️ Danger Zone</h2>

                    <div className="setting-item">
                        <div className="setting-info">
                            <label>Reset Settings</label>
                            <p>Restore all settings to their defaults</p>
                        </div>
                        <button className="btn btn-secondary" onClick={handleReset}>
                            Reset
                        </button>
                    </div>

                    <div className="setting-item">
                        <div className="setting-info">
                            <label>Clear All Data</label>
                            <p>Delete all emails, passwords, and history</p>
                        </div>
                        <button className="btn btn-danger" onClick={handleClearData}>
                            Clear Data
                        </button>
                    </div>
                </section>
            </main>

            <footer className="options-footer" style={{ marginTop: 'auto', padding: '20px', textAlign: 'center', opacity: 0.75 }}>
                <p>GhostFill v1.0.15 • Liquid Glass Design</p>
            </footer>

            {/* Saved Toast */}
            {saved && (
                <div style={{
                    position: 'fixed',
                    bottom: 24,
                    right: 24,
                    background: '#32D74B',
                    color: 'white',
                    padding: '12px 24px',
                    borderRadius: 50,
                    fontWeight: 600,
                    boxShadow: '0 8px 20px rgba(50, 215, 75, 0.3)',
                    animation: 'fadeIn 0.3s ease',
                    zIndex: 2000
                }}>
                    Changes Saved
                </div>
            )}

            {/* Confirmation Modal */}
            {confirmModal.open && (
                <div style={{
                    position: 'fixed',
                    inset: 0,
                    background: 'rgba(0,0,0,0.4)',
                    backdropFilter: 'blur(5px)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 3000,
                    animation: 'fadeIn 0.2s ease'
                }} onClick={() => setConfirmModal({ ...confirmModal, open: false })}>
                    <div style={{
                        background: 'var(--glass-bg-thick)',
                        backdropFilter: 'blur(40px)',
                        padding: 32,
                        borderRadius: 24,
                        width: '90%',
                        maxWidth: 400,
                        border: '0.5px solid var(--glass-border)',
                        boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
                        transform: 'scale(1)',
                        animation: 'scaleIn 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
                    }} onClick={e => e.stopPropagation()}>
                        <h3 style={{ margin: '0 0 12px 0', fontSize: 22, fontWeight: 700 }}>{confirmModal.title}</h3>
                        <p style={{ margin: '0 0 24px 0', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                            {confirmModal.message}
                        </p>
                        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                            <button
                                className="btn btn-secondary"
                                onClick={() => setConfirmModal({ ...confirmModal, open: false })}
                                style={{ flex: 1, height: 44, borderRadius: 12 }}
                            >
                                Cancel
                            </button>
                            <button
                                className={`btn ${confirmModal.type === 'danger' ? 'btn-danger' : 'btn-primary'}`}
                                onClick={() => {
                                    confirmModal.action();
                                    setConfirmModal({ ...confirmModal, open: false });
                                }}
                                style={{ flex: 1, height: 44, borderRadius: 12 }}
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
