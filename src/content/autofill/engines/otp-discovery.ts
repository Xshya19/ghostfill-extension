import { PageContext } from '../../../types/form.types';
import { OTPFieldGroup } from '../types';
import { safeQuerySelectorAll, VisibilityEngine } from '../utils/dom-utils';
import { NegativePatternMatcher } from '../utils/pattern-matcher';

export class OTPFieldDiscovery {
  private static knownShadowRoots = new Set<ShadowRoot>();
  private static lastShadowRootScan = 0;

  private static readonly MIN_SPLIT_FIELDS = 4;
  private static readonly MAX_SPLIT_FIELDS = 8;

  static discover(context: PageContext): OTPFieldGroup | null {
    const strategies = [
      {
        name: 'S1:autocomplete-one-time-code',
        sel: 'input[autocomplete="one-time-code"]',
        score: 100,
      },
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
        name: 'S3:pattern-digit-otp',
        sel: [
          'input[pattern="\\d{4}"]',
          'input[pattern="\\d{5}"]',
          'input[pattern="\\d{6}"]',
          'input[pattern="\\d{7}"]',
          'input[pattern="\\d{8}"]',
          'input[pattern="[0-9]{4}"]',
          'input[pattern="[0-9]{5}"]',
          'input[pattern="[0-9]{6}"]',
          'input[pattern="[0-9]{7}"]',
          'input[pattern="[0-9]{8}"]',
        ].join(', '),
        score: 92,
      },
      {
        name: 'S4:inputmode-numeric-short',
        sel: 'input[inputmode="numeric"], input[inputmode="decimal"]',
        score: 70,
      },
      {
        name: 'S5:labels-and-placeholders',
        sel: [
          'input[aria-label*="otp" i]',
          'input[aria-label*="code" i]',
          'input[placeholder*="otp" i]',
          'input[placeholder*="verification" i]',
          'input[placeholder*="passcode" i]',
          'input[placeholder*="enter code" i]',
          'input[placeholder*="6-digit" i]',
          'input[placeholder*="4-digit" i]',
          'input[data-testid*="otp" i]',
          'input[data-testid*="code" i]',
          'input[data-testid*="verification" i]',
          'input[aria-describedby*="otp" i]',
          'input[aria-describedby*="code" i]',
        ].join(', '),
        score: 80,
      },
      {
        name: 'S6:contenteditable-otp',
        sel: '[contenteditable="true"][role="textbox"], [contenteditable="true"][aria-label*="code" i], [contenteditable="true"][aria-label*="otp" i]',
        score: 75,
      },
    ];

    for (const strategy of strategies) {
      const fields = this.queryVisible(strategy.sel);

      if (strategy.name === 'S4:inputmode-numeric-short') {
        const filtered = fields.filter((f) => {
          if (f.maxLength >= 4 && f.maxLength <= 8) return true;
          const rect = f.getBoundingClientRect();
          if (rect.width > 0 && rect.width < 120) return true;
          if (f.type === 'tel' || f.type === 'number') return true;
          return false;
        });
        if (filtered.length > 0 && filtered.length <= this.MAX_SPLIT_FIELDS) {
          return this.wrap(filtered, strategy.score, strategy.name);
        }
        continue;
      }

      if (strategy.name === 'S6:contenteditable-otp') {
        if (fields.length > 0) {
          return this.wrapEditable(fields, strategy.score, strategy.name);
        }
        continue;
      }

      if (fields.length > 0) {
        return this.wrap(fields, strategy.score, strategy.name);
      }
    }

    const split = this.findSplitDigitFields();
    if (split) {
      return split;
    }

    const singleInputSplit = this.findSingleInputSplitOTP();
    if (singleInputSplit) {
      return singleInputSplit;
    }

    const shadowResult = this.discoverInShadowRoots(context);
    if (shadowResult) {
      return shadowResult;
    }

