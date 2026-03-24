import { createLogger } from '../../../utils/logger';
import { PageContext } from '../../../types/form.types';
import { OTP_CONSTANTS } from '../../../utils/otp-detection-core';
import { OTPFieldGroup } from '../types';
import { 
  safeQuerySelectorAll, 
  VisibilityEngine, 
  safeQuerySelector,
} from '../utils/dom-utils';
import { NegativePatternMatcher } from '../utils/pattern-matcher';

const log = createLogger('OTPFieldDiscovery');

export class OTPFieldDiscovery {
  private static knownShadowRoots = new Set<ShadowRoot>();
  private static lastShadowRootScan = 0;

  private static readonly MIN_SPLIT_FIELDS = 4;
  private static readonly MAX_SPLIT_FIELDS = 8;

  static discover(context: PageContext): OTPFieldGroup | null {
    const strategies = [
      { name: 'S1:autocomplete-one-time-code', sel: 'input[autocomplete="one-time-code"]', score: 100 },
      { name: 'S2:explicit-otp-names', sel: 'input[name="otp"], input[id="otp"], input[name="otc"]', score: 95 },
      { name: 'S5:aria-labels', sel: 'input[aria-label*="otp" i], input[aria-label*="code" i]', score: 80 },
      { name: 'S8:data-testid', sel: 'input[data-testid*="otp" i], input[data-testid*="code" i]', score: 75 },
    ];

    for (const strategy of strategies) {
      const fields = this.queryVisible(strategy.sel);
      if (fields.length > 0) {
        return this.wrap(fields, strategy.score, strategy.name);
      }
    }

    const split = this.findSplitDigitFields();
    if (split) return split;

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
    if (candidates.length < this.MIN_SPLIT_FIELDS) return null;
    return this.wrap(candidates.slice(0, 6), 90, 'S3:split-digit');
  }
}
