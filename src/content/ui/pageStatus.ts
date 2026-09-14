// Page Status Injector - Injects status banners directly into webpages
// Solves the "disconnect" problem by showing extension status on the page itself

import { generateHostTokens } from '../../shared/theme';
import { createLogger } from '../../utils/logger';
import { setHTML } from '../../utils/sanitization.core';

const log = createLogger('PageStatus');

class PageStatusInjector {
  private container: HTMLDivElement | null = null;
  private shadowRoot: ShadowRoot | null = null;
  private statusText: HTMLSpanElement | null = null;
  private isVisible: boolean = false;

  /**
   * Check if the extension context is still valid (not invalidated by navigation)
   * M8: Guard all DOM operations against a torn-down context
   */
  private isContextValid(): boolean {
    try {
      // chrome.runtime.id is undefined when the context has been invalidated
      return (
        typeof chrome !== 'undefined' &&
        typeof chrome.runtime !== 'undefined' &&
        !!chrome.runtime.id &&
        typeof document !== 'undefined' &&
        document.body !== null
      );
    } catch {
      return false;
    }
  }

  /**
   * Initialize the status injector
   */
  init(): void {
    if (this.container) {
      return;
    }
    // M8: Skip if context is invalid (e.g. page is being torn down)
    if (!this.isContextValid()) {
      return;
    }

    // Create container with Shadow DOM for style isolation
    this.container = document.createElement('div');
    this.container.id = 'ghostfill-status-container';
    this.shadowRoot = this.container.attachShadow({ mode: 'closed' });

    const STYLES = `
            :host {
                all: initial;
                ${generateHostTokens()}
                font-family: "Space Grotesk", -apple-system, BlinkMacSystemFont, sans-serif;
                position: fixed;
                top: 0;
                right: 0;
                z-index: 2147483645;
                isolation: isolate;
                pointer-events: none;
                color-scheme: light dark;
            }

            .status-banner {
                position: fixed;
                top: 16px;
                right: 16px;
                z-index: 2147483645;
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 12px 18px;
                background: var(--gf-card, #181B21); /* SOLID SURFACE */
                border: 1px solid var(--gf-line-2, rgba(255,255,255,0.10)); /* HAIRLINE */
                border-radius: 12px;
                box-shadow: 0 8px 24px rgba(0, 0, 0, 0.55), inset 0 1px 0 var(--gf-hi, rgba(255,255,255,0.06)); /* SPECTRE LIFT */
                transform: translateX(120%);
                opacity: 0;
                transition: transform 0.24s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.24s cubic-bezier(0.16, 1, 0.3, 1);
                pointer-events: auto;
                font-family: "Space Grotesk", sans-serif;
            }

            .status-banner.visible {
                transform: translateX(0);
                opacity: 1;
            }

            .status-banner.success {
                border-color: var(--gf-mint, #34D399);
            }

            .status-banner.error {
                border-color: var(--gf-coral, #F87171);
            }

            .ghost-icon {
                width: 22px;
                height: 22px;
                display: grid;
                place-items: center;
                color: var(--gf-primary, #818CF8);
                flex: none;
            }

            .ghost-icon svg {
                width: 100%;
                height: 100%;
                display: block;
            }

            .spinner {
                width: 18px;
                height: 18px;
                border: 2px solid rgba(255, 255, 255, 0.3);
                border-top-color: white;
                border-radius: 50%;
                animation: spin 0.8s linear infinite;
            }

            @keyframes spin {
                to { transform: rotate(360deg); }
            }

            .status-text {
                color: var(--gf-ink, #EEF1F6);
                font-size: 13px;
                font-weight: 600;
                letter-spacing: 0.02em;
            }

            .close-btn {
                background: transparent;
                border: 1px solid var(--gf-line-2, rgba(255,255,255,0.10));
                border-radius: 6px;
                width: 28px;
                height: 28px;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                color: var(--gf-cream, #FFF3D6);
                font-size: 10px;
                margin-left: 4px;
                font-weight: bold;
                transition: background 0.14s ease, border-color 0.14s ease, transform 0.14s ease;
            }

            .close-btn:hover {
                background: var(--gf-sunken, #0C0E12);
            }

            .close-btn:focus-visible {
                outline: 2px solid var(--gf-primary, #818CF8);
                outline-offset: 2px;
            }

            @media (prefers-reduced-motion: reduce) {
                .ghost-icon, .spinner {
                    animation: none !important;
                }
                .status-banner {
                    transition: none !important;
                }
            }
        `;

    // Create banner HTML
    const banner = document.createElement('div');
    banner.className = 'status-banner';
    banner.setAttribute('role', 'status');
    banner.setAttribute('aria-live', 'polite');
    banner.setAttribute('aria-atomic', 'true');
    setHTML(
      banner,
      `
            <span class="ghost-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M5 18.5V10.8C5 7.04 8.13 4 12 4s7 3.04 7 6.8v7.7l-2.15-1.5-2.15 1.5-2.2-1.5-2.2 1.5-2.15-1.5L5 18.5Z" fill="currentColor" fill-opacity=".16" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
                <path d="M9 11h.01M15 11h.01" stroke="currentColor" stroke-width="2.25" stroke-linecap="round"/>
                <path d="M9 14.5c.9.72 2.1 1.08 3 1.08s2.1-.36 3-1.08" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"/>
              </svg>
            </span>
            <div class="spinner"></div>
            <span class="status-text">GhostFill Active</span>
            <button class="close-btn" aria-label="Dismiss">✕</button>
        `
    );

    const supportsConstructedStyles =
      typeof CSSStyleSheet !== 'undefined' && 'replaceSync' in CSSStyleSheet.prototype;

    if (supportsConstructedStyles) {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(STYLES);
      this.shadowRoot.adoptedStyleSheets = [sheet];
    } else {
      const style = document.createElement('style');
      style.textContent = STYLES;
      this.shadowRoot.appendChild(style);
    }

    this.shadowRoot.appendChild(banner);
    document.body.appendChild(this.container);

    // Store references
    this.statusText = this.shadowRoot.querySelector('.status-text');

    // Close button handler
    const closeBtn = this.shadowRoot.querySelector('.close-btn');
    closeBtn?.addEventListener('click', () => this.hide());

    log.debug('Page status injector initialized');
  }

