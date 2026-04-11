/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  LAYOUT PATTERN DETECTOR — Spatial Cluster Classification    ║
 * ║  Detects visual patterns like vertical login, split screen, etc. ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

export type LayoutPattern =
  | 'vertical_login'
  | 'vertical_signup'
  | 'horizontal_otp'
  | 'split_screen'
  | 'modal_overlay'
  | 'inline_form'
  | 'unknown';

export interface FormCluster {
  elements: HTMLElement[];
  boundingBox: DOMRect;
  layoutPattern: LayoutPattern;
  confidence: number;
}

export class LayoutPatternDetector {
  /**
   * Detect clusters of input fields on the page.
   */
  public static detectClusters(): FormCluster[] {
    const instance = new LayoutPatternDetector();
    const inputs = Array.from(
      document.querySelectorAll('input:not([type="hidden"]), select, textarea, button')
    );
    const clusters: FormCluster[] = [];
    const processed = new Set<Element>();

    for (const input of inputs) {
      if (processed.has(input)) {
        continue;
      }

      const clusterElements = instance.findNearbyElements(
        input as HTMLElement,
        inputs as HTMLElement[]
      );
      clusterElements.forEach((el) => processed.add(el));

      if (clusterElements.length > 0) {
        const boundingBox = instance.computeBoundingBox(clusterElements);
        const { pattern, confidence } = instance.classifyPattern(clusterElements, boundingBox);
        clusters.push({
          elements: clusterElements,
          boundingBox,
          layoutPattern: pattern,
          confidence,
        });
      }
    }

    return clusters;
  }

  private findNearbyElements(start: HTMLElement, all: HTMLElement[]): HTMLElement[] {
    const cluster = [start];
    const threshold = 150; // px
    const startRect = start.getBoundingClientRect();

    for (const el of all) {
      if (el === start) {
        continue;
      }
      const rect = el.getBoundingClientRect();
      const dist = Math.sqrt(
        Math.pow(startRect.left - rect.left, 2) + Math.pow(startRect.top - rect.top, 2)
      );
      if (dist < threshold) {
        cluster.push(el);
      }
    }
    return cluster;
  }

  private computeBoundingBox(elements: HTMLElement[]): DOMRect {
    let top = Infinity,
      left = Infinity,
      bottom = -Infinity,
      right = -Infinity;
    for (const el of elements) {
      const rect = el.getBoundingClientRect();
      top = Math.min(top, rect.top);
      left = Math.min(left, rect.left);
      bottom = Math.max(bottom, rect.bottom);
      right = Math.max(right, rect.right);
    }
    return new DOMRect(left, top, right - left, bottom - top);
  }

  private classifyPattern(
    elements: HTMLElement[],
    box: DOMRect
  ): { pattern: LayoutPattern; confidence: number } {
    const inputs = elements.filter((el) => el.tagName === 'INPUT');
    const buttons = elements.filter((el) => el.tagName === 'BUTTON');

    // 1. Detect Horizontal OTP
    if (inputs.length >= 4 && inputs.length <= 8) {
      const isHorizontal = inputs.every(
        (el) =>
          Math.abs(el.getBoundingClientRect().top - inputs[0]!.getBoundingClientRect().top) < 10
      );
      if (isHorizontal) {
        return { pattern: 'horizontal_otp', confidence: 0.9 };
      }
    }

    // 2. Detect Vertical Login
    if (inputs.length >= 2 && inputs.length <= 3 && buttons.length >= 1) {
      const isVertical = inputs.every(
        (el, i) =>
          i === 0 || el.getBoundingClientRect().top > inputs[i - 1]!.getBoundingClientRect().top
      );
      if (isVertical && box.width < 500) {
        return { pattern: 'vertical_login', confidence: 0.85 };
      }
    }

    // 3. Detect Modal Overlay
    const modal = elements[0]!.closest('[role="dialog"], .modal, .overlay');
    if (modal) {
      return { pattern: 'modal_overlay', confidence: 0.95 };
    }

    return { pattern: 'unknown', confidence: 0.5 };
  }
}
