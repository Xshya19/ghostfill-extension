// One in-page feedback surface for form filling, OTPs, and activation links.
import { generateHostThemeStyles, initTheme } from '../../shared/theme';
import { setHTML } from '../../utils/sanitization.core';

const STYLES = `
  ${generateHostThemeStyles()}
  :host {
    all: initial;
    position: fixed;
    top: 16px;
    right: 16px;
    max-width: min(360px, calc(100vw - 32px));
    z-index: 2147483646;
    isolation: isolate;
    pointer-events: none;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  }
  *, *::before, *::after { box-sizing: border-box; }
  .status-banner {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 64px;
    padding: 8px 8px 8px 16px;
    color: var(--gf-ink);
    background: var(--gf-glass-solid);
    border: 1px solid var(--gf-glass-stroke);
    border-radius: 20px;
    box-shadow: var(--gf-glass-shadow), var(--gf-glass-inner);
    opacity: 0;
    visibility: hidden;
    transform: translateY(-6px);
    transition: opacity 180ms ease-out, transform 180ms cubic-bezier(0.16, 1, 0.3, 1), visibility 180ms;
    pointer-events: auto;
  }
  .status-banner.visible { opacity: 1; visibility: visible; transform: translateY(0); }
  .status-icon, .spinner { width: 18px; height: 18px; flex: 0 0 auto; color: var(--gf-primary); }
  .status-banner.success .status-icon { color: var(--gf-mint-text); }
  .status-banner.error .status-icon { color: var(--gf-coral-text); }
  .status-symbol { display: none; }
  .status-banner.info .status-info,
  .status-banner.success .status-success,
  .status-banner.error .status-error { display: inline; }
  .spinner {
    display: none;
    border: 1.5px solid var(--gf-glass-stroke);
    border-top-color: var(--gf-primary);
    border-radius: 50%;
    animation: gf-status-spin 0.8s linear infinite;
  }
  .status-banner.loading .spinner { display: block; }
  .status-banner.loading .status-icon { display: none; }
  .status-text { min-width: 0; overflow-wrap: anywhere; font-size: 13px; line-height: 1.45; font-weight: 550; }
  .close-btn {
    display: grid;
    place-items: center;
    flex: 0 0 44px;
    width: 44px;
    height: 44px;
    padding: 0;
    border: 0;
    border-radius: 12px;
    background: transparent;
    color: var(--gf-ink-soft);
    cursor: pointer;
  }
  .close-btn:hover { background: var(--gf-glass-control); color: var(--gf-ink); }
  .close-btn:focus-visible { outline: 2px solid var(--gf-primary); outline-offset: -2px; }
  .close-btn svg { width: 16px; height: 16px; }
  .live-region { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  @keyframes gf-status-spin { to { transform: rotate(360deg); } }
  @supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
    .status-banner { background: var(--gf-glass-elevated); -webkit-backdrop-filter: blur(24px) saturate(135%); backdrop-filter: blur(24px) saturate(135%); }
  }
  @media (prefers-reduced-motion: reduce) {
    .status-banner { transition: none; transform: none; }
    .spinner { animation-duration: 1.6s; }
  }
  @media (prefers-reduced-transparency: reduce), (prefers-contrast: more) {
    .status-banner { background: var(--gf-glass-solid); border-color: var(--gf-line-2); -webkit-backdrop-filter: none; backdrop-filter: none; }
  }
`;
let sharedStyleSheet: CSSStyleSheet | null = null;

class PageStatusInjector {
  private container: HTMLDivElement | null = null;
  private banner: HTMLDivElement | null = null;
  private statusText: HTMLSpanElement | null = null;
  private liveRegion: HTMLSpanElement | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private remainingMs = 0;
  private hideDeadline = 0;
  private hovered = false;
  private focused = false;
  private announcementFrame: number | null = null;
  private unsubscribeTheme: (() => void) | null = null;