  /**
   * Show status with message
   */
  show(message: string, type: 'loading' | 'success' | 'error' = 'loading'): void {
    // M8: Guard against showing in an invalidated context
    if (!this.isContextValid()) {
      return;
    }
    this.init();
    if (!this.shadowRoot) {
      return;
    }

    const banner = this.shadowRoot.querySelector('.status-banner');
    const spinner = this.shadowRoot.querySelector('.spinner') as HTMLElement;

    if (banner) {
      banner.classList.remove('success', 'error');
      if (type === 'success') {
        banner.classList.add('success');
      }
      if (type === 'error') {
        banner.classList.add('error');
      }
      banner.classList.add('visible');
    }

    if (spinner) {
      spinner.style.display = type === 'loading' ? 'block' : 'none';
    }

    if (this.statusText) {
      this.statusText.textContent = message;
    }

    this.isVisible = true;
    log.debug('Status shown', { message, type });
  }

  /**
   * Update status text
   */
  update(message: string): void {
    if (this.statusText) {
      this.statusText.textContent = message;
    }
  }

  /**
   * Show success and auto-hide
   */
  success(message: string, autoHideMs: number = 3000): void {
    this.show(message, 'success');
    setTimeout(() => this.hide(), autoHideMs);
  }

  /**
   * Show info message and auto-hide
   */
  info(message: string, autoHideMs: number = 4000): void {
    this.show(message, 'loading');
    setTimeout(() => this.hide(), autoHideMs);
  }

  /**
   * Show error
   */
  error(message: string, autoHideMs: number = 5000): void {
    this.show(message, 'error');
    setTimeout(() => this.hide(), autoHideMs);
  }

  /**
   * Hide the status banner
   */
  hide(): void {
    if (!this.shadowRoot) {
      return;
    }

    const banner = this.shadowRoot.querySelector('.status-banner');
    if (banner) {
      banner.classList.remove('visible');
    }

    this.isVisible = false;
  }

  /**
   * Check if visible
   */
  getIsVisible(): boolean {
    return this.isVisible;
  }
}

export const pageStatus = new PageStatusInjector();
