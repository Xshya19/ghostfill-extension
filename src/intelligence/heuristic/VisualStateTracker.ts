/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  VISUAL STATE TRACKER — CSS Cascade & Visibility Monitor     ║
 * ║  Resolves the full computed style cascade and overlay state.   ║
 * ║  Predicts visibility for animated elements.                    ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

export interface VisualState {
  isVisible: boolean;
  opacity: number;
  dimensions: { w: number; h: number };
  isInViewport: boolean;
  isObscured: boolean;
  isAnimating: boolean;
  willBecomeVisible: boolean;
  zIndex: number;
}

export class VisualStateTracker {
  /**
   * Get the complete visual state of an element.
   */
  public getVisualState(el: HTMLElement): VisualState {
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    
    const isVisible = this.checkVisibility(el, style);
    const isObscured = this.checkIfObscured(el, rect, style);

    return {
      isVisible,
      opacity: parseFloat(style.opacity || '1'),
      dimensions: { w: el.offsetWidth, h: el.offsetHeight },
      isInViewport: this.isInViewport(rect),
      isObscured,
      isAnimating: this.isCurrentlyAnimating(style),
      willBecomeVisible: this.predictFutureVisibility(el, style),
      zIndex: parseInt(style.zIndex, 10) || 0
    };
  }

  private checkVisibility(el: HTMLElement, style: CSSStyleDeclaration): boolean {
    // 1. Basic CSS checks
    if (style.display === 'none') {return false;}
    if (style.visibility === 'hidden') {return false;}
    if (parseFloat(style.opacity) < 0.01) {return false;}
    
    // 2. Physical dimension checks
    if (el.offsetWidth <= 0 || el.offsetHeight <= 0) {return false;}

    // 3. Ancestor checks
    let curr: HTMLElement | null = el.parentElement;
    while (curr) {
      const pStyle = window.getComputedStyle(curr);
      if (pStyle.display === 'none') {return false;}
      if (pStyle.overflow === 'hidden' && (curr.offsetWidth === 0 || curr.offsetHeight === 0)) {return false;}
      curr = curr.parentElement;
    }

    return true;
  }

  private checkIfObscured(el: HTMLElement, rect: DOMRect, style: CSSStyleDeclaration): boolean {
    if (rect.width === 0 || rect.height === 0) {return false;}

    // Check center point
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    if (cx < 0 || cy < 0 || cx > window.innerWidth || cy > window.innerHeight) {return false;}

    const elementAtPoint = document.elementFromPoint(cx, cy);
    if (!elementAtPoint) {return false;}

    // If the element at point is not our element and not its descendant/ancestor
    if (elementAtPoint !== el && !el.contains(elementAtPoint) && !elementAtPoint.contains(el)) {
      // Check if the obscuring element is a modal, overlay or cookie banner
      const obsStyle = window.getComputedStyle(elementAtPoint);
      if (parseInt(obsStyle.zIndex, 10) > parseInt(style.zIndex, 10)) {return true;}
    }

    return false;
  }

  private isInViewport(rect: DOMRect): boolean {
    return (
      rect.bottom >= 0 &&
      rect.right >= 0 &&
      rect.top <= window.innerHeight &&
      rect.left <= window.innerWidth
    );
  }

  private isCurrentlyAnimating(style: CSSStyleDeclaration): boolean {
    return (
      (!!style.animationName && style.animationName !== 'none') ||
      (!!style.transitionProperty && style.transitionProperty !== 'none')
    );
  }

  private predictFutureVisibility(el: HTMLElement, style: CSSStyleDeclaration): boolean {
    // If it's already visible, return true
    if (this.checkVisibility(el, style)) {return true;}

    // If it's zero opacity but has a transition on opacity, it might become visible
    if (parseFloat(style.opacity) === 0 && style.transitionProperty.includes('opacity')) {return true;}

    // If it's display:none but some script is about to change it (hard to tell without proxying)
    // We can check attributes like "data-loading" or "hidden" which are often toggled
    if (el.hasAttribute('hidden') || el.classList.contains('hidden')) {
      return true;
    }

    return false;
  }
}
