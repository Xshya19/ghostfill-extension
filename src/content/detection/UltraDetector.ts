import { deepQuerySelectorAll } from '../../utils/helpers';
import { extractFieldRecord } from '../../intelligence/featureExtractor';
import { IntelligenceCore, CalibratedResult } from '../../intelligence/IntelligenceCore';
import { FieldType } from '../../types/form.types';
import { createLogger } from '../../utils/logger';

const log = createLogger('UltraDetector');

export interface FieldCandidate {
  element: HTMLInputElement | HTMLTextAreaElement;
  selector: string;
  fieldType: FieldType;
  confidence: number;
  signals: string[];
  decision: 'FILL' | 'ABSTAIN' | 'BLOCK';
  groupId?: string;
  groupIndex?: number;
  groupSize?: number;
}

export interface DetectionResult {
  verdict: 'login' | 'signup' | 'verification' | '2fa' | 'password-reset' | 'default';
  confidence: number;
  candidates: FieldCandidate[];
}

export class UltraDetector {
  private intelligence: IntelligenceCore;

  constructor(intelligence = new IntelligenceCore()) {
    this.intelligence = intelligence;
  }

  async detect(): Promise<DetectionResult> {
    const inputs = deepQuerySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')
      .filter((el) => !el.disabled && !el.readOnly);

    const candidates: FieldCandidate[] = [];

    // 1. Classify all inputs
    for (const input of inputs) {
      try {
        const record = extractFieldRecord(input);
        const calibrated = this.intelligence.classify(record);

        let selector = '';
        if (input.id) {
          selector = '#' + input.id;
        } else if (input.name) {
          selector = `${input.tagName.toLowerCase()}[name="${input.name}"]`;
        } else {
          // Fallback simple selector
          selector = input.tagName.toLowerCase();
        }

        candidates.push({
          element: input,
          selector,
          fieldType: calibrated.fieldType,
          confidence: calibrated.confidence,
          signals: calibrated.signals,
          decision: calibrated.decision,
        });
      } catch (e) {
        log.warn('Failed to extract or classify element', e);
      }
    }

    // 2. Detect split-digit OTP groups
    this.detectSplitDigitGroups(candidates);

    // 3. Determine Page Verdict
    const verdict = this.determinePageVerdict(candidates);

    return {
      verdict,
      confidence: this.calculatePageConfidence(candidates, verdict),
      candidates,
    };
  }

  private detectSplitDigitGroups(candidates: FieldCandidate[]): void {
    const singleDigitCandidates = candidates.filter((c) => {
      const el = c.element as HTMLInputElement;
      return (
        el.maxLength === 1 ||
        el.getAttribute('maxlength') === '1' ||
        (el.style.width && parseInt(el.style.width) < 50)
      );
    });

    if (singleDigitCandidates.length < 4) return;

    // Group single-digit inputs by parent element
    const groupsByParent = new Map<HTMLElement, FieldCandidate[]>();
    for (const c of singleDigitCandidates) {
      const parent = c.element.parentElement;
      if (parent) {
        let list = groupsByParent.get(parent);
        if (!list) {
          list = [];
          groupsByParent.set(parent, list);
        }
        list.push(c);
      }
    }

    let groupCounter = 1;
    for (const [parent, list] of groupsByParent.entries()) {
      if (list.length >= 4 && list.length <= 8) {
        // Sort by DOM left coordinate
        const sorted = list.sort((a, b) => {
          const rectA = a.element.getBoundingClientRect();
          const rectB = b.element.getBoundingClientRect();
          return rectA.left - rectB.left;
        });

        const groupId = `otp-group-${groupCounter++}`;
        sorted.forEach((c, idx) => {
          c.fieldType = 'otp';
          c.groupId = groupId;
          c.groupIndex = idx;
          c.groupSize = sorted.length;
          c.decision = 'FILL';
          c.confidence = 0.99; // Highly confident since it is a structured OTP group
        });
      }
    }
  }

  private determinePageVerdict(candidates: FieldCandidate[]): DetectionResult['verdict'] {
    let emailCount = 0;
    let passwordCount = 0;
    let confirmPasswordCount = 0;
    let otpCount = 0;

    for (const c of candidates) {
      if (c.decision === 'BLOCK' || c.decision === 'ABSTAIN') continue;
      if (c.fieldType === 'email') emailCount++;
      if (c.fieldType === 'password') passwordCount++;
      if (c.fieldType === 'confirm-password') confirmPasswordCount++;
      if (c.fieldType === 'otp') otpCount++;
    }

    if (otpCount > 0) {
      return otpCount > 1 || candidates.some((c) => c.groupId) ? '2fa' : 'verification';
    }
    if (confirmPasswordCount > 0) {
      return 'signup';
    }
    if (passwordCount > 0) {
      return emailCount > 0 ? 'login' : 'password-reset';
    }
    return 'default';
  }

  private calculatePageConfidence(candidates: FieldCandidate[], verdict: DetectionResult['verdict']): number {
    if (verdict === 'default') return 0.5;
    const relevant = candidates.filter((c) => {
      if (verdict === '2fa' || verdict === 'verification') return c.fieldType === 'otp';
      if (verdict === 'signup') return c.fieldType === 'confirm-password' || c.fieldType === 'password' || c.fieldType === 'email';
      if (verdict === 'login') return c.fieldType === 'password' || c.fieldType === 'email';
      return false;
    });

    if (relevant.length === 0) return 0.5;
    const sum = relevant.reduce((acc, c) => acc + c.confidence, 0);
    return sum / relevant.length;
  }
}
