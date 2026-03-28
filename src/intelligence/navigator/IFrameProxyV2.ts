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
      this.instance.listenForResults((results) => {
        console.log('[Sentinel] IFrame Result:', results);
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
    return keywords.some(k => src.includes(k));
  }

  private sendProbe(iframe: HTMLIFrameElement): void {
    const target = iframe.contentWindow;
    if (!target) {return;}

    let targetOrigin = '*';
    try {
      if (iframe.src) {
        targetOrigin = new URL(iframe.src).origin;
      } else {
        targetOrigin = window.location.origin;
      }
    } catch {
      return; // Skip unsafe/invalid frames
    }

    const message: IFrameMessage = {
      type: 'SENTINEL_PROBE',
      payload: { parentUrl: window.location.href },
      sourceOrigin: window.location.origin
    };

    target.postMessage(message, targetOrigin);
  }

  /**
   * Listen for results from iframes.
   */
  public listenForResults(callback: (results: any) => void): void {
    window.addEventListener('message', (event: MessageEvent) => {
      // Basic origin validation
      const origin = event.origin;
      const isTrusted = origin === window.location.origin || 
        ['stripe.com', 'paypal.com', 'auth0.com', 'google.com', 'apple.com']
          .some(trusted => origin.endsWith(trusted));
          
      if (!isTrusted) {return;}

      const message = event.data as IFrameMessage;
      if (message && message.type === 'SENTINEL_RESULT') {
        callback(message.payload);
      }
    });
  }
}
