/**
 * GhostFill 3.0 — FAB Intelligence Layer · presenter
 *
 * Single owner of "when is the FAB on screen". `FloatingButton` keeps owning
 * rendering, actions and state; it just stops deciding visibility.
 *
 *   presenter.handleFocusIn(target)   → gate → anchor → onShow / onHide
 *   presenter.handleFocusOut(event)   → 180ms grace, then hide (was 6000ms)
 *   presenter.dismiss()               → hide + remember the host
 *   presenter.noteAccept()            → remember success, become bolder here
 *
 * Lifecycle hides that the old implementation was missing entirely:
 *   SPA route change (pushState/replaceState/popstate/hashchange), field
 *   detachment, field becoming `display:none`, tab hidden, page unload,
 *   Escape key, and pointerdown far away from the anchored field.
 */

import { FabAnchor, type FabHideReason, type PlacementResult } from './fabAnchor';
import { HostPolicyStore, createChromeStorageAdapter } from './fabHostPolicy';
import type { GateDecision, GateOptions } from './fabTypes';
import { evaluateFab } from './fabVisibilityGate';

export type FabHideCause = FabHideReason | 'blur' | 'route-change' | 'dismissed' | 'gate-rejected';

export interface SmartFabPresenterOptions {
  /** The FAB shadow host (`#ghostfill-fab`). */
  readonly host: HTMLElement;
  readonly size?: number;
  /** Fresh gate inputs per evaluation: settings + cached page analysis. */
  readonly gateOptions: () => GateOptions;
  readonly onShow: (field: HTMLElement, decision: GateDecision) => void;
  readonly onPlace: (placement: PlacementResult, decision: GateDecision) => void;
  readonly onHide: (cause: FabHideCause, decision?: GateDecision) => void;
  /** Optional: log every decision while debugging. */
  readonly onDecision?: (decision: GateDecision, field: HTMLElement | null) => void;
  readonly policy?: HostPolicyStore | null;
  readonly focusDebounceMs?: number;
  readonly blurGraceMs?: number;
  readonly autoWire?: boolean;
}

const DEFAULT_FOCUS_DEBOUNCE_MS = 40;
/** Long enough to let a click land on the FAB, short enough to never linger. */
const DEFAULT_BLUR_GRACE_MS = 180;
const DEFAULT_SIZE = 46;

export class SmartFabPresenter {
  private readonly anchor: FabAnchor;
  private readonly policy: HostPolicyStore;
  private readonly cleanupFns: Array<() => void> = [];

  private field: HTMLElement | null = null;
  private decision: GateDecision | null = null;
  private focusTimer: ReturnType<typeof setTimeout> | null = null;
  private blurTimer: ReturnType<typeof setTimeout> | null = null;
  private pointerInside = false;
  private destroyed = false;

  constructor(private readonly options: SmartFabPresenterOptions) {
    this.policy = options.policy ?? new HostPolicyStore(createChromeStorageAdapter());
    void this.policy.load();

    this.anchor = new FabAnchor({
      host: options.host,
      size: options.size ?? DEFAULT_SIZE,
      onPlace: (placement) => {
        if (this.decision) {
          this.options.onPlace(placement, this.decision);
        }
      },
      onHide: (reason) => this.hide(reason),
    });

    this.trackPointer();
    if (options.autoWire !== false) {
      this.wire();
    }
  }

  get currentField(): HTMLElement | null {
    return this.field;
  }

  get currentDecision(): GateDecision | null {
    return this.decision;
  }

  get hostPolicy(): HostPolicyStore {
    return this.policy;
  }

  /** Wire the DOM listeners this presenter owns. Idempotent per instance. */
  wire(): void {
    const onFocusIn = (event: FocusEvent): void => this.handleFocusIn(event.target);
    const onFocusOut = (event: FocusEvent): void => this.handleFocusOut(event);
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('focusout', onFocusOut, true);
    this.cleanupFns.push(() => {
      document.removeEventListener('focusin', onFocusIn, true);
      document.removeEventListener('focusout', onFocusOut, true);
    });

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && this.field) {
        this.dismiss();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    this.cleanupFns.push(() => document.removeEventListener('keydown', onKeyDown, true));

    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (this.options.host.contains(target) || target === this.options.host) {
        return;
      }
      if (this.field && !this.field.contains(target) && this.field !== target) {
        // Clicking elsewhere on the page is an explicit "not now".
        this.hide('blur');
      }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    this.cleanupFns.push(() => document.removeEventListener('pointerdown', onPointerDown, true));

    const unhookRoutes = onRouteChange(() => this.hide('route-change'));
    this.cleanupFns.push(unhookRoutes);

    const onPageHide = (): void => this.hide('page-hidden');
    window.addEventListener('pagehide', onPageHide);
    this.cleanupFns.push(() => window.removeEventListener('pagehide', onPageHide));
  }

  handleFocusIn(target: EventTarget | null): void {
    if (this.destroyed) {
      return;
    }
    this.clearBlurTimer();

    // Focus moving into our own UI must never re-run the gate.
    if (target instanceof Node && this.options.host.contains(target)) {
      return;
    }

    if (this.focusTimer !== null) {
      clearTimeout(this.focusTimer);
    }
    this.focusTimer = setTimeout(() => {
      this.focusTimer = null;
      this.evaluate(target);
    }, this.options.focusDebounceMs ?? DEFAULT_FOCUS_DEBOUNCE_MS);
  }

