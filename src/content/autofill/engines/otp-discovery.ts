import { PageContext } from '../../../types/form.types';
import { OTPFieldGroup } from '../types';
import { 
  safeQuerySelectorAll, 
  VisibilityEngine, 
} from '../utils/dom-utils';
import { NegativePatternMatcher } from '../utils/pattern-matcher';

export class OTPFieldDiscovery {
  private static knownShadowRoots = new Set<ShadowRoot>();
  private static lastShadowRootScan = 0;

  private static readonly MIN_SPLIT_FIELDS = 4;
  private static readonly MAX_SPLIT_FIELDS = 8;

  static discover(context: PageContext): OTPFieldGroup | null {
    const strategies = [
      { name: 'S1:autocomplete-one-time-code', sel: 'input[autocomplete="one-time-code"]', score: 100 },
      {
        name: 'S2:keyworded-identity',
        sel: [
          'input[name="otp"]',
          'input[id="otp"]',
          'input[name="otc"]',
          'input[name*="otp" i]',
          'input[id*="otp" i]',
          'input[name*="verification" i]',
          'input[id*="verification" i]',
          'input[name*="passcode" i]',
          'input[id*="passcode" i]',
          'input[name*="token" i]',
          'input[id*="token" i]',
          'input[name*="2fa" i]',
          'input[id*="2fa" i]',
          'input[name*="mfa" i]',
          'input[id*="mfa" i]',
        ].join(', '),
        score: 95,
      },
      {
        name: 'S5:labels-and-placeholders',
        sel: [
          'input[aria-label*="otp" i]',
          'input[aria-label*="code" i]',
          'input[placeholder*="otp" i]',
          'input[placeholder*="verification" i]',
          'input[placeholder*="passcode" i]',
          'input[data-testid*="otp" i]',
          'input[data-testid*="code" i]',
        ].join(', '),
        score: 80,
      },
    ];

    for (const strategy of strategies) {
      const fields = this.queryVisible(strategy.sel);
      if (fields.length > 0) {
        return this.wrap(fields, strategy.score, strategy.name);
      }
    }

    const split = this.findSplitDigitFields();
    if (split) {
      return split;
    }

    // ── Shadow DOM Fallback ───────────────────────────────────────────────
    const shadowResult = this.discoverInShadowRoots(context);
    if (shadowResult) {
      return shadowResult;
    }

    return null;
  }

  private static discoverInShadowRoots(_context: PageContext): OTPFieldGroup | null {
    void _context;
    const shadowStrategies = [
      { name: 'SD:autocomplete-one-time-code', sel: 'input[autocomplete="one-time-code"]', score: 100 },
      {
        name: 'SD:keyworded-identity',
        sel: [
          'input[name="otp"]',
          'input[id="otp"]',
          'input[name="otc"]',
          'input[name*="otp" i]',
          'input[id*="otp" i]',
          'input[name*="verification" i]',
          'input[id*="verification" i]',
          'input[name*="passcode" i]',
          'input[id*="passcode" i]',
          'input[name*="token" i]',
          'input[id*="token" i]',
        ].join(', '),
        score: 95,
      },
      {
        name: 'SD:labels-and-placeholders',
        sel: [
          'input[aria-label*="otp" i]',
          'input[aria-label*="code" i]',
          'input[placeholder*="otp" i]',
          'input[placeholder*="verification" i]',
          'input[placeholder*="passcode" i]',
        ].join(', '),
        score: 80,
      },
      { name: 'SD:maxlength-1', sel: 'input[maxlength="1"]', score: 88 },
    ];

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, null);
    let node = walker.nextNode();
    while (node) {
      const shadowRoot = (node as Element).shadowRoot;
      if (shadowRoot) {
        for (const strategy of shadowStrategies) {
          const fields = this.queryVisible(strategy.sel, shadowRoot);
          if (strategy.name === 'SD:maxlength-1') {
            if (fields.length >= this.MIN_SPLIT_FIELDS && fields.length <= this.MAX_SPLIT_FIELDS) {
              return this.wrap(fields.slice(0, this.MAX_SPLIT_FIELDS), strategy.score, strategy.name);
            }
          } else if (fields.length > 0) {
            return this.wrap(fields, strategy.score, strategy.name);
          }
        }
      }
      node = walker.nextNode();
    }
    return null;
  }

  static queryVisible(selector: string, root: ParentNode = document): HTMLInputElement[] {
    return safeQuerySelectorAll<HTMLInputElement>(root, selector)
      .filter(f => VisibilityEngine.isFillable(f))
      .filter(f => !NegativePatternMatcher.isLikelyNotOTP(f));
  }

  static sortByPosition(inputs: HTMLInputElement[]): HTMLInputElement[] {
    return [...inputs].sort((a, b) => {
      const rA = a.getBoundingClientRect();
      const rB = b.getBoundingClientRect();
      return (Math.abs(rA.top - rB.top) > 10) ? rA.top - rB.top : rA.left - rB.left;
    });
  }

  private static wrap(fields: HTMLInputElement[], score: number, strategy: string): OTPFieldGroup {
    const sorted = this.sortByPosition(fields);
    const isSplit = sorted.length >= this.MIN_SPLIT_FIELDS && sorted.every(f => f.maxLength === 1);
    return {
      fields: sorted,
      score,
      strategy,
      isSplit,
      expectedLength: isSplit ? sorted.length : (sorted[0].maxLength > 0 ? sorted[0].maxLength : 6),
      signals: [`strategy:${strategy}`]
    };
  }

  private static findSplitDigitFields(): OTPFieldGroup | null {
    const candidates = this.queryVisible('input[maxlength="1"]');
    if (candidates.length < this.MIN_SPLIT_FIELDS) {
      return null;
    }
    return this.wrap(candidates.slice(0, this.MAX_SPLIT_FIELDS), 90, 'S3:split-digit');
  }
}
