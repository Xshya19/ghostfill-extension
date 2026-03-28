// Page Status Injector - Injects status banners directly into webpages
// Solves the "disconnect" problem by showing extension status on the page itself

import { createLogger } from '../utils/logger';
import { setHTML } from '../utils/setHTML';

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
      return typeof chrome !== 'undefined' &&
        typeof chrome.runtime !== 'undefined' &&
        !!chrome.runtime.id &&
        typeof document !== 'undefined' &&
        document.body != null;
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
                font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Inter', sans-serif;
            }

            .status-banner {
                position: fixed;
                top: 16px;
                right: 16px;
                z-index: 2147483647;
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 12px 18px;
                background: linear-gradient(135deg, rgba(99, 102, 241, 0.95), rgba(139, 92, 246, 0.95));
                backdrop-filter: blur(20px);
                -webkit-backdrop-filter: blur(20px);
                border: 1px solid rgba(255, 255, 255, 0.2);
                border-radius: 14px;
                box-shadow: 
                    0 8px 32px rgba(99, 102, 241, 0.3),
                    0 4px 16px rgba(0, 0, 0, 0.15),
                    inset 0 1px 0 rgba(255, 255, 255, 0.2);
                transform: translateX(120%);
                transition: transform 0.4s cubic-bezier(0.23, 1, 0.32, 1);
                pointer-events: auto;
            }

            .status-banner.visible {
                transform: translateX(0);
            }

            .status-banner.success {
                background: linear-gradient(135deg, rgba(34, 197, 94, 0.95), rgba(16, 185, 129, 0.95));
                box-shadow: 0 8px 32px rgba(34, 197, 94, 0.3), 0 4px 16px rgba(0, 0, 0, 0.15);
            }

            .status-banner.error {
                background: linear-gradient(135deg, rgba(30, 30, 30, 0.95), rgba(40, 40, 40, 0.95));
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2), 0 4px 16px rgba(0, 0, 0, 0.15);
                border-left: 3px solid #ff453a;
            }

            .ghost-icon {
                font-size: 20px;
                animation: float 2s ease-in-out infinite;
            }

            @keyframes float {
                0%, 100% { transform: translateY(0); }
                50% { transform: translateY(-3px); }
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
                color: white;
                font-size: 13px;
                font-weight: 600;
                letter-spacing: -0.01em;
                white-space: nowrap;
            }

            .close-btn {
                background: rgba(255, 255, 255, 0.2);
                border: none;
                border-radius: 50%;
                width: 20px;
                height: 20px;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                color: white;
                font-size: 12px;
                margin-left: 4px;
                transition: background 0.2s;
            }

            .close-btn:hover {
                background: rgba(255, 255, 255, 0.3);
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
    setHTML(
      banner,
      `
            <span class="ghost-icon">👻</span>
            <div class="spinner"></div>
            <span class="status-text">GhostFill Active</span>
            <button class="close-btn">✕</button>
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
    this.show(message, 'loading'); // Use default purple gradient for info
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
