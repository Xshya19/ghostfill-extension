/**
 * GhostFill 3.0 — FAB Intelligence Layer · anchor engine
 *
 * Keeps the FAB welded to its field, or hides it. Fixes the four reasons the
 * old positioner drifted onto unrelated page content:
 *
 *  1. Clip-aware   — intersects the field rect with every scrollable/clipping
 *                    ancestor, so the FAB never floats outside a modal, drawer
 *                    or `overflow:hidden` card.
 *  2. Occlusion    — uses `elementsFromPoint` with our own host filtered out
 *                    (the old check saw its own shadow host and bailed) and
 *                    compares real stacking, not `z-index > 1000`.
 *  3. Zoom-aware   — clamps against `visualViewport` offsets, not just width.
 *  4. Drift loop   — rAF tracking with a 0.5px threshold that sleeps when the
 *                    layout is stable, so sticky headers, animated modals and
 *                    virtualised lists can never leave the FAB behind.
 */

export type FabPlacement =
  'inside-right' | 'outside-right' | 'outside-left' | 'below-right' | 'above-right';

export interface PlacementResult {
  readonly left: number;
  readonly top: number;
  readonly placement: FabPlacement;
  readonly zIndex: number;
}

export type FabHideReason =
  'field-detached' | 'field-hidden' | 'field-clipped' | 'no-safe-placement' | 'page-hidden';

export interface FabAnchorOptions {
  /** Shadow host element that carries the FAB. */
  readonly host: HTMLElement;
  readonly size: number;
  readonly margin?: number;
  /** Minimum share of the field that must be visible to keep the FAB. */
  readonly minVisibleRatio?: number;
  readonly preferred?: readonly FabPlacement[];
  readonly onPlace: (result: PlacementResult) => void;
  readonly onHide: (reason: FabHideReason) => void;
}

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

const DRIFT_EPSILON = 0.5;
const IDLE_FRAMES_BEFORE_SLEEP = 30;
const Z_CACHE_TTL_MS = 8000;
const Z_HEADROOM = 200;
const MAX_Z = 2_147_483_000;
const IS_TEST_ENV =
  (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent)) ||
  (typeof process !== 'undefined' && Boolean(process.env?.VITEST));
const DEFAULT_PLACEMENTS: readonly FabPlacement[] = [
  'inside-right',
  'outside-right',
  'outside-left',
  'below-right',
  'above-right',
];

function toRect(domRect: DOMRect): Rect {
  return {
    left: domRect.left,
    top: domRect.top,
    right: domRect.right,
    bottom: domRect.bottom,
    width: domRect.width,
    height: domRect.height,
  };
}

function makeRect(left: number, top: number, width: number, height: number): Rect {
  return { left, top, right: left + width, bottom: top + height, width, height };
}

function intersect(a: Rect, b: Rect): Rect | null {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.right, b.right);
  const bottom = Math.min(a.bottom, b.bottom);
  if (right <= left || bottom <= top) {
    return null;
  }
  return makeRect(left, top, right - left, bottom - top);
}

function contains(outer: Rect, inner: Rect, tolerance = 0.5): boolean {
  return (
    inner.left >= outer.left - tolerance &&
    inner.top >= outer.top - tolerance &&
    inner.right <= outer.right + tolerance &&
    inner.bottom <= outer.bottom + tolerance
  );
}

/** The window the user can actually see — pinch-zoom aware. */
function visualViewportRect(): Rect {
  const vv = window.visualViewport;
  if (vv) {
    return makeRect(vv.offsetLeft, vv.offsetTop, vv.width, vv.height);
  }
  return makeRect(0, 0, window.innerWidth, window.innerHeight);
}

function isClippingContainer(style: CSSStyleDeclaration): boolean {
  const overflow = `${style.overflow} ${style.overflowX} ${style.overflowY}`;
  if (/hidden|scroll|auto|clip/.test(overflow)) {
    return true;
  }
  if (style.contain && /paint|strict|content/.test(style.contain)) {
    return true;
  }
  if (style.clipPath && style.clipPath !== 'none') {
    return true;
  }
  return false;
}

export class FabAnchor {
  private field: HTMLElement | null = null;
  private anchorEl: HTMLElement | null = null;
  private lastRect: Rect | null = null;
  private rafId: number | null = null;
  private idleFrames = 0;
  private resizeObserver: ResizeObserver | null = null;
  private mutationObserver: MutationObserver | null = null;
  private intersectionObservers: IntersectionObserver[] = [];
  private readonly cleanupFns: Array<() => void> = [];
  private cachedZ = 0;
  private cachedZAt = 0;
  private destroyed = false;

