// ═══════════════════════════════════════════════════════════════
// ⚠️ CODE QUALITY: Large Component - Needs Refactoring
// File size: ~63KB, ~1465 lines
// TODO: Split into smaller modules:
//   - otpScoringEngine.ts: Weighted scoring logic
//   - otpFieldMapper.ts: Field detection and mapping
//   - otpPollingHandler.ts: Fast polling management
//   - otpFillHandler.ts: OTP fill logic and feedback
// Priority: HIGH - This file is too large for maintainability
// ═══════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────
// OTP Page Detector v2 — Intelligent Verification Page Engine
//
// ┌──────────────────────────────────────────────────────────────────┐
// │  Architecture                                                   │
// │                                                                 │
// │  ┌─────────────┐   DOM mutation / URL change / focus            │
// │  │  Scheduler   │◄──────────────────────────────────────────    │
// │  │  (debounced) │                                               │
// │  └──────┬──────┘                                                │
// │         ▼                                                       │
// │  ┌─────────────┐   weighted signals → composite score           │
// │  │  Scoring     │──► confidence ≥ threshold?                    │
// │  │  Engine      │        │ YES               │ NO               │
// │  └─────────────┘        ▼                    ▼                  │
// │               ┌──────────────┐      AI fallback (once)          │
// │               │  Field Map   │                                  │
// │               │  (verified   │                                  │
// │               │   selectors) │                                  │
// │               └──────┬──────┘                                   │
// │                      ▼                                          │
// │               Notify background → start fast OTP polling        │
// │               Listen for AUTO_FILL_OTP → fill → feedback        │
// └──────────────────────────────────────────────────────────────────┘
// │                                                                 │
// │  Features                                                       │
// │  ─ Multi-signal weighted scoring (16 signals, 5 categories)     │
// │  ─ MutationObserver + URL watcher (no fixed-interval polling)   │
// │  ─ Contiguity analysis for split-digit OTP inputs               │
// │  ─ Verified selector generation (every selector round-trips)    │
// │  ─ Full SPA support (pushState / replaceState / popstate)       │
// │  ─ Content-script readiness PING responder                      │
// │  ─ Structured OTPField representation with metadata             │
// │  ─ Proper lifecycle (all listeners tracked & removed)           │
// │  ─ Observable detection metrics                                 │
// └──────────────────────────────────────────────────────────────────┘
// ─────────────────────────────────────────────────────────────────────

import { ExtensionMessage } from '../types';
import { createLogger } from '../utils/logger';
import { safeSendMessage } from '../utils/messaging';
import { AutoFiller } from './autoFiller';
import { FormDetector } from './formDetector';

const log = createLogger('OTPDetector');

// ━━━ Types ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface OTPField {
    element: HTMLInputElement;
    selector: string;
    source: DetectionSource;
    score: number;
    groupId: string | null;     // non-null if part of a split-digit group
    groupIndex: number;            // position within group (0-based)
    groupSize: number;            // total inputs in group
    maxLength: number;
    inputMode: string;
    visible: boolean;
}

type DetectionSource =
    | 'autocomplete-attr'
    | 'name-attr'
    | 'id-attr'
    | 'placeholder-attr'
    | 'aria-label-attr'
    | 'label-association'
    | 'maxlength-heuristic'
    | 'split-digit-group'
    | 'small-input-cluster'
    | 'form-detector'
    | 'ai-container-analysis'
    | 'ai-background';

type PageVerdict = 'otp-page' | 'possible-otp' | 'not-otp';

interface DetectionResult {
    verdict: PageVerdict;
    confidence: number;           // 0.0 – 1.0
    fields: OTPField[];
    signalBreakdown: SignalScore[];
    detectedAt: number;
    durationMs: number;
}

interface SignalScore {
    signal: string;
    weight: number;
    matched: boolean;
    detail?: string;
}

interface DetectionMetrics {
    runsTotal: number;
    runsPositive: number;
    avgDurationMs: number;
    lastVerdict: PageVerdict;
    lastConfidence: number;
    fieldsFound: number;
    otpsFilled: number;
    otpsFillFailed: number;
    aiRequested: boolean;
    aiResponded: boolean;
}

// ━━━ Signal Weights ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const SIGNAL_WEIGHTS = {
    // ── Category 1: HTML attributes (strongest) ──
    AUTOCOMPLETE_OTC: 0.35,     // autocomplete="one-time-code"
    INPUT_MODE_NUMERIC: 0.08,     // inputmode="numeric"

    // ── Category 2: Name / ID / placeholder keywords ──
    NAME_OTP_KEYWORD: 0.20,
    ID_OTP_KEYWORD: 0.18,
    PLACEHOLDER_KEYWORD: 0.15,
    ARIA_LABEL_KEYWORD: 0.14,
    LABEL_KEYWORD: 0.14,

    // ── Category 3: Structural patterns ──
    SPLIT_DIGIT_GROUP: 0.30,     // 4-8 maxlength=1 inputs in contiguous DOM
    SMALL_CLUSTER: 0.22,     // 4-8 small equal-width inputs
    MAXLENGTH_4_TO_8: 0.10,     // single input with maxlength 4-8

    // ── Category 4: Page context ──
    PAGE_TITLE_KEYWORD: 0.10,
    BODY_TEXT_KEYWORD: 0.12,
    URL_KEYWORD: 0.08,

    // ── Category 5: Form detector agreement ──
    FORM_DETECTOR_2FA: 0.25,

    // ── Negative signals (subtracted) ──
    LOGIN_FORM_PRESENT: -0.15,     // password field nearby = probably login, not OTP
    SEARCH_BAR_LIKELY: -0.20,     // looks like a search input
} as const;

const CONFIDENCE_THRESHOLD = 0.40;   // below this → not-otp
const HIGH_CONFIDENCE = 0.70;   // above this → otp-page (skip AI)
const AI_FALLBACK_THRESHOLD = 0.25;   // between 0.25–0.70 → request AI

// ━━━ Keyword Sets ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const OTP_KEYWORDS = new Set([
    'otp', 'code', 'verify', 'verification', 'token', 'pin',
    '2fa', 'mfa', 'totp', 'passcode', 'one-time', 'onetime',
    'auth-code', 'authcode', 'security-code', 'securitycode',
    'confirmation', 'confirm-code', 'sms-code', 'smscode',
    'twofa', 'twofactor', 'authenticator',
]);

