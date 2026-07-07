import { FieldCandidate, UltraDetector } from '../content/detection/UltraDetector';
import { UniversalFiller, FillResult } from '../content/filling/UniversalFiller';
import { createLogger } from '../utils/logger';

const log = createLogger('VerificationLoop');

export interface VerificationResult {
  success: boolean;
  attempts: number;
  strategy: string;
}

export class VerificationLoop {
  private maxRetries = 3;
  private verificationDelayMs = 50;

  constructor(maxRetries = 3, verificationDelayMs = 50) {
    this.maxRetries = maxRetries;
    this.verificationDelayMs = verificationDelayMs;
  }

  async verifyAndCorrect(
    filler: UniversalFiller,
    candidate: FieldCandidate,
    value: string
  ): Promise<VerificationResult> {
    let attempt = 0;
    let strategyUsed = 'none';

    while (attempt < this.maxRetries) {
      attempt++;
      const result: FillResult = await filler.fill(candidate, value);

      if (result.success) {
        strategyUsed = result.strategy;

        // Wait brief delay for framework digest
        await new Promise((resolve) => setTimeout(resolve, this.verificationDelayMs));

        // Deep verify value matches what we filled
        const verified = this.deepVerify(candidate, value);
        if (verified) {
          return { success: true, attempts: attempt, strategy: strategyUsed };
        } else {
          log.warn(`Verification failed for field. Expected: ${value}, Got: ${candidate.element.value}. Attempting correction...`);
        }
      }
    }

    return { success: false, attempts: attempt, strategy: strategyUsed };
  }

  private deepVerify(candidate: FieldCandidate, expected: string): boolean {
    const el = candidate.element;
    if (!el.isConnected) return false;

    // For password fields, if we typed something, length should be > 0
    if (el.type === 'password') {
      return el.value.length > 0;
    }

    // For normal fields
    const actual = el.value || '';
    if (actual === expected) {
      return true;
    }

    // Relaxed match: case-insensitive or space-stripped (common for phone/code spaces)
    const normalize = (val: string) => val.toLowerCase().replace(/[-\s]/g, '');
    return normalize(actual) === normalize(expected);
  }
}