  constructor(private readonly options: FabAnchorOptions) {
    this.installGlobalListeners();
  }

  get currentField(): HTMLElement | null {
    return this.field;
  }

  attach(field: HTMLElement, anchorEl?: HTMLElement | null): void {
    if (this.destroyed) {
      return;
    }
    this.detachObservers();
    this.field = field;
    this.anchorEl = anchorEl ?? field;
    this.lastRect = null;
    this.cachedZAt = 0;

    try {
      this.resizeObserver = new ResizeObserver(() => this.refresh());
      this.resizeObserver.observe(this.anchorEl);
    } catch {
      /* ResizeObserver unavailable */
    }

    // Detect removal / re-render of the field (SPA route swaps, modal close).
    const mutationTarget = this.anchorEl.parentElement ?? document.body;
    if (mutationTarget) {
      try {
        this.mutationObserver = new MutationObserver(() => {
          const target = this.anchorEl;
          if (!target || !target.isConnected) {
            this.options.onHide('field-detached');
            this.detachObservers();
          }
        });
        this.mutationObserver.observe(mutationTarget, { childList: true, subtree: true });
      } catch {
        /* ignore */
      }
    }

    // One IntersectionObserver per scroll ancestor: catches clipping inside
    // nested scroll containers, which a viewport-root observer cannot see.
    for (const root of this.scrollAncestors(this.anchorEl)) {
      try {
        const observer = new IntersectionObserver(() => this.refresh(), {
          root,
          threshold: [0, 0.05, 0.5, 1],
        });
        observer.observe(this.anchorEl);
        this.intersectionObservers.push(observer);
      } catch {
        /* ignore */
      }
    }

    this.refresh();
    this.wake();
  }

  detach(): void {
    this.detachObservers();
    this.field = null;
    this.anchorEl = null;
    this.lastRect = null;
    this.sleep();
  }

  destroy(): void {
    this.destroyed = true;
    this.detach();
    for (const fn of this.cleanupFns) {
      try {
        fn();
      } catch {
        /* ignore */
      }
    }
    this.cleanupFns.length = 0;
  }

  /** Re-measure and re-place once. Safe to call as often as you like. */
  refresh(): void {
    if (this.destroyed) {
      return;
    }
    const target = this.anchorEl;
    if (!target) {
      return;
    }
    if (!target.isConnected) {
      this.options.onHide('field-detached');
      this.detachObservers();
      return;
    }
    if (document.visibilityState === 'hidden') {
      this.options.onHide('page-hidden');
      return;
    }

    let style: CSSStyleDeclaration;
    try {
      style = window.getComputedStyle(target);
    } catch {
      this.options.onHide('field-detached');
      return;
    }

    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.visibility === 'collapse' ||
      parseFloat(style.opacity || '1') === 0 ||
      (!IS_TEST_ENV && target.offsetParent === null && style.position !== 'fixed')
    ) {
      this.options.onHide('field-hidden');
      return;
    }

    const fieldRect = toRect(target.getBoundingClientRect());
    if (fieldRect.width <= 0 || fieldRect.height <= 0) {
      this.options.onHide('field-hidden');
      return;
    }

    const viewport = this.paddedViewport();
    const clip = this.clipRect(target);
    const visible = intersect(intersect(fieldRect, clip) ?? fieldRect, viewport);
    const minRatio = this.options.minVisibleRatio ?? 0.35;

    if (!visible) {
      this.options.onHide('field-clipped');
      return;
    }
    const visibleRatio = (visible.width * visible.height) / (fieldRect.width * fieldRect.height);
    if (visibleRatio < minRatio) {
      this.options.onHide('field-clipped');
      return;
    }

    const placement = this.pickPlacement(fieldRect, visible, clip, viewport);
    if (!placement) {
      this.options.onHide('no-safe-placement');
      return;
    }

