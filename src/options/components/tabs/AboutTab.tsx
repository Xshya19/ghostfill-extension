import React, { useState, useEffect } from 'react';

import SettingsSection from '../SettingsSection';

const AboutTab: React.FC = () => {
    const version = chrome.runtime.getManifest().version;
    const [storageUsage, setStorageUsage] = useState<{ used: number; quota: number } | null>(null);

    useEffect(() => {
        // Get storage usage
        chrome.storage.local.getBytesInUse(null, (bytes) => {
            setStorageUsage({
                used: bytes,
                quota: 10 * 1024 * 1024, // 10MB quota for chrome.storage.local
            });
        });
    }, []);

    const formatBytes = (bytes: number): string => {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    };

    const usagePercent = storageUsage
        ? Math.min((storageUsage.used / storageUsage.quota) * 100, 100)
        : 0;

    return (
        <div
            role="tabpanel"
            id="tabpanel-about"
            aria-labelledby="tab-about"
        >
            <SettingsSection id="extension-info" title="GhostFill" icon="👻">
                <div className="about-hero">
                    <div className="about-version">
                        <span className="version-badge">v{version}</span>
                    </div>
                    <p className="about-tagline">
                        Disposable emails, secure passwords, and automatic OTP detection & fill.
                        <br />
                        Local AI engine — 100% Free & Open Source.
                    </p>
                </div>

                <div className="about-links">
                    <a
                        href="https://github.com/nicholasxshya/ghostfill-extension"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="about-link"
                    >
                        ⭐ GitHub Repository
                    </a>
                    <a
                        href="https://github.com/nicholasxshya/ghostfill-extension/issues"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="about-link"
                    >
                        🐛 Report a Bug
                    </a>
                    <a
                        href="https://github.com/nicholasxshya/ghostfill-extension/blob/main/LICENSE"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="about-link"
                    >
                        📄 MIT License
                    </a>
                </div>
            </SettingsSection>

            <SettingsSection id="storage-usage" title="Storage Usage" icon="💿">
                {storageUsage ? (
                    <div className="storage-monitor">
                        <div className="storage-bar-wrapper">
                            <div
                                className="storage-bar-fill"
                                style={{ width: `${usagePercent}%` }}
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
                    <p style={{ opacity: 0.6 }}>Loading storage info…</p>
                )}
            </SettingsSection>

            <SettingsSection id="tech-stack" title="Built With" icon="🏗️">
                <div className="tech-pill-container" role="list" aria-label="Technologies used">
                    <span className="tech-pill indigo" role="listitem">React</span>
                    <span className="tech-pill purple" role="listitem">TypeScript</span>
                    <span className="tech-pill blue" role="listitem">Webpack</span>
                    <span className="tech-pill indigo" role="listitem">Chrome MV3</span>
                    <span className="tech-pill purple" role="listitem">Gemini Nano</span>
                    <span className="tech-pill blue" role="listitem">Framer Motion</span>
                </div>
            </SettingsSection>
        </div>
    );
};

export default AboutTab;