const OTP_CONTEXT_PHRASES = [
    'verification code', 'verify code', 'enter code', 'enter the code',
    'one-time password', 'one time password', 'otp',
    'authentication code', 'security code', 'confirmation code',
    'sms code', 'two-factor', 'two factor', '2fa', 'mfa',
    'we sent', 'we\'ve sent', 'code sent', 'code was sent',
    'enter the.*digit', 'digit code', 'check your phone',
    'check your email', 'verify your identity', 'verify your account',
    'enter verification', 'enter your code', 'enter otp',
];

const SEARCH_INDICATORS = new Set([
    'search', 'query', 'q', 'keyword', 'find', 'lookup',
]);

// ━━━ Configuration ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const CONFIG = {
    DEBOUNCE_MS: 300,
    INITIAL_DELAY_MS: 150,     // slight delay on init for DOM to settle
    MAX_DETECTION_MS: 50,     // budget per detection run
    OBSERVER_THROTTLE_MS: 500,     // min gap between observer-triggered runs
    TOAST_DURATION_MS: 3_500,
    TOAST_ANIMATION_MS: 300,
    MAX_BODY_SCAN_CHARS: 3_000,     // limit for body-text keyword search
    MAX_DOM_SNAPSHOT_CHARS: 5_000,     // for AI analysis payload
    SPLIT_DIGIT_MIN: 4,
    SPLIT_DIGIT_MAX: 8,
    SMALL_INPUT_MAX_WIDTH: 65,
    SMALL_INPUT_MIN_WIDTH: 18,
    SIZE_VARIANCE_PX: 20,     // max width difference within a cluster
    MAX_SELECTOR_RETRIES: 3,     // attempts to generate unique selector
} as const;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  OTP PAGE DETECTOR
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class OTPPageDetector {

    // ── Dependencies ──
    private readonly autoFiller: AutoFiller;
    private readonly formDetector: FormDetector;

    // ── State ──
    private verdict: PageVerdict = 'not-otp';
    private confidence = 0;
    private fields: OTPField[] = [];
    private lastUrl = '';
    private destroyed = false;

    // ── AI fallback guards ──
    private aiRequested = false;
    private aiResponded = false;

    // ── Scheduling ──
    private debounceTimer: ReturnType<typeof setTimeout> | null = null;
    private lastRunTime = 0;

    // ── Observers & listeners (tracked for cleanup) ──
    private mutationObserver: MutationObserver | null = null;
    private focusHandler: ((e: FocusEvent) => void) | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private messageHandler: ((msg: any, sender: any, respond: (r?: any) => void) => boolean | void) | null = null;
    private popstateHandler: (() => void) | null = null;

    // ── Metrics ──
    private readonly metrics: DetectionMetrics = {
        runsTotal: 0,
        runsPositive: 0,
        avgDurationMs: 0,
        lastVerdict: 'not-otp',
        lastConfidence: 0,
        fieldsFound: 0,
        otpsFilled: 0,
        otpsFillFailed: 0,
        aiRequested: false,
        aiResponded: false,
    };

    // ── Context caches (invalidated on navigation) ──
    private cachedBodyKeyword: boolean | null = null;
    private cachedTitleKeyword: boolean | null = null;
    private cachedUrlKeyword: boolean | null = null;

    constructor(autoFiller: AutoFiller, formDetector: FormDetector) {
        this.autoFiller = autoFiller;
        this.formDetector = formDetector;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  LIFECYCLE
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    init(): void {
        if (this.destroyed) { return; }

        this.lastUrl = location.href;


        this.installMutationObserver();
        this.installFocusListener();
        this.installNavigationWatcher();

        // Initial detection (slight delay for DOM hydration)
        setTimeout(() => {
            if (!this.destroyed) { this.scheduleDetection('init'); }
        }, CONFIG.INITIAL_DELAY_MS);

        log.debug('OTP Detector initialized');
    }

    destroy(): void {
        this.destroyed = true;

        // Cancel pending detection
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }

        // Mutation observer
        if (this.mutationObserver) {
            this.mutationObserver.disconnect();
            this.mutationObserver = null;
        }

        // Focus listener
        if (this.focusHandler) {
            document.removeEventListener('focusin', this.focusHandler, true);
            this.focusHandler = null;
        }

        // Navigation
        if (this.popstateHandler) {
            window.removeEventListener('popstate', this.popstateHandler);
            this.popstateHandler = null;
        }

        // Remove any lingering toast
        document.getElementById('ghostfill-otp-toast')?.remove();

        // Notify background if we were on an OTP page
        if (this.verdict !== 'not-otp') {
            this.notifyBackground('OTP_PAGE_LEFT');
        }

        log.debug('OTP Detector destroyed', this.getMetrics());
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  LISTENER INSTALLATION
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━



    private installMutationObserver(): void {
        this.mutationObserver = new MutationObserver((mutations) => {
            if (this.destroyed) { return; }

            // Only re-detect if mutations are relevant (added/removed nodes or attribute changes on inputs)
            const relevant = mutations.some((m) => {
                if (m.type === 'childList' && (m.addedNodes.length > 0 || m.removedNodes.length > 0)) {
                    return true;
                }
                if (m.type === 'attributes' && m.target instanceof HTMLInputElement) {
                    return true;
                }
                return false;
            });

            if (relevant) {
                this.invalidateContextCaches();
                this.scheduleDetection('mutation');
            }
        });

        this.mutationObserver.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: [
                'type', 'name', 'id', 'placeholder', 'maxlength',
                'autocomplete', 'inputmode', 'aria-label', 'style',
                'class', 'hidden', 'disabled',
            ],
        });
    }

    private installFocusListener(): void {
        this.focusHandler = (e: FocusEvent) => {
            if (this.destroyed) { return; }
            if (e.target instanceof HTMLInputElement) {
                this.scheduleDetection('focus');
            }
        };
        document.addEventListener('focusin', this.focusHandler, true);
    }

    private installNavigationWatcher(): void {
        // ── Intercept pushState / replaceState for SPA navigations ──
        const originalPush = history.pushState.bind(history);
        const originalReplace = history.replaceState.bind(history);

        history.pushState = (...args) => {
            originalPush(...args);
            this.onNavigate();
        };
        history.replaceState = (...args) => {
            originalReplace(...args);
            this.onNavigate();
        };

        this.popstateHandler = () => this.onNavigate();
        window.addEventListener('popstate', this.popstateHandler);
    }

    private onNavigate(): void {
        if (this.destroyed) { return; }
        const newUrl = location.href;
        if (newUrl === this.lastUrl) { return; }

        log.debug('Navigation detected', { from: this.lastUrl, to: newUrl });
        this.lastUrl = newUrl;
        this.resetForNavigation();
        this.scheduleDetection('navigation');
    }

    private resetForNavigation(): void {
        this.aiRequested = false;
        this.aiResponded = false;
        this.invalidateContextCaches();

        // If we were on an OTP page, notify we left
        if (this.verdict !== 'not-otp') {
            const prevVerdict = this.verdict;
            this.verdict = 'not-otp';
            this.confidence = 0;
            this.fields = [];

            if ((prevVerdict as string) !== 'not-otp') {
                this.notifyBackground('OTP_PAGE_LEFT');
            }
        }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  DETECTION SCHEDULER (debounced, throttled)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    private scheduleDetection(trigger: string): void {
        if (this.destroyed) { return; }

        // Throttle observer-triggered runs
        if (trigger === 'mutation') {
            const gap = Date.now() - this.lastRunTime;
            if (gap < CONFIG.OBSERVER_THROTTLE_MS) {
                // Schedule at the end of the throttle window
                if (this.debounceTimer) { clearTimeout(this.debounceTimer); }
                this.debounceTimer = setTimeout(
                    () => this.runDetection(trigger),
                    CONFIG.OBSERVER_THROTTLE_MS - gap,
                );
                return;
            }
        }

        // Debounce everything else
        if (this.debounceTimer) { clearTimeout(this.debounceTimer); }
        this.debounceTimer = setTimeout(
            () => this.runDetection(trigger),
            CONFIG.DEBOUNCE_MS,
        );
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  CORE — DETECTION RUN
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    private runDetection(trigger: string): void {
        if (this.destroyed) { return; }

        const t0 = performance.now();
        const result = this.detect();
        const ms = Math.round(performance.now() - t0);

        this.lastRunTime = Date.now();
        this.updateMetrics(result, ms);

        const prevVerdict = this.verdict;
        this.verdict = result.verdict;
        this.confidence = result.confidence;
        this.fields = result.fields;

        // ── State transitions ──
        if (this.verdict !== 'not-otp' && prevVerdict === 'not-otp') {
            log.info('✅ OTP page detected', {
                trigger,
                verdict: this.verdict,
                confidence: pct(this.confidence),
                fields: this.fields.length,
                ms,
            });
            this.notifyBackground('OTP_PAGE_DETECTED');
        } else if (this.verdict === 'not-otp' && prevVerdict !== 'not-otp') {
            log.info('OTP page status cleared', { trigger });
            this.notifyBackground('OTP_PAGE_LEFT');
        }

        // ── AI fallback ──
        if (
            !this.aiRequested &&
            this.verdict === 'not-otp' &&
            this.confidence >= AI_FALLBACK_THRESHOLD &&
            this.confidence < HIGH_CONFIDENCE
        ) {
            this.requestAIFallback();
        }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  SCORING ENGINE
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    private detect(): DetectionResult {
        const t0 = Date.now();
        const signals: SignalScore[] = [];
        const fieldMap = new Map<HTMLInputElement, OTPField>();

        // ────────────────────────────────────────────────────────
        //  1. Gather candidate inputs
        // ────────────────────────────────────────────────────────

        const allInputs = document.querySelectorAll<HTMLInputElement>(
            'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="image"]):not([type="reset"]):not([type="range"]):not([type="color"])',
        );
        const visibleInputs = Array.from(allInputs).filter((el) => isVisible(el));

        if (visibleInputs.length === 0) {
            return this.buildResult('not-otp', 0, [], signals, t0);
        }

        // ────────────────────────────────────────────────────────
        //  2. Per-input attribute scoring
        // ────────────────────────────────────────────────────────

        for (const input of visibleInputs) {
            let inputScore = 0;
            let bestSource: DetectionSource = 'maxlength-heuristic';

            // ── autocomplete="one-time-code" ──
            if (input.autocomplete === 'one-time-code') {
                inputScore += SIGNAL_WEIGHTS.AUTOCOMPLETE_OTC;
                bestSource = 'autocomplete-attr';
                pushSignal(signals, 'autocomplete=one-time-code', SIGNAL_WEIGHTS.AUTOCOMPLETE_OTC, true, selectorHint(input));
            }

            // ── inputmode="numeric" ──
            if (input.inputMode === 'numeric' || input.getAttribute('inputmode') === 'numeric') {
                inputScore += SIGNAL_WEIGHTS.INPUT_MODE_NUMERIC;
            }

            // ── name attribute ──
            if (input.name && matchesKeyword(input.name)) {
                inputScore += SIGNAL_WEIGHTS.NAME_OTP_KEYWORD;
                bestSource = 'name-attr';
                pushSignal(signals, `name="${input.name}"`, SIGNAL_WEIGHTS.NAME_OTP_KEYWORD, true);
            }

            // ── id attribute ──
            if (input.id && matchesKeyword(input.id)) {
                inputScore += SIGNAL_WEIGHTS.ID_OTP_KEYWORD;
                if (inputScore > (fieldMap.get(input)?.score ?? 0)) { bestSource = 'id-attr'; }
                pushSignal(signals, `id="${input.id}"`, SIGNAL_WEIGHTS.ID_OTP_KEYWORD, true);
            }

            // ── placeholder ──
            const ph = input.placeholder?.toLowerCase() ?? '';
            if (ph && OTP_CONTEXT_PHRASES.some((p) => ph.includes(p)) || matchesKeyword(ph)) {
                inputScore += SIGNAL_WEIGHTS.PLACEHOLDER_KEYWORD;
                if (inputScore > (fieldMap.get(input)?.score ?? 0)) { bestSource = 'placeholder-attr'; }
                pushSignal(signals, `placeholder="${truncate(input.placeholder, 30)}"`, SIGNAL_WEIGHTS.PLACEHOLDER_KEYWORD, true);
            }

            // ── aria-label ──
            const aria = input.getAttribute('aria-label')?.toLowerCase() ?? '';
            if (aria && matchesKeyword(aria)) {
                inputScore += SIGNAL_WEIGHTS.ARIA_LABEL_KEYWORD;
                if (inputScore > (fieldMap.get(input)?.score ?? 0)) { bestSource = 'aria-label-attr'; }
                pushSignal(signals, `aria-label match`, SIGNAL_WEIGHTS.ARIA_LABEL_KEYWORD, true);
            }

            // ── Associated <label> ──
            const labelText = this.getAssociatedLabelText(input);
            if (labelText && matchesKeyword(labelText)) {
                inputScore += SIGNAL_WEIGHTS.LABEL_KEYWORD;
                if (inputScore > (fieldMap.get(input)?.score ?? 0)) { bestSource = 'label-association'; }
                pushSignal(signals, `label="${truncate(labelText, 30)}"`, SIGNAL_WEIGHTS.LABEL_KEYWORD, true);
            }

            // ── maxlength 4-8 (single input) ──
            const ml = input.maxLength;
            if (ml >= 4 && ml <= 8) {
                inputScore += SIGNAL_WEIGHTS.MAXLENGTH_4_TO_8;
                pushSignal(signals, `maxlength=${ml}`, SIGNAL_WEIGHTS.MAXLENGTH_4_TO_8, true);
            }

            // ── Negative: search bar ──
            if (isSearchInput(input)) {
                inputScore += SIGNAL_WEIGHTS.SEARCH_BAR_LIKELY;
                pushSignal(signals, 'search-input-negative', SIGNAL_WEIGHTS.SEARCH_BAR_LIKELY, true);
            }

            if (inputScore > 0) {
                this.registerField(fieldMap, input, bestSource, inputScore);
            }
        }

        // ────────────────────────────────────────────────────────
        //  3. Split-digit group detection (contiguity analysis)
        // ────────────────────────────────────────────────────────

        const splitGroups = this.detectSplitDigitGroups(visibleInputs);

        for (const group of splitGroups) {
            const groupId = `split-${group[0]!.name || group[0]!.id || Math.random().toString(36).slice(2, 6)}`;

            pushSignal(signals, `split-digit-group (${group.length} inputs)`, SIGNAL_WEIGHTS.SPLIT_DIGIT_GROUP, true);

            group.forEach((input, idx) => {
                const existing = fieldMap.get(input);
                const score = (existing?.score ?? 0) + SIGNAL_WEIGHTS.SPLIT_DIGIT_GROUP;

                this.registerField(fieldMap, input, 'split-digit-group', score, {
                    groupId,
                    groupIndex: idx,
                    groupSize: group.length,
                });
            });
        }

        // ────────────────────────────────────────────────────────
        //  4. Small-input cluster detection
        // ────────────────────────────────────────────────────────

        const clusters = this.detectSmallInputClusters(visibleInputs);

        for (const cluster of clusters) {
            // Don't double-count if already found as split-digit
            const alreadyCounted = cluster.every((el) => {
                const f = fieldMap.get(el);
                return f?.source === 'split-digit-group';
            });
            if (alreadyCounted) { continue; }

            pushSignal(signals, `small-cluster (${cluster.length} inputs)`, SIGNAL_WEIGHTS.SMALL_CLUSTER, true);

            const groupId = `cluster-${Math.random().toString(36).slice(2, 6)}`;
            cluster.forEach((input, idx) => {
                const existing = fieldMap.get(input);
                const score = (existing?.score ?? 0) + SIGNAL_WEIGHTS.SMALL_CLUSTER;

                this.registerField(fieldMap, input, 'small-input-cluster', score, {
                    groupId,
                    groupIndex: idx,
                    groupSize: cluster.length,
                });
            });
        }

        // ────────────────────────────────────────────────────────
        //  5. FormDetector agreement
        // ────────────────────────────────────────────────────────

        try {
            const formAnalysis = this.formDetector.detectForms();

            for (const form of formAnalysis.forms) {
                if (form.formType === 'two-factor') {
                    pushSignal(signals, 'FormDetector: 2FA form', SIGNAL_WEIGHTS.FORM_DETECTOR_2FA, true);

                    for (const field of form.fields) {
                        if (field.fieldType === 'otp') {
                            const el = document.querySelector<HTMLInputElement>(field.selector);
                            if (el && isVisible(el)) {
                                const existing = fieldMap.get(el);
                                const score = (existing?.score ?? 0) + SIGNAL_WEIGHTS.FORM_DETECTOR_2FA;
                                this.registerField(fieldMap, el, 'form-detector', score);
                            }
                        }
                    }
                }
            }

            for (const field of formAnalysis.standaloneFields) {
                if (field.fieldType === 'otp') {
                    const el = document.querySelector<HTMLInputElement>(field.selector);
                    if (el && isVisible(el)) {
                        const existing = fieldMap.get(el);
                        const score = (existing?.score ?? 0) + SIGNAL_WEIGHTS.FORM_DETECTOR_2FA * 0.6;
                        this.registerField(fieldMap, el, 'form-detector', score);
                    }
                }
            }
        } catch (e) {
            log.debug('FormDetector error (non-fatal)', e);
        }

        // ────────────────────────────────────────────────────────
        //  6. AI container analysis (local, synchronous)
        // ────────────────────────────────────────────────────────

        if (fieldMap.size === 0) {
            const aiFields = this.aiContainerAnalysis(visibleInputs);
            for (const { input, groupId, groupIndex, groupSize } of aiFields) {
                pushSignal(signals, 'ai-container-analysis', SIGNAL_WEIGHTS.SMALL_CLUSTER, true);
                this.registerField(fieldMap, input, 'ai-container-analysis', SIGNAL_WEIGHTS.SMALL_CLUSTER, {
                    groupId,
                    groupIndex,
                    groupSize,
                });
            }
        }

        // ────────────────────────────────────────────────────────
        //  7. Page-level context signals
        // ────────────────────────────────────────────────────────

        const titleMatch = this.pageTitleHasKeyword();
        pushSignal(signals, 'page-title-keyword', SIGNAL_WEIGHTS.PAGE_TITLE_KEYWORD, titleMatch);

        const bodyMatch = this.pageBodyHasKeyword();
        pushSignal(signals, 'page-body-keyword', SIGNAL_WEIGHTS.BODY_TEXT_KEYWORD, bodyMatch);

        const urlMatch = this.pageUrlHasKeyword();
        pushSignal(signals, 'url-keyword', SIGNAL_WEIGHTS.URL_KEYWORD, urlMatch);

        // ── Negative: password field present ──
        const hasPassword = visibleInputs.some((i) => i.type === 'password');
        if (hasPassword) {
            pushSignal(signals, 'password-field-negative', SIGNAL_WEIGHTS.LOGIN_FORM_PRESENT, true);
        }

        // ────────────────────────────────────────────────────────
        //  8. Composite confidence
        // ────────────────────────────────────────────────────────

        // Field-level: best individual field score (capped at 1.0)
        let fieldConfidence = 0;
        for (const field of fieldMap.values()) {
            fieldConfidence = Math.max(fieldConfidence, field.score);
        }
        fieldConfidence = clamp(fieldConfidence, 0, 1);

        // Page-level: sum of matching context signals
        let contextScore = 0;
        if (titleMatch) { contextScore += SIGNAL_WEIGHTS.PAGE_TITLE_KEYWORD; }
        if (bodyMatch) { contextScore += SIGNAL_WEIGHTS.BODY_TEXT_KEYWORD; }
        if (urlMatch) { contextScore += SIGNAL_WEIGHTS.URL_KEYWORD; }
        if (hasPassword) { contextScore += SIGNAL_WEIGHTS.LOGIN_FORM_PRESENT; }
        contextScore = clamp(contextScore, -0.3, 0.3);

        const composite = clamp(fieldConfidence + contextScore, 0, 1);

        // ── Verdict ──
        const fields = Array.from(fieldMap.values()).sort((a, b) => b.score - a.score);

        let verdict: PageVerdict;
        if (fields.length > 0 && composite >= HIGH_CONFIDENCE) {
            verdict = 'otp-page';
        } else if (fields.length > 0 && composite >= CONFIDENCE_THRESHOLD) {
            verdict = 'possible-otp';
        } else if (composite >= AI_FALLBACK_THRESHOLD && contextScore > 0) {
            verdict = 'possible-otp';
        } else {
            verdict = 'not-otp';
        }

        return this.buildResult(verdict, composite, fields, signals, t0);
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  SPLIT-DIGIT GROUP DETECTION (contiguity-aware)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    private detectSplitDigitGroups(inputs: HTMLInputElement[]): HTMLInputElement[][] {
        const candidates = inputs.filter((i) => {
            const ml = i.maxLength;
            return ml === 1 && !isSearchInput(i);
        });

        if (candidates.length < CONFIG.SPLIT_DIGIT_MIN) { return []; }

        // Build contiguous runs: inputs whose DOM positions are "near" each other
        const groups: HTMLInputElement[][] = [];
        let currentGroup: HTMLInputElement[] = [];

        for (let i = 0; i < candidates.length; i++) {
            const el = candidates[i]!;

            if (currentGroup.length === 0) {
                currentGroup.push(el);
                continue;
            }

            const prev = currentGroup[currentGroup.length - 1]!;

            // Contiguity: share a common ancestor within 3 levels, or are adjacent siblings
            if (this.areContiguous(prev, el)) {
                currentGroup.push(el);
            } else {
                // Flush previous group if valid
                if (
                    currentGroup.length >= CONFIG.SPLIT_DIGIT_MIN &&
                    currentGroup.length <= CONFIG.SPLIT_DIGIT_MAX
                ) {
                    groups.push([...currentGroup]);
                }
                currentGroup = [el];
            }
        }

        // Flush last group
        if (
            currentGroup.length >= CONFIG.SPLIT_DIGIT_MIN &&
            currentGroup.length <= CONFIG.SPLIT_DIGIT_MAX
        ) {
            groups.push(currentGroup);
        }

        return groups;
    }

    /**
     * Two inputs are "contiguous" if they share a common ancestor within 3 levels
     * and their bounding boxes are horizontally adjacent (within 80px gap).
     */
    private areContiguous(a: HTMLElement, b: HTMLElement): boolean {
        // Spatial check
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();

        const horizontalGap = Math.abs(rb.left - ra.right);
        const verticalDelta = Math.abs(rb.top - ra.top);

        if (horizontalGap > 80 || verticalDelta > 20) { return false; }

        // DOM proximity check (within 3 levels)
        for (let depth = 1; depth <= 3; depth++) {
            const ancestorA = nthAncestor(a, depth);
            const ancestorB = nthAncestor(b, depth);
            if (ancestorA && ancestorA === ancestorB) { return true; }
        }

        return false;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  SMALL-INPUT CLUSTER DETECTION
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    private detectSmallInputClusters(inputs: HTMLInputElement[]): HTMLInputElement[][] {
        const small = inputs.filter((i) => {
            const r = i.getBoundingClientRect();
            return (
                r.width >= CONFIG.SMALL_INPUT_MIN_WIDTH &&
                r.width <= CONFIG.SMALL_INPUT_MAX_WIDTH &&
                !isSearchInput(i)
            );
        });

        if (small.length < CONFIG.SPLIT_DIGIT_MIN) { return []; }

        // Group by shared parent (up to 2 levels)
        const parentMap = new Map<Element, HTMLInputElement[]>();

        for (const el of small) {
            const parent = el.parentElement?.parentElement ?? el.parentElement;
            if (!parent) { continue; }
            const list = parentMap.get(parent) ?? [];
            list.push(el);
            parentMap.set(parent, list);
        }

        const clusters: HTMLInputElement[][] = [];

        for (const group of parentMap.values()) {
            if (group.length < CONFIG.SPLIT_DIGIT_MIN || group.length > CONFIG.SPLIT_DIGIT_MAX) { continue; }

            // Verify equal width
            const widths = group.map((i) => i.getBoundingClientRect().width);
            const avg = widths.reduce((a, b) => a + b, 0) / widths.length;
            const uniform = widths.every((w) => Math.abs(w - avg) <= CONFIG.SIZE_VARIANCE_PX);

            if (uniform) {
                clusters.push(group);
            }
        }

        return clusters;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  AI CONTAINER ANALYSIS (local, no network)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    private aiContainerAnalysis(
        inputs: HTMLInputElement[],
    ): Array<{ input: HTMLInputElement; groupId: string; groupIndex: number; groupSize: number }> {
        const results: Array<{
            input: HTMLInputElement;
            groupId: string;
            groupIndex: number;
            groupSize: number;
        }> = [];

        // Look at every container with ≥ 4 inputs
        const containerMap = new Map<Element, HTMLInputElement[]>();

        for (const input of inputs) {
            // Walk up 3 levels
            let container: Element | null = input;
            for (let d = 0; d < 3 && container; d++) {
                container = container.parentElement;
            }
            if (!container) { continue; }

            const list = containerMap.get(container) ?? [];
            list.push(input);
            containerMap.set(container, list);
        }

        for (const [, group] of containerMap) {
            if (group.length < CONFIG.SPLIT_DIGIT_MIN || group.length > CONFIG.SPLIT_DIGIT_MAX) { continue; }

            // Verify visual similarity
            const widths = group.map((i) => i.getBoundingClientRect().width);
            const avg = widths.reduce((a, b) => a + b, 0) / widths.length;
            if (!widths.every((w) => Math.abs(w - avg) <= CONFIG.SIZE_VARIANCE_PX)) { continue; }

            // Verify no mixed types (text/tel/number only)
            const validTypes = new Set(['text', 'tel', 'number', '']);
            if (!group.every((i) => validTypes.has(i.type))) { continue; }

            const groupId = `ai-${Math.random().toString(36).slice(2, 6)}`;
            group.forEach((input, idx) => {
                results.push({ input, groupId, groupIndex: idx, groupSize: group.length });
            });
        }

        return results;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  PAGE CONTEXT (cached per navigation)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    private invalidateContextCaches(): void {
        this.cachedBodyKeyword = null;
        this.cachedTitleKeyword = null;
        this.cachedUrlKeyword = null;
    }

    private pageTitleHasKeyword(): boolean {
        if (this.cachedTitleKeyword !== null) { return this.cachedTitleKeyword; }
        const title = document.title.toLowerCase();
        this.cachedTitleKeyword = OTP_CONTEXT_PHRASES.some((p) => title.includes(p)) || matchesKeyword(title);
        return this.cachedTitleKeyword;
    }

    private pageBodyHasKeyword(): boolean {
        if (this.cachedBodyKeyword !== null) { return this.cachedBodyKeyword; }
        const text = (document.body.innerText ?? '').toLowerCase().substring(0, CONFIG.MAX_BODY_SCAN_CHARS);
        this.cachedBodyKeyword = OTP_CONTEXT_PHRASES.some((p) => text.includes(p));
        return this.cachedBodyKeyword;
    }

    private pageUrlHasKeyword(): boolean {
        if (this.cachedUrlKeyword !== null) { return this.cachedUrlKeyword; }
        const url = location.href.toLowerCase();
        this.cachedUrlKeyword = matchesKeyword(url);
        return this.cachedUrlKeyword;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  LABEL ASSOCIATION
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    private getAssociatedLabelText(input: HTMLInputElement): string {
        // 1. Explicit label[for]
        if (input.id) {
            const label = document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(input.id)}"]`);
            if (label) { return label.textContent?.toLowerCase() ?? ''; }
        }

        // 2. Wrapping <label>
        const wrapping = input.closest('label');
        if (wrapping) { return wrapping.textContent?.toLowerCase() ?? ''; }

        // 3. aria-labelledby
        const labelledBy = input.getAttribute('aria-labelledby');
        if (labelledBy) {
            const el = document.getElementById(labelledBy);
            if (el) { return el.textContent?.toLowerCase() ?? ''; }
        }

        return '';
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  VERIFIED SELECTOR GENERATION
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    private generateVerifiedSelector(el: HTMLInputElement): string {
        const strategies = [
            // Strategy 1: ID
            () => {
                if (!el.id) { return null; }
                const sel = `#${CSS.escape(el.id)}`;
                return this.verifySelector(sel, el) ? sel : null;
            },

            // Strategy 2: name
            () => {
                if (!el.name) { return null; }
                const sel = `input[name="${CSS.escape(el.name)}"]`;
                return this.verifySelector(sel, el) ? sel : null;
            },

            // Strategy 3: autocomplete + type
            () => {
                if (el.autocomplete === 'one-time-code') {
                    const sel = `input[autocomplete="one-time-code"]`;
                    return this.verifySelector(sel, el) ? sel : null;
                }
                return null;
            },

            // Strategy 4: data attributes
            () => {
                for (const attr of el.attributes) {
                    if (attr.name.startsWith('data-') && attr.value) {
                        const sel = `input[${attr.name}="${CSS.escape(attr.value)}"]`;
                        if (this.verifySelector(sel, el)) { return sel; }
                    }
                }
                return null;
            },

            // Strategy 5: clean class names (max 2)
            () => {
                if (!el.className || typeof el.className !== 'string') { return null; }
                const valid = el.className
                    .split(/\s+/)
                    .filter((c) => c.length > 1 && /^[a-zA-Z_-][\w-]*$/.test(c))
                    .slice(0, 2);
                if (valid.length === 0) { return null; }
                const sel = `input.${valid.map(CSS.escape).join('.')}`;
                return this.verifySelector(sel, el) ? sel : null;
            },

            // Strategy 6: nth-of-type scoped to parent
            () => {
                const parent = el.parentElement;
                if (!parent) { return null; }

                const siblings = Array.from(parent.querySelectorAll(':scope > input'));
                const idx = siblings.indexOf(el);
                if (idx < 0) { return null; }

                // Build parent selector
                let parentSel = '';
                if (parent.id) {
                    parentSel = `#${CSS.escape(parent.id)}`;
                } else if (parent.className && typeof parent.className === 'string') {
                    const cls = parent.className.split(/\s+/).filter((c) => /^[a-zA-Z_-][\w-]*$/.test(c)).slice(0, 1);
                    if (cls.length > 0) { parentSel = `.${CSS.escape(cls[0]!)}`; }
                }

                const sel = parentSel
                    ? `${parentSel} > input:nth-of-type(${idx + 1})`
                    : `input:nth-of-type(${idx + 1})`;
                return this.verifySelector(sel, el) ? sel : null;
            },

            // Strategy 7: absolute fallback using path
            () => {
                const path = this.buildDomPath(el);
                return path;
            },
        ];

        for (const strategy of strategies) {
            try {
                const sel = strategy();
                if (sel) { return sel; }
            } catch {
                // Move to next strategy
            }
        }

        // Should never reach here, but just in case
        return `input[type="${el.type || 'text'}"]`;
    }

    /**
     * Verify a selector resolves to the expected element.
     */
    private verifySelector(selector: string, expected: HTMLInputElement): boolean {
        try {
            const found = document.querySelector<HTMLInputElement>(selector);
            return found === expected;
        } catch {
            return false;        // Invalid selector syntax
        }
    }

    /**
     * Build a DOM path selector as absolute fallback.
     * e.g. `body > div:nth-child(2) > form > div > input:nth-child(1)`
     */
    private buildDomPath(el: HTMLElement): string {
        const parts: string[] = [];
        let current: HTMLElement | null = el;

        while (current && current !== document.body) {
            const parent = current.parentElement as HTMLElement | null;
            if (!parent) { break; }

            const tag = current.tagName.toLowerCase();
            const siblings = Array.from(parent.children);
            const index = siblings.indexOf(current) + 1;

            parts.unshift(`${tag}:nth-child(${index})`);
            current = parent;
        }

        parts.unshift('body');
        return parts.join(' > ');
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  FIELD REGISTRATION
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    private registerField(
        map: Map<HTMLInputElement, OTPField>,
        input: HTMLInputElement,
        source: DetectionSource,
        score: number,
        group?: { groupId: string; groupIndex: number; groupSize: number },
    ): void {
        const existing = map.get(input);

        if (existing) {
            // Update: keep highest score and best source, merge group info
            if (score > existing.score) {
                existing.score = score;
                existing.source = source;
            }
            if (group && !existing.groupId) {
                existing.groupId = group.groupId;
                existing.groupIndex = group.groupIndex;
                existing.groupSize = group.groupSize;
            }
            return;
        }

        const selector = this.generateVerifiedSelector(input);

        map.set(input, {
            element: input,
            selector,
            source,
            score: clamp(score, 0, 1),
            groupId: group?.groupId ?? null,
            groupIndex: group?.groupIndex ?? 0,
            groupSize: group?.groupSize ?? 1,
            maxLength: input.maxLength > 0 ? input.maxLength : -1,
            inputMode: input.inputMode || input.getAttribute('inputmode') || '',
            visible: true,
        });
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  AI FALLBACK (background, async)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    private async requestAIFallback(): Promise<void> {
        this.aiRequested = true;
        this.metrics.aiRequested = true;

        log.info('🤖 Requesting AI OTP detection (confidence in grey zone)', {
            confidence: pct(this.confidence),
        });

        try {
            const snapshot = this.buildDOMSnapshot();
            const response = await safeSendMessage({
                action: 'ANALYZE_DOM',
                payload: { simplifiedDOM: snapshot },
            }) as { success: boolean; result?: { confidence?: number } } | undefined;

            this.aiResponded = true;
            this.metrics.aiResponded = true;

            if (response?.success && response.result?.confidence && response.result.confidence >= 0.7) {
                log.info('✅ AI confirmed OTP page', { confidence: response.result.confidence });
                // Re-run detection — the next cycle will incorporate any new attributes
                this.scheduleDetection('ai-response');
            } else {
                log.debug('AI did not confirm OTP page');
            }
        } catch (error) {
            log.warn('AI fallback failed', error);
        }
    }

    private buildDOMSnapshot(): string {
        const parts: string[] = [];

        const forms = document.querySelectorAll('form');
        forms.forEach((form) => {
            parts.push(form.outerHTML.substring(0, 2000));
        });

        const orphanInputs = document.querySelectorAll<HTMLInputElement>('input:not([type="hidden"])');
        orphanInputs.forEach((input) => {
            if (!input.closest('form')) {
                parts.push(input.outerHTML);
            }
        });

        return parts.join('\n').substring(0, CONFIG.MAX_DOM_SNAPSHOT_CHARS);
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  AUTO-FILL HANDLER
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    public async handleAutoFill(payload: { otp: string; source: string; confidence: number }): Promise<void> {
        const { otp, source, confidence } = payload;

        log.info('📥 AUTO_FILL_OTP received', {
            source,
            confidence: pct(confidence),
            hasFields: this.fields.length > 0,
        });

        // If we haven't detected fields yet, run detection immediately
        if (this.fields.length === 0) {
            this.runDetection('auto-fill-trigger');
        }

        const selectors = this.fields.map((f) => f.selector);

        const success = await this.autoFiller.fillOTP(otp, selectors);

        if (success) {
            this.metrics.otpsFilled++;
            log.info('✅ OTP filled successfully');
            this.showFeedbackToast(otp, source);
        } else {
            this.metrics.otpsFillFailed++;
            log.warn('❌ OTP fill failed — no matching inputs');
        }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  TOAST FEEDBACK
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    private showFeedbackToast(otp: string, source: string): void {
        // Remove existing
        document.getElementById('ghostfill-otp-toast')?.remove();

        const masked = otp.length > 2
            ? '●'.repeat(otp.length - 2) + otp.slice(-2)
            : '●'.repeat(otp.length);

        const sourceLabel = source === 'url-extracted' ? 'from link' : 'from email';

        const container = document.createElement('div');
        container.id = 'ghostfill-otp-toast';
        container.setAttribute('role', 'status');
        container.setAttribute('aria-live', 'polite');

        // Shadow DOM to avoid style leakage in either direction
        const shadow = container.attachShadow({ mode: 'closed' });

        const STYLES = `
            :host {
                position: fixed;
                top: 20px;
                right: 20px;
                z-index: 2147483647;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                pointer-events: none;
            }
            .toast {
                background: linear-gradient(135deg, #6366F1, #8B5CF6);
                color: #fff;
                padding: 14px 20px;
                border-radius: 12px;
                box-shadow: 0 10px 40px rgba(99, 102, 241, 0.4);
                font-size: 14px;
                display: flex;
                align-items: center;
                gap: 10px;
                max-width: 300px;
                animation: slideIn ${CONFIG.TOAST_ANIMATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1);
            }
            .toast.out {
                animation: slideOut ${CONFIG.TOAST_ANIMATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
            }
            .title { font-weight: 600; font-size: 13px; }
            .sub   { opacity: 0.85; font-size: 11px; font-family: monospace; margin-top: 2px; }
            svg    { flex-shrink: 0; }

            @keyframes slideIn {
                from { transform: translateX(120%); opacity: 0; }
                to   { transform: translateX(0);    opacity: 1; }
            }
            @keyframes slideOut {
                from { transform: translateX(0);    opacity: 1; }
                to   { transform: translateX(120%); opacity: 0; }
            }
        `;

        if ('adoptedStyleSheets' in (document as any)) {
            const sheet = new CSSStyleSheet();
            sheet.replaceSync(STYLES);
            (shadow as any).adoptedStyleSheets = [sheet];
            shadow.innerHTML = `
                <div class="toast">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                         stroke="currentColor" stroke-width="2.5">
                        <path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="10"/>
                    </svg>
                    <div>
                        <div class="title">OTP Auto-Filled ✓</div>
                        <div class="sub">${masked} · ${sourceLabel}</div>
                    </div>
                </div>
            `;
        } else {
            shadow.innerHTML = `
                <style>${STYLES}</style>
                <div class="toast">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                         stroke="currentColor" stroke-width="2.5">
                        <path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="10"/>
                    </svg>
                    <div>
                        <div class="title">OTP Auto-Filled ✓</div>
                        <div class="sub">${masked} · ${sourceLabel}</div>
                    </div>
                </div>
            `;
        }

        document.body.appendChild(container);

        // Animate out, then remove
        setTimeout(() => {
            const toast = shadow.querySelector('.toast');
            if (toast) { toast.classList.add('out'); }

            setTimeout(() => container.remove(), CONFIG.TOAST_ANIMATION_MS);
        }, CONFIG.TOAST_DURATION_MS);
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  BACKGROUND NOTIFICATION
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    private async notifyBackground(action: 'OTP_PAGE_DETECTED' | 'OTP_PAGE_LEFT'): Promise<void> {
        let message: ExtensionMessage;

        if (action === 'OTP_PAGE_DETECTED') {
            message = {
                action,
                payload: {
                    url: location.href,
                    fieldCount: this.fields.length,
                    fieldSelectors: this.fields.map((f) => f.selector),
                    confidence: this.confidence,
                    verdict: this.verdict
                }
            } as ExtensionMessage;
        } else {
            message = { action } as ExtensionMessage;
        }

        try {
            await safeSendMessage(message);
        } catch (error) {
            log.warn('Background notification failed', { action, error });
        }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  RESULT BUILDER & METRICS
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    private buildResult(
        verdict: PageVerdict,
        confidence: number,
        fields: OTPField[],
        signals: SignalScore[],
        t0: number,
    ): DetectionResult {
        return {
            verdict,
            confidence,
            fields,
            signalBreakdown: signals,
            detectedAt: Date.now(),
            durationMs: Date.now() - t0,
        };
    }

    private updateMetrics(result: DetectionResult, ms: number): void {
        this.metrics.runsTotal++;
        if (result.verdict !== 'not-otp') { this.metrics.runsPositive++; }
        this.metrics.lastVerdict = result.verdict;
        this.metrics.lastConfidence = result.confidence;
        this.metrics.fieldsFound = result.fields.length;

        // EMA (α = 0.2)
        this.metrics.avgDurationMs =
            this.metrics.avgDurationMs === 0
                ? ms
                : this.metrics.avgDurationMs * 0.8 + ms * 0.2;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  PUBLIC — STATUS & DIAGNOSTICS
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    getStatus(): {
        isOTPPage: boolean;
        verdict: PageVerdict;
        confidence: number;
        fieldCount: number;
        selectors: string[];
        fields: ReadonlyArray<Omit<OTPField, 'element'>>;
    } {
        return {
            isOTPPage: this.verdict !== 'not-otp',
            verdict: this.verdict,
            confidence: this.confidence,
            fieldCount: this.fields.length,
            selectors: this.fields.map((f) => f.selector),
            fields: this.fields.map(({ element: _, ...rest }) => rest),
        };
    }

    getMetrics(): Readonly<DetectionMetrics> {
        return { ...this.metrics };
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  MODULE-LEVEL UTILITIES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function isVisible(el: HTMLElement): boolean {
    // Fast reject: zero dimensions
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) { return false; }

    // Walk up the tree (max 10 levels) checking computed style
    let current: HTMLElement | null = el;
    let depth = 0;

    while (current && depth < 10) {
        const style = window.getComputedStyle(current);
        if (
            style.display === 'none' ||
            style.visibility === 'hidden' ||
            style.opacity === '0'
        ) {
            return false;
        }
        current = current.parentElement;
        depth++;
    }

    return true;
}

function matchesKeyword(text: string): boolean {
    const lower = text.toLowerCase();
    // Split on non-alphanumeric to match tokens
    const tokens = lower.split(/[^a-z0-9]+/);
    return tokens.some((t) => OTP_KEYWORDS.has(t));
}

function isSearchInput(input: HTMLInputElement): boolean {
    if (input.type === 'search') { return true; }
    const attrs = [input.name, input.id, input.placeholder, input.getAttribute('aria-label') ?? ''].join(' ').toLowerCase();
    const tokens = attrs.split(/[^a-z0-9]+/);
    return tokens.some((t) => SEARCH_INDICATORS.has(t));
}

function nthAncestor(el: HTMLElement, n: number): HTMLElement | null {
    let current: HTMLElement | null = el;
    for (let i = 0; i < n && current; i++) {
        current = current.parentElement;
    }
    return current;
}

function pushSignal(
    arr: SignalScore[],
    signal: string,
    weight: number,
    matched: boolean,
    detail?: string,
): void {
    arr.push({ signal, weight, matched, detail });
}

function selectorHint(el: HTMLInputElement): string {
    return el.id ? `#${el.id}` : el.name ? `[name=${el.name}]` : el.tagName;
}

function clamp(v: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, v));
}

function pct(n: number): string {
    return `${Math.round(n * 100)}%`;
}

function truncate(s: string | undefined, max: number): string {
    if (!s) { return ''; }
    return s.length > max ? s.substring(0, max) + '…' : s;
}