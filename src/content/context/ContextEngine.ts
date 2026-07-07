import { FieldCandidate, UltraDetector } from '../detection/UltraDetector';
import { createLogger } from '../../utils/logger';

const log = createLogger('ContextEngine');

export class ContextEngine {
  private detector: UltraDetector;
  private candidates: FieldCandidate[] = [];
  private lastChecked = 0;
  private observer: MutationObserver | null = null;
  private callbacks: Array<(candidates: FieldCandidate[]) => void> = [];
  private debounceTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(detector = new UltraDetector()) {
    this.detector = detector;
  }

  async init(): Promise<void> {
    await this.scan();

    // Start MutationObserver for incremental DOM updates
    this.observer = new MutationObserver((mutations) => {
      let shouldRescan = false;
      for (const m of mutations) {
        if (m.addedNodes.length > 0 || m.removedNodes.length > 0) {
          shouldRescan = true;
          break;
        }
      }

      if (shouldRescan) {
        this.triggerDebouncedScan();
      }
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  getCandidates(): FieldCandidate[] {
    return this.candidates;
  }

  subscribe(callback: (candidates: FieldCandidate[]) => void): () => void {
    this.callbacks.push(callback);
    return () => {
      this.callbacks = this.callbacks.filter((cb) => cb !== callback);
    };
  }

  async scan(): Promise<void> {
    try {
      const result = await this.detector.detect();
      this.candidates = result.candidates;
      this.lastChecked = Date.now();
      this.notifySubscribers();
    } catch (e) {
      log.warn('Incremental scan failed', e);
    }
  }

  destroy(): void {
    if (this.observer) {
      this.observer.disconnect();
    }
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
    }
  }

  private triggerDebouncedScan(): void {
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
    }
    this.debounceTimeout = setTimeout(async () => {
      await this.scan();
    }, 150); // 150ms debounce
  }

  private notifySubscribers(): void {
    for (const callback of this.callbacks) {
      try {
        callback(this.candidates);
      } catch (e) {
        log.warn('Subscriber callback failed', e);
      }
    }
  }
}