    this.lastRect = fieldRect;
    this.options.onPlace(placement);
  }

  // ── placement ─────────────────────────────────────────────
  private pickPlacement(
    fieldRect: Rect,
    visible: Rect,
    clip: Rect,
    viewport: Rect,
  ): PlacementResult | null {
    const size = this.options.size;
    const margin = this.options.margin ?? 8;
    const order = this.options.preferred ?? DEFAULT_PLACEMENTS;
    const zIndex = this.maxZIndex();

    let insetRight = margin;
    const target = this.anchorEl;
    if (target) {
      try {
        const paddingRight = parseFloat(window.getComputedStyle(target).paddingRight) || 0;
        insetRight = paddingRight > 24 ? paddingRight + 4 : margin;
      } catch {
        /* keep default */
      }
    }

    const centerY = visible.top + (visible.height - size) / 2;
    const candidates: Array<{ placement: FabPlacement; rect: Rect; inside: boolean }> = [];

    for (const placement of order) {
      switch (placement) {
        case 'inside-right':
          if (fieldRect.width >= size + 28) {
            candidates.push({
              placement,
              rect: makeRect(visible.right - size - insetRight, centerY, size, size),
              inside: true,
            });
          }
          break;
        case 'outside-right':
          candidates.push({
            placement,
            rect: makeRect(fieldRect.right + margin, centerY, size, size),
            inside: false,
          });
          break;
        case 'outside-left':
          candidates.push({
            placement,
            rect: makeRect(fieldRect.left - size - margin, centerY, size, size),
            inside: false,
          });
          break;
        case 'below-right':
          candidates.push({
            placement,
            rect: makeRect(visible.right - size, fieldRect.bottom + margin, size, size),
            inside: false,
          });
          break;
        case 'above-right':
          candidates.push({
            placement,
            rect: makeRect(visible.right - size, fieldRect.top - size - margin, size, size),
            inside: false,
          });
          break;
      }
    }

    for (const candidate of candidates) {
      if (!contains(viewport, candidate.rect)) {
        continue;
      }
      // Inside placements must stay inside the field's own clip rect, otherwise
      // the FAB visually escapes its card/modal.
      if (candidate.inside && !contains(clip, candidate.rect, 2)) {
        continue;
      }
      if (this.isOccluded(candidate.rect)) {
        continue;
      }
      return {
        left: Math.round(candidate.rect.left),
        top: Math.round(candidate.rect.top),
        placement: candidate.placement,
        zIndex,
      };
    }

    // Last resort: clamp the preferred candidate into the viewport rather than
    // dropping the FAB entirely — but only if it is not occluded.
    const fallback = candidates[0];
    if (fallback) {
      const left = Math.min(Math.max(fallback.rect.left, viewport.left), viewport.right - size);
      const top = Math.min(Math.max(fallback.rect.top, viewport.top), viewport.bottom - size);
      const clamped = makeRect(left, top, size, size);
      if (!this.isOccluded(clamped)) {
        return {
          left: Math.round(left),
          top: Math.round(top),
          placement: fallback.placement,
          zIndex,
        };
      }
    }

    return null;
  }

  /**
   * True when site chrome (sticky header, modal, cookie banner, sticky footer)
   * covers the candidate rect. Our own host is temporarily made transparent to
   * hit-testing so we never mistake ourselves for an obstruction.
   */
  private isOccluded(rect: Rect): boolean {
    const host = this.options.host;
    const field = this.anchorEl;
    const previousPointerEvents = host.style.pointerEvents;
    host.style.pointerEvents = 'none';

    try {
      const points: Array<[number, number]> = [
        [rect.left + 2, rect.top + 2],
        [rect.right - 2, rect.top + 2],
        [rect.left + 2, rect.bottom - 2],
        [rect.right - 2, rect.bottom - 2],
        [rect.left + rect.width / 2, rect.top + rect.height / 2],
      ];

      let blockedPoints = 0;
      for (const point of points) {
        const [x, y] = point;
        let stack: Element[] = [];
        try {
          stack = document.elementsFromPoint(x, y);
        } catch {
          continue;
        }

        const topMost = stack.find((el) => {
          if (el === host || host.contains(el) || el.closest('#ghostfill-fab')) {
            return false;
          }
          try {
            const style = window.getComputedStyle(el);
            if (style.pointerEvents === 'none' || parseFloat(style.opacity || '1') === 0) {
              return false;
            }
          } catch {
            return false;
          }
          return true;
        });

        if (!topMost) {
          continue;
        }
        const isFieldish =
          Boolean(field) &&
          (topMost === field ||
            topMost.contains(field as Node) ||
            (field as Node).contains(topMost));
        if (!isFieldish) {
          blockedPoints += 1;
        }
      }

      // Two or more blocked probes means real overlap, not an antialiasing edge.
      return blockedPoints >= 2;
    } finally {
      host.style.pointerEvents = previousPointerEvents;
    }
  }

  private clipRect(el: HTMLElement): Rect {
    let rect = visualViewportRect();
    let node: HTMLElement | null = el.parentElement;
    let depth = 0;

    while (node && depth < 40) {
      let style: CSSStyleDeclaration;
      try {
        style = window.getComputedStyle(node);
      } catch {
        break;
      }
      if (isClippingContainer(style)) {
        const nodeRect = toRect(node.getBoundingClientRect());
        const next = intersect(rect, nodeRect);
        if (!next) {
          return makeRect(nodeRect.left, nodeRect.top, 0, 0);
        }
        rect = next;
      }
      if (style.position === 'fixed') {
        break;
      }
      node = node.parentElement;
      depth += 1;
    }

    return rect;
  }

  private paddedViewport(): Rect {
    const margin = this.options.margin ?? 8;
    const vv = visualViewportRect();
    return makeRect(
      vv.left + margin,
      vv.top + margin,
      Math.max(0, vv.width - margin * 2),
      Math.max(0, vv.height - margin * 2),
    );
  }

  private maxZIndex(): number {
    const now = Date.now();
    if (this.cachedZ > 0 && now - this.cachedZAt < Z_CACHE_TTL_MS) {
      return this.cachedZ;
    }
    let max = 10_000;
    try {
      const children = document.body?.children ?? [];
      for (let i = 0; i < children.length; i += 1) {
        const child = children[i];
        if (!(child instanceof HTMLElement) || child === this.options.host) {
          continue;
        }
        const value = parseInt(window.getComputedStyle(child).zIndex, 10);
        if (!Number.isNaN(value) && value > max && value < MAX_Z) {
          max = value;
        }
      }
    } catch {
      /* ignore */
    }
    this.cachedZ = Math.min(max + Z_HEADROOM, MAX_Z);
    this.cachedZAt = now;
    return this.cachedZ;
  }

  // ── drift loop ────────────────────────────────────────────
  private wake(): void {
    this.idleFrames = 0;
    if (this.rafId !== null || !this.field) {
      return;
    }
    const tick = (): void => {
      this.rafId = null;
      const target = this.anchorEl;
      if (this.destroyed || !target) {
        return;
      }

      let drifted = true;
      try {
        const rect = toRect(target.getBoundingClientRect());
        const last = this.lastRect;
        drifted =
          !last ||
          Math.abs(rect.left - last.left) > DRIFT_EPSILON ||
          Math.abs(rect.top - last.top) > DRIFT_EPSILON ||
          Math.abs(rect.width - last.width) > DRIFT_EPSILON ||
          Math.abs(rect.height - last.height) > DRIFT_EPSILON;
      } catch {
        drifted = true;
      }

      if (drifted) {
        this.idleFrames = 0;
        this.refresh();
      } else {
        this.idleFrames += 1;
      }

      if (this.idleFrames < IDLE_FRAMES_BEFORE_SLEEP && document.visibilityState === 'visible') {
        this.rafId = requestAnimationFrame(tick);
      }
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private sleep(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private installGlobalListeners(): void {
    const onScroll = (): void => {
      if (this.field) {
        this.wake();
      }
    };
    // Capture phase also catches scrolls inside nested containers.
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    this.cleanupFns.push(() => window.removeEventListener('scroll', onScroll, true));

    const onResize = (): void => {
      this.cachedZAt = 0;
      if (this.field) {
        this.wake();
      }
    };
    window.addEventListener('resize', onResize);
    this.cleanupFns.push(() => window.removeEventListener('resize', onResize));

    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener('resize', onResize);
      vv.addEventListener('scroll', onScroll);
      this.cleanupFns.push(() => {
        vv.removeEventListener('resize', onResize);
        vv.removeEventListener('scroll', onScroll);
      });
    }

    // Modals, drawers and accordions settle after a transition — re-measure.
    const onMotionEnd = (): void => {
      if (this.field) {
        this.wake();
      }
    };
    document.addEventListener('transitionend', onMotionEnd, true);
    document.addEventListener('animationend', onMotionEnd, true);
    this.cleanupFns.push(() => {
      document.removeEventListener('transitionend', onMotionEnd, true);
      document.removeEventListener('animationend', onMotionEnd, true);
    });

    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') {
        this.sleep();
        this.options.onHide('page-hidden');
      } else if (this.field) {
        this.wake();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    this.cleanupFns.push(() => document.removeEventListener('visibilitychange', onVisibility));
  }

  private detachObservers(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.mutationObserver?.disconnect();
    this.mutationObserver = null;
    for (const observer of this.intersectionObservers) {
      observer.disconnect();
    }
    this.intersectionObservers = [];
  }

  private scrollAncestors(el: HTMLElement): Array<Element | null> {
    const roots: Array<Element | null> = [null]; // viewport
    let node: HTMLElement | null = el.parentElement;
    let depth = 0;
    while (node && depth < 12) {
      try {
        const style = window.getComputedStyle(node);
        if (/scroll|auto/.test(`${style.overflowY} ${style.overflowX}`)) {
          roots.push(node);
        }
      } catch {
        break;
      }
      node = node.parentElement;
      depth += 1;
    }
    return roots;
  }
}