  handleFocusOut(event: FocusEvent): void {
    if (this.destroyed || !this.field) {
      return;
    }
    const next = event.relatedTarget;
    if (next instanceof Node && this.options.host.contains(next)) {
      return;
    }
    if (this.pointerInside) {
      return;
    }

    this.clearBlurTimer();
    this.blurTimer = setTimeout(() => {
      this.blurTimer = null;
      if (this.pointerInside) {
        return;
      }
      const active = document.activeElement;
      if (active && this.field && (active === this.field || this.options.host.contains(active))) {
        return;
      }
      this.hide('blur');
    }, this.options.blurGraceMs ?? DEFAULT_BLUR_GRACE_MS);
  }

  /** User said "go away": hide now and get quieter on this host next time. */
  dismiss(): void {
    this.policy.recordDismiss(location.hostname);
    this.hide('dismissed');
  }

  /** A fill succeeded: this host is trusted, be confident here from now on. */
  noteAccept(): void {
    this.policy.recordAccept(location.hostname);
  }

  muteHost(days = 365): void {
    this.policy.mute(location.hostname, days);
    this.hide('dismissed');
  }

  /** Re-run the gate for the currently focused element (e.g. after settings change). */
  reevaluate(): void {
    this.evaluate(document.activeElement);
  }

  destroy(): void {
    this.destroyed = true;
    this.clearBlurTimer();
    if (this.focusTimer !== null) {
      clearTimeout(this.focusTimer);
      this.focusTimer = null;
    }
    this.anchor.destroy();
    for (const fn of this.cleanupFns) {
      try {
        fn();
      } catch {
        /* ignore */
      }
    }
    this.cleanupFns.length = 0;
    this.field = null;
    this.decision = null;
  }

  private evaluate(target: EventTarget | null): void {
    const options = this.options.gateOptions();
    const hostname = options.hostname ?? location.hostname;
    const decision = evaluateFab(target, {
      ...options,
      policy: options.policy ?? this.policy.snapshot(hostname),
    });

    this.options.onDecision?.(decision, target instanceof HTMLElement ? target : null);

    if (decision.presence === 'hidden') {
      if (this.field) {
        this.hide('gate-rejected', decision);
      }
      return;
    }

    const field = target as HTMLElement;
    // Quiet hosts stay quiet even when the field itself scores well.
    const presence =
      decision.presence === 'active' && this.policy.shouldStayQuiet(hostname)
        ? 'quiet'
        : decision.presence;
    const effective: GateDecision = { ...decision, presence };

    this.field = field;
    this.decision = effective;
    this.options.onShow(field, effective);
    this.anchor.attach(field, effective.anchorElement ?? field);
  }

  private hide(cause: FabHideCause, decision?: GateDecision): void {
    this.clearBlurTimer();
    if (!this.field && cause !== 'route-change') {
      return;
    }
    this.field = null;
    const last = this.decision ?? decision;
    this.decision = null;
    this.anchor.detach();
    this.options.onHide(cause, last ?? undefined);
  }

  private clearBlurTimer(): void {
    if (this.blurTimer !== null) {
      clearTimeout(this.blurTimer);
      this.blurTimer = null;
    }
  }

  private trackPointer(): void {
    const host = this.options.host;
    const enter = (): void => {
      this.pointerInside = true;
      this.clearBlurTimer();
    };
    const leave = (): void => {
      this.pointerInside = false;
    };
    host.addEventListener('pointerenter', enter);
    host.addEventListener('pointerleave', leave);
    this.cleanupFns.push(() => {
      host.removeEventListener('pointerenter', enter);
      host.removeEventListener('pointerleave', leave);
    });
  }
}

/**
 * Detects SPA navigation. The old FAB had no route awareness at all, so it
 * survived client-side navigations and ended up floating over the next screen.
 */
export function onRouteChange(callback: () => void): () => void {
  let lastHref = location.href;
  const fire = (): void => {
    if (location.href === lastHref) {
      return;
    }
    lastHref = location.href;
    callback();
  };

  const history = window.history;
  const originalPush = history.pushState;
  const originalReplace = history.replaceState;

  history.pushState = function patchedPushState(
    this: History,
    ...args: Parameters<History['pushState']>
  ): void {
    originalPush.apply(this, args);
    fire();
  };
  history.replaceState = function patchedReplaceState(
    this: History,
    ...args: Parameters<History['replaceState']>
  ): void {
    originalReplace.apply(this, args);
    fire();
  };

  window.addEventListener('popstate', fire);
  window.addEventListener('hashchange', fire);

  return () => {
    history.pushState = originalPush;
    history.replaceState = originalReplace;
    window.removeEventListener('popstate', fire);
    window.removeEventListener('hashchange', fire);
  };
}

export { FabAnchor } from './fabAnchor';
export type { FabAnchorOptions, FabHideReason, FabPlacement, PlacementResult } from './fabAnchor';
export { HostPolicyStore, createChromeStorageAdapter } from './fabHostPolicy';
export type { StorageAdapter } from './fabHostPolicy';
export {
  AUTH_PATH_RE,
  collectFieldEvidence,
  evaluateFab,
  isAppSurfaceHost,
} from './fabVisibilityGate';
export { DEFAULT_THRESHOLDS } from './fabTypes';
export type {
  FabBlockReason,
  FabMode,
  FabPresence,
  FieldEvidence,
  GateDecision,
  GateOptions,
  GateThresholds,
  HostPolicySnapshot,
  PageSignals,
} from './fabTypes';