    return null;
  }

  private static discoverInShadowRoots(_context: PageContext): OTPFieldGroup | null {
    void _context;
    const shadowStrategies = [
      {
        name: 'SD:autocomplete-one-time-code',
        sel: 'input[autocomplete="one-time-code"]',
        score: 100,
      },
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
        name: 'SD:pattern-digit-otp',
        sel: [
          'input[pattern="\\d{4}"]',
          'input[pattern="\\d{5}"]',
          'input[pattern="\\d{6}"]',
          'input[pattern="[0-9]{4}"]',
          'input[pattern="[0-9]{5}"]',
          'input[pattern="[0-9]{6}"]',
        ].join(', '),
        score: 92,
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
              return this.wrap(
                fields.slice(0, this.MAX_SPLIT_FIELDS),
                strategy.score,
                strategy.name
              );
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
      .filter((f) => VisibilityEngine.isFillable(f))
      .filter((f) => !NegativePatternMatcher.isLikelyNotOTP(f));
  }

  static sortByPosition(inputs: HTMLInputElement[]): HTMLInputElement[] {
    return [...inputs].sort((a, b) => {
      const rA = a.getBoundingClientRect();
      const rB = b.getBoundingClientRect();
      return Math.abs(rA.top - rB.top) > 10 ? rA.top - rB.top : rA.left - rB.left;
    });
  }

  private static wrap(fields: HTMLInputElement[], score: number, strategy: string): OTPFieldGroup {
    const sorted = this.sortByPosition(fields);
    const isSplit =
      sorted.length >= this.MIN_SPLIT_FIELDS && sorted.every((f) => f.maxLength === 1);
    return {
      fields: sorted,
      score,
      strategy,
      isSplit,
      expectedLength: isSplit
        ? sorted.length
        : (sorted[0]?.maxLength ?? 0 > 0)
          ? (sorted[0]?.maxLength ?? 6)
          : 6,
      signals: [`strategy:${strategy}`],
    };
  }

  private static findSplitDigitFields(): OTPFieldGroup | null {
    const candidates = this.queryVisible('input[maxlength="1"]');
    if (candidates.length < this.MIN_SPLIT_FIELDS) {
      return null;
    }
    return this.wrap(candidates.slice(0, this.MAX_SPLIT_FIELDS), 90, 'S3:split-digit');
  }

  /**
   * Detects single-input OTP fields that use letter-spacing or fixed-width
   * fonts to visually simulate split boxes. Common in modern frameworks.
   */
  private static findSingleInputSplitOTP(): OTPFieldGroup | null {
    const candidates = this.queryVisible(
      'input[maxlength="4"], input[maxlength="5"], input[maxlength="6"], input[maxlength="7"], input[maxlength="8"]'
    );

    for (const input of candidates) {
      if (NegativePatternMatcher.isLikelyNotOTP(input)) continue;

      const style = window.getComputedStyle(input);
      const hasSplitStyling =
        parseFloat(style.letterSpacing) > 4 ||
        style.fontFamily?.includes('monospace') ||
        style.textAlign === 'center';

      const isShortWide = input.getBoundingClientRect().width > 150 && input.maxLength >= 4;

      const hasOTPSignal = /otp|code|verification|passcode|2fa|mfa/i.test(
        input.placeholder +
          ' ' +
          input.name +
          ' ' +
          input.id +
          ' ' +
          (input.getAttribute('aria-label') || '')
      );

      if ((hasSplitStyling && isShortWide) || hasOTPSignal) {
        return this.wrap([input], hasOTPSignal ? 85 : 65, 'S7:single-input-split');
      }
    }

    return null;
  }

  /**
   * Wrap contenteditable elements as OTP field groups.
   * These are handled differently from standard inputs.
   */
  private static wrapEditable(
    fields: HTMLElement[],
    score: number,
    strategy: string
  ): OTPFieldGroup | null {
    const sorted = [...fields].sort((a, b) => {
      const rA = a.getBoundingClientRect();
      const rB = b.getBoundingClientRect();
      return Math.abs(rA.top - rB.top) > 10 ? rA.top - rB.top : rA.left - rB.left;
    });

    return {
      fields: sorted as unknown as HTMLInputElement[],
      score,
      strategy,
      isSplit: sorted.length >= this.MIN_SPLIT_FIELDS,
      expectedLength: sorted.length >= this.MIN_SPLIT_FIELDS ? sorted.length : 6,
      signals: [`strategy:${strategy}`, 'contenteditable'],
    };
  }
}
