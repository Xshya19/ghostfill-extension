/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  IFRAME PROXY V2 — Cross-Origin Sensory Bridge                ║
 * ║  Pierces cross-origin boundaries via postMessage and relay.   ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

interface IFrameMessage {
  type: 'SENTINEL_PROBE' | 'SENTINEL_RESULT' | 'SENTINEL_FILL';
  payload: any;
  sourceOrigin: string;
}

export class IFrameProxyV2 {
  private static instance: IFrameProxyV2;

  public static init(): void {
    if (!this.instance) {
      this.instance = new IFrameProxyV2();
      this.instance.listenForResults(() => {
        // Results are handled internally — no debug logging to avoid leaking cross-frame data
      });
    }
  }

  /**
   * Detect and probe potential auth/payment iframes.
   */
  public probeIframes(): void {
    const iframes = Array.from(document.querySelectorAll('iframe'));

    for (const iframe of iframes) {
      if (this.isLikelyAuthIFrame(iframe)) {
        this.sendProbe(iframe);
      }
    }
  }

  private isLikelyAuthIFrame(iframe: HTMLIFrameElement): boolean {
    const src = iframe.src?.toLowerCase() || '';
    const keywords = ['auth', 'login', 'stripe', 'checkout', 'verify', 'pay'];
    return keywords.some((k) => src.includes(k));
  }

  private sendProbe(iframe: HTMLIFrameElement): void {
    const target = iframe.contentWindow;
    if (!target) {
      return;
    }

    let targetOrigin: string;
    try {
      if (iframe.src) {
        targetOrigin = new URL(iframe.src).origin;
        if (targetOrigin === 'null') {
          return; // Skip sandboxed or data/about iframes where origin is 'null'
        }
      } else {
        targetOrigin = window.location.origin;
      }
    } catch {
      return; // Skip unsafe/invalid frames
    }

    const message: IFrameMessage = {
      type: 'SENTINEL_PROBE',
      payload: {},
      sourceOrigin: window.location.origin,
    };

    target.postMessage(message, targetOrigin);
  }

  /**
   * Listen for results from iframes.
   * SECURITY FIX: Use proper hostname validation against a hardcoded allowlist
   * to prevent spoofing via domains like 'evilstripe.com'.
   * Also removed leaking parent page URL to child iframes.
   */
  public listenForResults(callback: (results: any) => void): void {
    const TRUSTED_ORIGINS: Array<{ hostname: string; allowSubdomains: boolean }> = [
      { hostname: 'stripe.com', allowSubdomains: true },
      { hostname: 'js.stripe.com', allowSubdomains: false },
      { hostname: 'paypal.com', allowSubdomains: true },
      { hostname: 'paypalobjects.com', allowSubdomains: false },
      { hostname: 'auth0.com', allowSubdomains: true },
      { hostname: 'google.com', allowSubdomains: true },
      { hostname: 'apple.com', allowSubdomains: true },
    ];

    window.addEventListener('message', (event: MessageEvent) => {
      const origin = event.origin;

      if (origin === window.location.origin) {
        const message = event.data as IFrameMessage;
        if (message && message.type === 'SENTINEL_RESULT') {
          callback(message.payload);
        }
        return;
      }

      let isTrusted = false;
      try {
        const url = new URL(origin);
        if (url.protocol !== 'https:') {
          return;
        }
        const hostname = url.hostname;

        isTrusted = TRUSTED_ORIGINS.some((trusted) => {
          if (trusted.allowSubdomains) {
            return hostname === trusted.hostname || hostname.endsWith('.' + trusted.hostname);
          }
          return hostname === trusted.hostname;
        });
      } catch {
        return;
      }

      if (!isTrusted) {
        return;
      }

      const message = event.data as IFrameMessage;
      if (message && message.type === 'SENTINEL_RESULT') {
        callback(message.payload);
      }
    });
  }
}
