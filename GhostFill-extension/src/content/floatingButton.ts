// Floating Action Button Component

import { createLogger } from '../utils/logger';
import { safeSendMessage } from '../utils/messaging';
import {
    GenerateEmailResponse,
    GeneratePasswordResponse,
    GetLastOTPResponse
} from '../types';
import { TIMING, UI } from '../utils/constants';
import { debounce } from '../utils/debounce';
import { pageStatus } from './pageStatus';

const log = createLogger('FloatingButton');

import { AutoFiller } from './autoFiller';

export class FloatingButton {
    private container: HTMLDivElement | null = null;
    private shadowRoot: ShadowRoot | null = null;
    private button: HTMLButtonElement | null = null;
    private menu: HTMLDivElement | null = null;
    private hideTimeout: ReturnType<typeof setTimeout> | null = null;
    private currentField: HTMLElement | null = null;
    private isMenuOpen: boolean = false;
    private autoFiller: AutoFiller;
    private isEnabled: boolean = true;
    
    // Track message listener to prevent accumulation
    private messageListener: ((message: any) => void) | null = null;
    private listenerRegistered: boolean = false;

    constructor(autoFiller: AutoFiller) {
        this.autoFiller = autoFiller;
    }

    /**
     * Initialize floating button - FAST INIT
     */
    async init(): Promise<void> {
        // FAST: Create container immediately (don't wait for settings)
        this.createContainer();
        this.setupEventListeners();
        log.debug('Floating button initialized (fast mode)');

        // ASYNC: Fetch settings in background (don't block button display)
        this.loadSettingsAsync();
    }

    /**
     * Load settings asynchronously - doesn't block button creation
     */
    private async loadSettingsAsync(): Promise<void> {
        try {
            const response = await safeSendMessage({ action: 'GET_SETTINGS' }) as { settings?: { showFloatingButton: boolean } };
            if (response && response.settings) {
                this.isEnabled = response.settings.showFloatingButton;
                if (!this.isEnabled) this.hide();
            }
        } catch (e) {
            log.warn('Failed to fetch settings, defaulting to enabled');
        }

        // Listen for updates - only register once to prevent listener accumulation
        if (chrome?.runtime?.onMessage && !this.listenerRegistered) {
            this.messageListener = (message: any) => {
                if (message.action === 'SETTINGS_CHANGED' && message.settings) {
                    this.isEnabled = message.settings.showFloatingButton;
                    if (!this.isEnabled) this.hide();
                }
            };
            chrome.runtime.onMessage.addListener(this.messageListener);
            this.listenerRegistered = true;
        }
    }