  init(): void {
    if (this.container?.isConnected || !document.body) {
      return;
    }
    try {
      if (!chrome.runtime?.id) {
        return;
      }
    } catch {
      return;
    }
    this.destroy();
    this.container = document.createElement('div');
    this.container.id = 'ghostfill-status-container';
    const shadow = this.container.attachShadow({ mode: 'closed' });
    this.banner = document.createElement('div');
    this.banner.className = 'status-banner';
    setHTML(
      this.banner,
      `
      <svg class="status-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9"/>
        <path class="status-symbol status-info" d="M12 11v5M12 7h.01"/>
        <path class="status-symbol status-success" d="m8 12 2.5 2.5 5.5-5.5"/>
        <path class="status-symbol status-error" d="M12 7v6M12 17h.01"/>
      </svg>
      <span class="spinner" aria-hidden="true"></span>
      <span class="status-text" aria-hidden="true"></span>
      <button type="button" class="close-btn" aria-label="Dismiss GhostFill notification">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m18 6-12 12M6 6l12 12" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
      </button>
    `
    );
    this.statusText = this.banner.querySelector('.status-text');
    this.banner.querySelector('button')?.addEventListener('click', () => this.hide());
    this.banner.addEventListener('pointerenter', (event) => {
      if (event.pointerType === 'mouse' || event.pointerType === 'pen') {
        this.hovered = true;
        this.syncHideTimer();
      }
    });
    this.banner.addEventListener('pointerleave', (event) => {
      if (event.pointerType === 'mouse' || event.pointerType === 'pen') {
        this.hovered = false;
        this.syncHideTimer();
      }
    });
    this.banner.addEventListener('focusin', () => {
      this.focused = true;
      this.syncHideTimer();
    });
    this.banner.addEventListener('focusout', (event) => {
      this.focused =
        event.relatedTarget instanceof Node && !!this.banner?.contains(event.relatedTarget);
      this.syncHideTimer();
    });
    this.liveRegion = document.createElement('span');
    this.liveRegion.className = 'live-region';
    this.liveRegion.setAttribute('role', 'status');
    this.liveRegion.setAttribute('aria-live', 'polite');
    this.liveRegion.setAttribute('aria-atomic', 'true');
    if (typeof CSSStyleSheet !== 'undefined' && 'replaceSync' in CSSStyleSheet.prototype) {
      if (!sharedStyleSheet) {
        sharedStyleSheet = new CSSStyleSheet();
        sharedStyleSheet.replaceSync(STYLES);
      }
      shadow.adoptedStyleSheets = [sharedStyleSheet];
    } else {
      const style = document.createElement('style');
      style.textContent = STYLES;
      shadow.appendChild(style);
    }
    shadow.append(this.banner, this.liveRegion);
    document.body.appendChild(this.container);
    this.unsubscribeTheme = initTheme(this.container);
    document.addEventListener('visibilitychange', this.syncHideTimer);
    window.addEventListener('pagehide', this.destroy, { once: true });
  }

  show(
    message: string,
    type: 'loading' | 'success' | 'error' | 'info' = 'loading',
    autoHideMs = 0
  ): void {
    this.init();
    if (!this.banner || !this.statusText) {
      return;
    }
    this.cancelPending();
    this.banner.className = `status-banner visible ${type}`;
    this.update(message);
    if (autoHideMs > 0) {
      this.remainingMs = Math.max(3000, autoHideMs, Math.min(8000, message.length * 55));
      this.syncHideTimer();
    }
  }

  update(message: string): void {
    if (!this.statusText) {
      return;
    }
    this.statusText.textContent = message;
    if (this.announcementFrame !== null) {
      cancelAnimationFrame(this.announcementFrame);
    }
    // Announce after the persistent region has entered the accessibility tree.
    this.announcementFrame = requestAnimationFrame(() => {
      this.announcementFrame = null;
      this.liveRegion?.replaceChildren(document.createTextNode(message));
    });
  }

  success(message: string, autoHideMs = 3500): void {
    this.show(message, 'success', autoHideMs);
  }
  info(message: string, autoHideMs = 4000): void {
    this.show(message, 'info', autoHideMs);
  }
  error(message: string, autoHideMs = 5000): void {
    this.show(message, 'error', autoHideMs);
  }

  hide(): void {
    this.cancelPending();
    this.banner?.classList.remove('visible');
    this.liveRegion?.replaceChildren();
  }

  getIsVisible(): boolean {
    return this.banner?.classList.contains('visible') ?? false;
  }

  // Only count reading time while the page is visible and feedback is not being used.
  private syncHideTimer = (): void => {
    if (this.hideTimer !== null) {
      this.remainingMs = Math.max(1, this.hideDeadline - performance.now());
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
    if (
      this.remainingMs > 0 &&
      this.getIsVisible() &&
      !document.hidden &&
      !this.hovered &&
      !this.focused
    ) {
      this.hideDeadline = performance.now() + this.remainingMs;
      this.hideTimer = setTimeout(() => this.hide(), this.remainingMs);
    }
  };

  private cancelPending(): void {
    if (this.hideTimer !== null) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
    this.remainingMs = 0;
    if (this.announcementFrame !== null) {
      cancelAnimationFrame(this.announcementFrame);
      this.announcementFrame = null;
    }
  }

  private destroy = (): void => {
    this.cancelPending();
    this.unsubscribeTheme?.();
    this.unsubscribeTheme = null;
    this.container?.remove();
    this.container = null;
    this.banner = null;
    this.statusText = null;
    this.liveRegion = null;
    this.hovered = false;
    this.focused = false;
    document.removeEventListener('visibilitychange', this.syncHideTimer);
    window.removeEventListener('pagehide', this.destroy);
  };
}

export const pageStatus = new PageStatusInjector();
