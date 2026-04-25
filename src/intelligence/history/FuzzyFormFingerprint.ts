/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  FUZZY FORM FINGERPRINT — 3-Level History Matching           ║
 * ║  Survives class name changes and minor DOM refactors.          ║
 * ║  Matches across related domains (e.g. microsoft.com/live.com). ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

export interface FormFingerprint {
  l1: string; // Structural skeleton (tag sequence)
  l2: string; // Semantic skeleton (type sequence)
  l3: string; // Attribute hints (name patterns)
}

export class FuzzyFormFingerprint {
  /**
   * Compute a 3-level fingerprint for a form cluster.
   */
  public static generate(elements: HTMLElement[]): FormFingerprint {
    const inputs = elements.filter((el) => el.tagName === 'INPUT' || el.tagName === 'SELECT');

    // Level 1: tag sequence + nesting depth
    const l1 = inputs
      .map((el) => {
        let depth = 0;
        let curr: HTMLElement | null = el;
        while (curr && curr.tagName !== 'FORM') {
          curr = curr.parentElement;
          depth++;
        }
        return `${el.tagName.toLowerCase()}:${depth}`;
      })
      .join('>');

    // Level 2: type sequence
    const l2 = inputs.map((el) => (el as HTMLInputElement).type || 'text').join('|');

    // Level 3: attribute hints (abstracted)
    const l3 = inputs
      .map((el) => {
        const name = el.getAttribute('name') || '';
        if (/user|login|email/i.test(name)) {
          return 'identity';
        }
        if (/pass|pwd|secret/i.test(name)) {
          return 'secret';
        }
        return 'other';
      })
      .join(',');

    return { l1: this.hash(l1), l2: this.hash(l2), l3: this.hash(l3) };
  }

  /**
   * Match two fingerprints with a similarity score.
   */
  public static match(incoming: FormFingerprint, stored: FormFingerprint): number {
    if (incoming.l1 === stored.l1) {
      return 1.0;
    } // Perfect structural match
    if (incoming.l2 === stored.l2) {
      return 0.8;
    } // Semantic match
    if (incoming.l3 === stored.l3) {
      return 0.5;
    } // Attribute hint match
    return 0.0;
  }

  private static hash(str: string): string {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = (h << 5) - h + str.charCodeAt(i);
      h |= 0;
    }
    return h.toString(36);
  }
}