    /**
     * Create the floating button container with Shadow DOM
     */
    private createContainer(): void {
        // Remove existing container if any (cleanup zombies)
        const existing = document.getElementById('ghostfill-fab');
        if (existing) {
            existing.remove();
        }

        // Create container
        this.container = document.createElement('div');
        this.container.id = 'ghostfill-fab';
        this.container.style.cssText = 'position: fixed; z-index: 2147483647; display: none;';

        // Attach shadow DOM for style isolation
        this.shadowRoot = this.container.attachShadow({ mode: 'closed' });

        // Add styles
        const styles = document.createElement('style');
        styles.textContent = this.getStyles();
        this.shadowRoot.appendChild(styles);

        // Create button
        this.button = document.createElement('button');
        this.button.className = 'fab-button';
        this.button.innerHTML = this.getButtonIcon('magic');
        this.button.setAttribute('aria-label', 'GhostFill');
        this.shadowRoot.appendChild(this.button);

        // Create menu
        this.menu = document.createElement('div');
        this.menu.className = 'fab-menu';
        this.menu.innerHTML = this.getMenuHTML();
        this.shadowRoot.appendChild(this.menu);

        // Add to document
        document.body.appendChild(this.container);

        // Button click handler - DIRECTLY TRIGGER SMART FILL (no menu)
        this.button.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();

            // Show clear loading state - tell user we're analyzing
            pageStatus.show('Analyzing form...', 'loading');
            this.setLoading(true);

            try {
                // DIRECT CALL TO AUTOFILLER
                log.info('Floating button triggering direct smart fill...');
                const result = await this.autoFiller.smartFill();

                // Show appropriate message based on result
                if (result.success && result.filledCount > 0) {
                    pageStatus.success(`Filled ${result.filledCount} field(s)!`, 1500);
                } else {
                    // Silent fail - don't show irritating error messages
                    // User will understand nothing happened
                    log.debug('No fields filled, silent dismiss');
                }

            } catch (error) {
                log.error('Smart fill error:', error);
                pageStatus.error('Fill failed - try clicking an input first', 2500);
            }
            this.setLoading(false);
            this.hide();
        });

        // Menu item click handlers (kept for long-press future enhancement)
        this.menu.querySelectorAll('.menu-item').forEach((item) => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const action = (e.currentTarget as HTMLElement).dataset.action;
                this.handleMenuAction(action || '');
            });
        });
    }



    /**
     * Check if a field is visible and fillable
     */
    private isVisibleField(field: HTMLInputElement): boolean {
        if (!field || field.readOnly || field.disabled || field.type === 'hidden') return false;
        const rect = field.getBoundingClientRect();
        const style = window.getComputedStyle(field);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    }

    /**
     * Fill a single input field with proper event dispatch - returns true if successful
     */
    private fillInputField(field: HTMLInputElement, value: string): boolean {
        if (!field || field.readOnly || field.disabled) return false;

        field.focus();

        // Use native setter for React compatibility
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        if (setter) {
            setter.call(field, value);
        } else {
            field.value = value;
        }

        // Trigger events
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.dispatchEvent(new Event('change', { bubbles: true }));
        field.dispatchEvent(new FocusEvent('blur', { bubbles: true }));

        return true;
    }

    /**
     * Setup event listeners for input focus
     */
    private setupEventListeners(): void {
        // Debounced focus handler
        const handleFocus = debounce((e: FocusEvent) => {
            // Handle Shadow DOM focus events properly
            const path = e.composedPath?.() || [];
            const target = (path[0] || e.target) as HTMLElement;

            if (this.isInputElement(target)) {
                this.showNearField(target);
            }
        }, TIMING.DEBOUNCE_DELAY_MS);

        // Focus in
        document.addEventListener('focusin', handleFocus, true); // Capture phase

        // Focus out
        document.addEventListener('focusout', () => {
            this.scheduleHide();
        }, true);

        // Click outside to close menu
        document.addEventListener('click', (e) => {
            if (this.isMenuOpen && !this.container?.contains(e.target as Node)) {
                this.closeMenu();
            }
        });

        // Scroll handler to reposition
        window.addEventListener('scroll', debounce(() => {
            if (this.currentField && this.isVisible()) {
                this.positionNearField(this.currentField);
            }
        }, 50), true);
    }

    /**
     * Show button near a field - SMART PAGE DETECTION
     */
    showNearField(field: HTMLElement): void {
        if (!this.isEnabled) return;

        // SMART PAGE DETECTION: Only show on auth-related pages
        if (!this.isAuthPage()) {
            log.debug('Not an auth page, hiding floating button');
            return;
        }

        // Don't show button on tiny OTP input boxes (maxlength=1 or very small)
        const input = field as HTMLInputElement;
        const rect = field.getBoundingClientRect();
        const isOTPBox = input.maxLength === 1 || rect.width < 50;

        if (isOTPBox) {
            log.debug('Skipping floating button for tiny OTP box');
            // Trigger OTP page detection since this looks like an OTP page
            log.info('🔢 Detected tiny input - likely OTP page, triggering detection...');
            this.hide();
            return;
        }

        this.currentField = field;
        this.cancelHide();
        this.updateButtonIcon(field);
        this.positionNearField(field);
        this.show();
        this.scheduleHide();
    }

    /**
     * Position button INSIDE field (Ghost Mode) - fixed positioning
     * Uses getBoundingClientRect for accurate viewport-relative positioning
     */
    private positionNearField(field: HTMLElement): void {
        if (!this.container) return;

        const rect = field.getBoundingClientRect();

        // Validate the rect - ensure field is actually visible
        if (rect.width === 0 || rect.height === 0) {
            this.hide();
            return;
        }

        // Smaller button for inside-field positioning
        const buttonSize = 24;
        const padding = 8;

        // Position INSIDE the input field, right-aligned with padding
        let left = rect.right - buttonSize - padding;
        let top = rect.top + (rect.height - buttonSize) / 2;

        // BOUNDS CHECKING: Ensure button stays within viewport
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        // Prevent button from going off-screen right
        if (left + buttonSize > viewportWidth - 10) {
            left = viewportWidth - buttonSize - 10;
        }
        // Prevent button from going off-screen left  
        if (left < 10) {
            left = 10;
        }
        // Prevent button from going off-screen top
        if (top < 10) {
            top = 10;
        }
        // Prevent button from going off-screen bottom
        if (top + buttonSize > viewportHeight - 10) {
            top = viewportHeight - buttonSize - 10;
        }

        // Also ensure button doesn't appear if field is mostly off-screen
        if (rect.bottom < 0 || rect.top > viewportHeight || rect.right < 0 || rect.left > viewportWidth) {
            this.hide();
            return;
        }

        // Apply position directly (fixed positioning relative to viewport)
        this.container.style.left = `${left}px`;
        this.container.style.top = `${top}px`;
        this.container.style.transform = 'none'; // Don't use transform, use direct left/top
    }

    /**
     * Set loading state
     */
    private setLoading(loading: boolean): void {
        if (!this.button) return;
        if (loading) {
            this.button.classList.add('loading');
            this.button.innerHTML = '<div class="spinner"></div>';
        } else {
            this.button.classList.remove('loading');
            if (this.currentField) {
                this.updateButtonIcon(this.currentField);
            } else {
                this.button.innerHTML = this.getButtonIcon('magic');
            }
        }
    }

    /**
     * Check if current page is an auth/signup/login page
     * Smart detection using URL patterns and form presence
     */
    private isAuthPage(): boolean {
        const url = window.location.href.toLowerCase();
        const path = window.location.pathname.toLowerCase();
        
        // URL patterns that indicate auth pages
        const authPatterns = [
            'login', 'signin', 'sign-in', 'sign_in',
            'signup', 'sign-up', 'sign_up', 'register', 
            'auth', 'authenticate', 'account/create',
            'join', 'enroll', 'subscribe', 'checkout',
            'password', 'forgot', 'reset', 'verify',
            'otp', 'code', 'confirm', 'activate'
        ];
        
        // Check URL for auth patterns
        const isAuthURL = authPatterns.some(pattern => 
            url.includes(pattern) || path.includes(pattern)
        );
        
        if (isAuthURL) {
            log.debug('Auth page detected via URL pattern');
            return true;
        }
        
        // Check for presence of password or email fields (form-based detection)
        const hasPasswordField = document.querySelector('input[type="password"]') !== null;
        const hasEmailField = document.querySelector('input[type="email"]') !== null;
        const hasEmailNameField = document.querySelector('input[name*="email"], input[id*="email"]') !== null;
        
        if (hasPasswordField || hasEmailField || hasEmailNameField) {
            log.debug('Auth page detected via form fields');
            return true;
        }
        
        // Check for OTP/verification fields (for 2FA pages without email/password)
        const hasOTPField = document.querySelector(
            'input[autocomplete="one-time-code"], input[name*="otp"], input[name*="code"], ' +
            'input[id*="otp"], input[id*="code"], input[name*="verify"], input[maxlength="1"], ' +
            'input[maxlength="4"], input[maxlength="6"], input[maxlength="8"]'
        ) !== null;
        
        if (hasOTPField) {
            log.debug('Auth page detected via OTP fields');
            return true;
        }
        
        return false;
    }

    /**
     * Update button icon based on field type - CONTEXTUAL MODES
     * Shows appropriate icon based on what the field expects
     */
    private updateButtonIcon(field: HTMLElement): void {
        if (!this.button) return;

        const input = field as HTMLInputElement;
        const type = input.type?.toLowerCase() || '';
        const name = (input.name || input.id || '').toLowerCase();
        const placeholder = (input.placeholder || '').toLowerCase();
        const label = this.getFieldLabel(input).toLowerCase();
        const combined = `${name} ${placeholder} ${label}`;

        let icon = 'magic';

        // 📧 Email mode
        if (type === 'email' || combined.includes('email') || combined.includes('e-mail')) {
            icon = 'email';
        }
        // 🔑 Password mode
        else if (type === 'password' || combined.includes('password') || combined.includes('pwd')) {
            icon = 'key';
        }
        // 🔢 OTP/Code mode
        else if (combined.includes('otp') || combined.includes('code') || combined.includes('verify') || 
                 combined.includes('pin') || combined.includes('token') || input.maxLength <= 8 && /^\d*$/.test(input.value)) {
            icon = 'pin';
        }
        // 👤 First Name mode
        else if (combined.includes('first') && combined.includes('name') || combined.includes('fname') || 
                 combined.includes('given') || combined.includes('firstname')) {
            icon = 'user';
        }
        // 👥 Last Name mode
        else if (combined.includes('last') && combined.includes('name') || combined.includes('lname') || 
                 combined.includes('surname') || combined.includes('family') || combined.includes('lastname')) {
            icon = 'user';
        }
        // 👤 Full Name mode
        else if (combined.includes('name') && !combined.includes('user')) {
            icon = 'user';
        }
        // 👤 Username mode (usually can use email)
        else if (combined.includes('user') && combined.includes('name') || combined.includes('username')) {
            icon = 'email';
        }

        this.button.innerHTML = this.getButtonIcon(icon);
    }

    /**
     * Get the label text associated with an input field
     */
    private getFieldLabel(input: HTMLInputElement): string {
        // Check for aria-label
        if (input.getAttribute('aria-label')) {
            return input.getAttribute('aria-label') || '';
        }
        // Check for associated label
        if (input.id) {
            const label = document.querySelector(`label[for="${input.id}"]`);
            if (label) return label.textContent || '';
        }
        // Check for parent label
        const parentLabel = input.closest('label');
        if (parentLabel) return parentLabel.textContent || '';
        // Check for preceding text
        const prev = input.previousElementSibling;
        if (prev && prev.tagName !== 'INPUT') return prev.textContent || '';
        return '';
    }

    /**
     * Get button icon SVG
     */
    private getButtonIcon(type: string): string {
        // Apple-inspired gradient icons with vibrant colors
        const icons: Record<string, string> = {
            // Ghost icon - the main branding icon
            magic: `<svg viewBox="0 0 24 24" fill="none">
                <defs>
                    <linearGradient id="ghostGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" style="stop-color:#6366F1"/>
                        <stop offset="100%" style="stop-color:#8B5CF6"/>
                    </linearGradient>
                </defs>
                <path d="M12 2C8.13 2 5 5.13 5 9v11l2-2 2 2 2-2 2 2 2-2 2 2V9c0-3.87-3.13-7-7-7z" fill="url(#ghostGrad)"/>
                <circle cx="9" cy="10" r="1.5" fill="white"/>
                <circle cx="15" cy="10" r="1.5" fill="white"/>
            </svg>`,

            // Email icon
            email: `<svg viewBox="0 0 24 24" fill="none">
                <defs>
                    <linearGradient id="emailGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" style="stop-color:#3B82F6"/>
                        <stop offset="100%" style="stop-color:#1D4ED8"/>
                    </linearGradient>
                </defs>
                <rect x="2" y="4" width="20" height="16" rx="3" fill="url(#emailGrad)"/>
                <path d="M2 7l10 6 10-6" stroke="white" stroke-width="1.5" stroke-linecap="round"/>
            </svg>`,

            // Key/Password icon  
            key: `<svg viewBox="0 0 24 24" fill="none">
                <defs>
                    <linearGradient id="keyGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" style="stop-color:#10B981"/>
                        <stop offset="100%" style="stop-color:#059669"/>
                    </linearGradient>
                </defs>
                <circle cx="8" cy="15" r="5" fill="url(#keyGrad)"/>
                <path d="M12 12l8-8M18 6l2 2M20 4l2 2" stroke="url(#keyGrad)" stroke-width="2.5" stroke-linecap="round"/>
                <circle cx="8" cy="15" r="2" fill="white" fill-opacity="0.4"/>
            </svg>`,

            // PIN/OTP icon
            pin: `<svg viewBox="0 0 24 24" fill="none">
                <defs>
                    <linearGradient id="pinGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" style="stop-color:#F59E0B"/>
                        <stop offset="100%" style="stop-color:#D97706"/>
                    </linearGradient>
                </defs>
                <rect x="3" y="11" width="18" height="11" rx="3" fill="url(#pinGrad)"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4" stroke="url(#pinGrad)" stroke-width="2.5" stroke-linecap="round"/>
                <circle cx="12" cy="16" r="1.5" fill="white"/>
            </svg>`,

            // User/Name icon (for first name, last name, full name)
            user: `<svg viewBox="0 0 24 24" fill="none">
                <defs>
                    <linearGradient id="userGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" style="stop-color:#8B5CF6"/>
                        <stop offset="100%" style="stop-color:#6D28D9"/>
                    </linearGradient>
                </defs>
                <circle cx="12" cy="8" r="5" fill="url(#userGrad)"/>
                <path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8" fill="url(#userGrad)"/>
            </svg>`,
        };

        return icons[type] || icons.magic;
    }

    /**
     * Get menu HTML
     */
    private getMenuHTML(): string {
        return `
      <div class="menu-item" data-action="generate-email">
        <span class="menu-icon">📧</span>
        <span class="menu-text">Generate Email</span>
      </div>
      <div class="menu-item" data-action="generate-password">
        <span class="menu-icon">🔐</span>
        <span class="menu-text">Generate Password</span>
      </div>
      <div class="menu-item" data-action="paste-otp">
        <span class="menu-icon">🔢</span>
        <span class="menu-text">Paste OTP</span>
      </div>
      <div class="menu-item" data-action="autofill">
        <span class="menu-icon">✨</span>
        <span class="menu-text">Auto-Fill Form</span>
      </div>
      <div class="menu-divider"></div>
      <div class="menu-item" data-action="settings">
        <span class="menu-icon">⚙️</span>
        <span class="menu-text">Settings</span>
      </div>
    `;
    }

    /**
     * Get component styles - PREMIUM POPUP-MATCHING DESIGN
     */
    private getStyles(): string {
        return `
      :host {
        all: initial;
        font-family: "Inter", -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif;
        
        /* Brand Colors - Matching Popup */
        --brand-primary: #6366f1;
        --brand-secondary: #8b5cf6;
        --brand-accent: #06b6d4;
        --brand-gradient: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
        
        /* Premium Glass - Light Mode */
        --glass-bg: rgba(255, 255, 255, 0.92);
        --glass-bg-hover: rgba(255, 255, 255, 0.98);
        --glass-border: rgba(255, 255, 255, 0.6);
        --glass-blur: blur(24px) saturate(180%);
        
        /* Text Colors */
        --text-primary: #0f172a;
        --text-secondary: #475569;
        
        /* Premium Multi-Layer Shadows */
        --shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.04), 0 4px 16px rgba(0, 0, 0, 0.06);
        --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.05), 0 8px 32px rgba(0, 0, 0, 0.08);
        --shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.08), 0 16px 48px rgba(0, 0, 0, 0.12);
        --shadow-brand: 0 4px 20px rgba(99, 102, 241, 0.35), 0 8px 32px rgba(99, 102, 241, 0.2);
        
        /* Transitions */
        --ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
        --spring: cubic-bezier(0.175, 0.885, 0.32, 1.275);
      }

      * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }

      /* ═══════════════════════════════════════════════════════════════════
         💎 PREMIUM FLOATING ACTION BUTTON - Popup Style
         ═══════════════════════════════════════════════════════════════════ */
      .fab-button {
        width: 40px;
        height: 40px;
        border-radius: 12px;
        
        /* Premium Glass Card Effect - Matching Popup */
        background: linear-gradient(135deg, 
            rgba(255, 255, 255, 0.95) 0%, 
            rgba(248, 250, 252, 0.90) 100%);
        backdrop-filter: var(--glass-blur);
        -webkit-backdrop-filter: var(--glass-blur);
        
        /* Premium Multi-Layer Border */
        border: 1px solid rgba(255, 255, 255, 0.8);
        
        /* Premium Multi-Layer Shadow */
        box-shadow: 
            0 4px 6px rgba(0, 0, 0, 0.02),
            0 12px 24px rgba(0, 0, 0, 0.04),
            0 24px 48px rgba(0, 0, 0, 0.06),
            inset 0 1px 0 rgba(255, 255, 255, 0.9);

        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        
        transition: all 0.3s var(--ease-out-expo);
        outline: none;
        position: relative;
        overflow: hidden;
        z-index: 1000;
      }

      /* Inner Top Shine - 3D Effect */
      .fab-button::before {
        content: "";
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 50%;
        border-radius: inherit;
        background: linear-gradient(180deg,
            rgba(255, 255, 255, 0.6) 0%,
            rgba(255, 255, 255, 0.2) 40%,
            transparent 100%);
        pointer-events: none;
        opacity: 0.8;
      }

      /* Edge Highlight Border Glow */
      .fab-button::after {
        content: "";
        position: absolute;
        inset: 0;
        border-radius: inherit;
        padding: 1px;
        background: linear-gradient(135deg,
            rgba(255, 255, 255, 0.7) 0%,
            rgba(255, 255, 255, 0.2) 50%,
            rgba(255, 255, 255, 0.4) 100%);
        -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
        mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
        -webkit-mask-composite: xor;
        mask-composite: exclude;
        pointer-events: none;
      }

      /* Hover State - Lift with Brand Glow */
      .fab-button:hover {
        transform: translateY(-4px) scale(1.05);
        box-shadow: 
            0 8px 16px rgba(0, 0, 0, 0.04),
            0 16px 32px rgba(0, 0, 0, 0.06),
            0 32px 64px rgba(0, 0, 0, 0.08),
            0 8px 32px rgba(99, 102, 241, 0.2),
            inset 0 1px 0 rgba(255, 255, 255, 1);
        border-color: rgba(99, 102, 241, 0.2);
      }

      /* Active/Pressed State */
      .fab-button:active {
        transform: translateY(1px) scale(0.96);
        transition: all 0.1s ease;
        box-shadow: 
            0 2px 4px rgba(0, 0, 0, 0.04),
            0 4px 8px rgba(0, 0, 0, 0.06),
            inset 0 1px 0 rgba(255, 255, 255, 0.6);
      }

      /* Subtle Idle Animation */
      @keyframes gentlePulse {
        0%, 100% { 
          box-shadow: 
            0 4px 6px rgba(0, 0, 0, 0.02),
            0 12px 24px rgba(0, 0, 0, 0.04),
            0 24px 48px rgba(0, 0, 0, 0.06),
            inset 0 1px 0 rgba(255, 255, 255, 0.9);
        }
        50% { 
          box-shadow: 
            0 6px 12px rgba(0, 0, 0, 0.03),
            0 16px 32px rgba(0, 0, 0, 0.05),
            0 28px 56px rgba(0, 0, 0, 0.07),
            0 0 24px rgba(99, 102, 241, 0.1),
            inset 0 1px 0 rgba(255, 255, 255, 0.9);
        }
      }
      
      .fab-button:not(:hover):not(:active) {
        animation: gentlePulse 3s infinite ease-in-out;
      }

      /* Loading state */
      .fab-button.loading {
        cursor: wait;
        animation: none;
      }

      .spinner {
        width: 18px;
        height: 18px;
        border: 2.5px solid rgba(99, 102, 241, 0.15);
        border-radius: 50%;
        border-top-color: var(--brand-primary);
        animation: spin 0.7s cubic-bezier(0.4, 0, 0.2, 1) infinite;
      }

      @keyframes spin {
        to { transform: rotate(360deg); }
      }

      /* Icon styling */
      .fab-button svg {
        width: 24px;
        height: 24px;
        position: relative;
        z-index: 1;
        filter: drop-shadow(0 2px 4px rgba(99, 102, 241, 0.15));
        transition: transform 0.3s var(--spring);
      }

      .fab-button:hover svg {
        transform: scale(1.08) rotate(3deg);
      }

      /* ═══════════════════════════════════════════════════════════════════
         📋 PREMIUM DROPDOWN MENU - Popup Style
         ═══════════════════════════════════════════════════════════════════ */
      .fab-menu {
        position: absolute;
        top: 50px;
        right: 0;
        min-width: 220px;
        
        /* Premium Glass Card */
        background: linear-gradient(135deg,
            rgba(255, 255, 255, 0.96) 0%,
            rgba(248, 250, 252, 0.94) 100%);
        backdrop-filter: blur(32px) saturate(200%);
        -webkit-backdrop-filter: blur(32px) saturate(200%);
        
        border-radius: 16px;
        border: 1px solid rgba(255, 255, 255, 0.7);
        box-shadow: 
            0 8px 16px rgba(0, 0, 0, 0.04),
            0 16px 48px rgba(0, 0, 0, 0.08),
            0 32px 80px rgba(0, 0, 0, 0.12),
            inset 0 1px 0 rgba(255, 255, 255, 0.8);
        padding: 8px;
        
        opacity: 0;
        visibility: hidden;
        transform: translateY(-8px) scale(0.96);
        transform-origin: top right;
        transition: all 0.25s var(--spring);
        z-index: 999;
      }

      .fab-menu.open {
        opacity: 1;
        visibility: visible;
        transform: translateY(0) scale(1);
      }

      .menu-item {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 14px;
        cursor: pointer;
        border-radius: 10px;
        transition: all 0.2s var(--ease-out-expo);
        font-size: 14px;
        font-weight: 500;
        color: var(--text-primary);
        position: relative;
        overflow: hidden;
      }

      /* Hover gradient overlay */
      .menu-item::before {
        content: '';
        position: absolute;
        inset: 0;
        background: linear-gradient(90deg, 
            rgba(99, 102, 241, 0.06) 0%,
            rgba(99, 102, 241, 0.02) 100%);
        opacity: 0;
        transition: 0.2s ease;
        border-radius: inherit;
      }

      .menu-item:hover {
        background: rgba(248, 250, 252, 0.8);
        transform: translateX(4px);
      }
      
      .menu-item:hover::before {
        opacity: 1;
      }

      .menu-item:active {
        transform: scale(0.98) translateX(4px);
        background: rgba(241, 245, 249, 1);
      }

      .menu-icon {
        font-size: 18px;
        display: flex;
        align-items: center;
        justify-content: center;
        filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.08));
      }

      .menu-text {
        flex: 1;
        position: relative;
        z-index: 1;
      }

      .menu-divider {
        height: 1px;
        background: linear-gradient(90deg, 
            transparent 0%,
            rgba(0, 0, 0, 0.06) 50%,
            transparent 100%);
        margin: 6px 8px;
      }

      /* ═══════════════════════════════════════════════════════════════════
         🌙 DARK MODE - Premium Deep Theme
         ═══════════════════════════════════════════════════════════════════ */
      @media (prefers-color-scheme: dark) {
        :host {
          --glass-bg: rgba(21, 29, 48, 0.95);
          --glass-bg-hover: rgba(26, 36, 56, 0.98);
          --glass-border: rgba(255, 255, 255, 0.1);
          --text-primary: #f1f5f9;
          --text-secondary: #94a3b8;
          --brand-primary: #818cf8;
        }
        
        .fab-button {
          background: linear-gradient(135deg, 
              rgba(26, 36, 56, 0.95) 0%, 
              rgba(15, 23, 42, 0.92) 100%);
          border-color: rgba(255, 255, 255, 0.1);
          box-shadow: 
              0 4px 12px rgba(0, 0, 0, 0.25),
              0 12px 32px rgba(0, 0, 0, 0.35),
              inset 0 1px 0 rgba(255, 255, 255, 0.08);
        }

        .fab-button::before {
          background: linear-gradient(180deg,
              rgba(255, 255, 255, 0.08) 0%,
              rgba(255, 255, 255, 0.02) 40%,
              transparent 100%);
        }
        
        .fab-button:hover {
          background: linear-gradient(135deg,
              rgba(30, 41, 59, 0.98) 0%,
              rgba(20, 30, 48, 0.95) 100%);
          box-shadow: 
              0 12px 24px rgba(0, 0, 0, 0.4),
              0 24px 48px rgba(0, 0, 0, 0.35),
              0 0 40px rgba(129, 140, 248, 0.2),
              inset 0 1px 0 rgba(255, 255, 255, 0.1);
          border-color: rgba(129, 140, 248, 0.3);
        }

        @keyframes gentlePulse {
          0%, 100% { 
            box-shadow: 
              0 4px 12px rgba(0, 0, 0, 0.25),
              0 12px 32px rgba(0, 0, 0, 0.35),
              inset 0 1px 0 rgba(255, 255, 255, 0.08);
          }
          50% { 
            box-shadow: 
              0 6px 16px rgba(0, 0, 0, 0.3),
              0 16px 40px rgba(0, 0, 0, 0.4),
              0 0 32px rgba(129, 140, 248, 0.15),
              inset 0 1px 0 rgba(255, 255, 255, 0.08);
          }
        }

        .fab-menu {
          background: linear-gradient(135deg,
              rgba(26, 36, 56, 0.98) 0%,
              rgba(15, 23, 42, 0.95) 100%);
          border-color: rgba(255, 255, 255, 0.08);
          box-shadow: 
              0 12px 32px rgba(0, 0, 0, 0.4),
              0 32px 80px rgba(0, 0, 0, 0.5),
              inset 0 1px 0 rgba(255, 255, 255, 0.06);
        }

        .menu-item {
          color: var(--text-primary);
        }

        .menu-item::before {
          background: linear-gradient(90deg,
              rgba(129, 140, 248, 0.1) 0%,
              rgba(129, 140, 248, 0.03) 100%);
        }

        .menu-item:hover {
          background: rgba(51, 65, 85, 0.5);
        }

        .menu-item:active {
          background: rgba(71, 85, 105, 0.6);
        }

        .menu-divider {
          background: linear-gradient(90deg,
              transparent 0%,
              rgba(255, 255, 255, 0.08) 50%,
              transparent 100%);
        }
      }
    `;
    }

    /**
     * Show inline toast notification (no alert)
     */
    private showInlineToast(message: string, type: 'success' | 'error' = 'error'): void {
        if (!this.shadowRoot) return;

        // Remove existing toast
        const existing = this.shadowRoot.querySelector('.inline-toast');
        if (existing) existing.remove();

        // Create toast
        const toast = document.createElement('div');
        toast.className = `inline-toast ${type}`;
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%) translateY(20px);
            padding: 12px 24px;
            background: ${type === 'error' ? 'rgba(50, 50, 50, 0.95)' : 'rgba(52, 199, 89, 0.95)'};
            color: white;
            font-size: 13px;
            font-weight: 600;
            font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif;
            border-radius: 12px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.2);
            z-index: 2147483647;
            opacity: 0;
            transition: all 0.3s cubic-bezier(0.23, 1, 0.32, 1);
        `;
        this.shadowRoot.appendChild(toast);

        // Animate in
        requestAnimationFrame(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateX(-50%) translateY(0)';
        });

        // Auto remove after 3s
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(-50%) translateY(20px)';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    /**
     * Toggle menu visibility
     */
    toggleMenu(): void {
        if (this.isMenuOpen) {
            this.closeMenu();
        } else {
            this.openMenu();
        }
    }

    /**
     * Open menu
     */
    openMenu(): void {
        if (!this.menu) return;
        this.menu.classList.add('open');
        this.isMenuOpen = true;
        this.cancelHide();
    }

    /**
     * Close menu
     */
    closeMenu(): void {
        if (!this.menu) return;
        this.menu.classList.remove('open');
        this.isMenuOpen = false;
        this.scheduleHide();
    }

    /**
     * Handle menu action
     */
    private async handleMenuAction(action: string): Promise<void> {
        this.closeMenu();

        switch (action) {
            case 'generate-email': {
                try {
                    this.setLoading(true);
                    this.showInlineToast('Generating email...', 'success'); // Feedback
                    const emailResponse = await safeSendMessage({ action: 'GENERATE_EMAIL' }) as GenerateEmailResponse;
                    this.setLoading(false);

                    if (!emailResponse) {
                        this.showInlineToast('Please reload the page to use GhostFill.', 'error');
                        return;
                    }

                    if (emailResponse.success && emailResponse.email?.fullEmail && this.currentField) {
                        this.fillCurrentField(emailResponse.email.fullEmail);
                        this.showInlineToast('Email filled!', 'success');
                    } else if (emailResponse.error) {
                        console.error('Email generation failed:', emailResponse.error);
                        this.showInlineToast(`Failed: ${emailResponse.error}`, 'error');
                    }
                } catch (e) {
                    this.setLoading(false);
                    console.error(e);
                    this.showInlineToast('Failed to generate email', 'error');
                }
                break;
            }

            case 'generate-password': {
                this.setLoading(true);
                const pwdResponse = await safeSendMessage({ action: 'GENERATE_PASSWORD' }) as GeneratePasswordResponse;
                this.setLoading(false);

                if (pwdResponse?.result?.password && this.currentField) {
                    this.fillCurrentField(pwdResponse.result.password);
                    this.showInlineToast('Password filled!', 'success');
                } else {
                    this.showInlineToast('Failed to generate password', 'error');
                }
                break;
            }

            case 'paste-otp': {
                this.setLoading(true);
                const otpResponse = await safeSendMessage({ action: 'GET_LAST_OTP' }) as GetLastOTPResponse;
                this.setLoading(false);

                if (otpResponse?.lastOTP?.code && this.currentField) {
                    this.fillCurrentField(otpResponse.lastOTP.code);
                    this.showInlineToast(`OTP ${otpResponse.lastOTP.code} filled!`, 'success');
                } else {
                    this.showInlineToast('No OTP available', 'error');
                }
                break;
            }

            case 'autofill':
                // Show immediate feedback to prevent rage-clicks
                this.setLoading(true);
                this.showInlineToast('Analyzing form...', 'success');

                await safeSendMessage({ action: 'SMART_AUTOFILL' });

                // Simulate delay if response is too fast for UX
                setTimeout(() => {
                    this.setLoading(false);
                    this.showInlineToast('Form auto-filled!', 'success');
                }, 800);
                break;

            case 'settings':
                safeSendMessage({ action: 'OPEN_OPTIONS' });
                break;
        }

        this.hide();
    }

    /**
     * Fill current field
     */
    private fillCurrentField(value: string): void {
        if (!this.currentField) return;

        const input = this.currentField as HTMLInputElement | HTMLTextAreaElement;

        // Use native setter for React compatibility
        const setter = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            'value'
        )?.set;

        if (setter) {
            setter.call(input, value);
        } else {
            input.value = value;
        }

        // Trigger events
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    /**
     * Show button
     */
    show(): void {
        if (this.container) {
            this.container.style.display = 'block';
        }
    }

    /**
     * Hide button
     */
    hide(): void {
        if (this.container) {
            this.container.style.display = 'none';
        }
        this.closeMenu();
        this.currentField = null;
    }

    /**
     * Check if visible
     */
    isVisible(): boolean {
        return this.container?.style.display === 'block';
    }

    /**
     * Schedule hide after timeout
     */
    private scheduleHide(): void {
        if (this.isMenuOpen) return;

        this.cancelHide();
        this.hideTimeout = setTimeout(() => {
            this.hide();
        }, TIMING.FLOATING_BUTTON_HIDE_MS);
    }

    /**
     * Cancel scheduled hide
     */
    private cancelHide(): void {
        if (this.hideTimeout) {
            clearTimeout(this.hideTimeout);
            this.hideTimeout = null;
        }
    }

    /**
     * Check if element is an input
     */
    private isInputElement(element: HTMLElement): boolean {
        return (
            element instanceof HTMLInputElement ||
            element instanceof HTMLTextAreaElement
        );
    }

    /**
     * Destroy button
     */
    destroy(): void {
        this.cancelHide();
        this.container?.remove();
        this.container = null;
        this.shadowRoot = null;
        this.button = null;
        this.menu = null;
    }
}
