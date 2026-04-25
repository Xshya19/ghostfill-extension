/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  SENTINEL BRAIN — The Orchestrator                             ║
 * ║  The central nervous system of the Phase 3 architecture.       ║
 * ║  Connects detection, learning, navigation, and cross-frame UI.  ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

import { DetectedField } from '../types/sentinel';
import { createLogger } from '../utils/logger';
import { ActiveLearningController } from './active-learning/ActiveLearningController';
import { MultilingualKeywordEngine } from './heuristic/MultilingualKeywordEngine';
import { VisualStateTracker } from './heuristic/VisualStateTracker';
import { BayesianMetaLearner } from './meta/BayesianMetaLearner';
import { FeatureExtractorV2 } from './ml/FeatureExtractorV2';
import { MLService } from './ml/MLService';
import { AuthSessionTracker } from './navigator/AuthSessionTracker';
import { IFrameProxyV2 } from './navigator/IFrameProxyV2';
import { LayoutPatternDetector } from './spatial/LayoutPatternDetector';

const log = createLogger('SentinelBrain');

export class SentinelBrain {
  private static isInitialized = false;
  private static disabled = false;
  private static initPromise: Promise<void> | null = null;
  private static observer: MutationObserver | null = null;
  private static extractor = new FeatureExtractorV2();
  private static visualTracker = new VisualStateTracker();
  private static sprayDetector = new LayoutPatternDetector();

  /**
   * Initialize the Sentinel Brain and all its Grandmaster lobes.
   */
  static async init(): Promise<void> {
    if (this.isInitialized || this.disabled) {
      return;
    }
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      if (window.top !== window) {
        this.disabled = true;
        log.debug('Skipping Sentinel Brain init inside iframe');
        return;
      }

      if (!MLService.canUseRuntime()) {
        this.disabled = true;
        log.debug('Skipping Sentinel Brain init without extension runtime');
        return;
      }

      log.info('Initializing Sentinel Brain (Grandmaster Edition)...');

      // 1. Initialize ML Core
      await MLService.initialize();
      if (!MLService.isReady()) {
        this.disabled = true;
        log.debug('Sentinel Brain disabled because ML V2 is unavailable');
        return;
      }

      // 2. Setup IFrame Listeners (V2)
      IFrameProxyV2.init();

      // 3. Initialize Session & Meta-Learning
      await AuthSessionTracker.resume();

      this.setupMutationObserver();
      this.isInitialized = true;
      log.info('Sentinel Brain is online and thinking at 128-dim.');
    })();

    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  /**
   * Analyze a page and return high-confidence field detections.
   */
  static async analyze(elements: HTMLElement[]): Promise<DetectedField[]> {
    await this.init();
    if (this.disabled || !this.isInitialized) {
      return [];
    }

    const results: DetectedField[] = [];
    const domain = window.location.hostname;
    const url = window.location.href;
    const language = MultilingualKeywordEngine.detectPageLanguage();

    // ── Phase 1: Spatial & Context Scan ──
    const clusters = LayoutPatternDetector.detectClusters();

    // ── Phase 2: Per-Element Intelligence ──
    for (const el of elements) {
      const visual = this.visualTracker.getVisualState(el);
      if (!visual.isVisible) {
        continue;
      }

      // ML Inference
      const features = this.extractor.extract(el, {
        domain,
        url,
        isAuthPage: true,
        totalVisibleInputs: elements.length,
      });
      const mlResult = await MLService.predict(features);

      // Heuristic Checks
      const keywordResult = MultilingualKeywordEngine.detect(el, language);

      // ── Phase 3: Bayesian Fusion ──
      // Mapping to the ensemble structure expected by BayesianMetaLearner.fuse
      const layerOutputs: any = {
        ml: { [mlResult.type]: mlResult.confidence },
        heuristic: keywordResult,
        spatial: {
          [clusters.find((c) => c.elements.includes(el))?.layoutPattern || 'unknown']: 0.8,
        },
      };

      const fused = await BayesianMetaLearner.fuse(domain, layerOutputs);

      if (fused.type !== 'unknown' && fused.confidence > 0.4) {
        results.push({
          element: el,
          type: fused.type,
          confidence: fused.confidence,
          layer: 'ensemble',
          disagreement: fused.disagreement,
        });
      }

      // ── Phase 4: Active Learning ──
      if (fused.disagreement > 0.6) {
        ActiveLearningController.captureConflict(
          el,
          [mlResult, { type: 'heuristic', scores: keywordResult }],
          fused.disagreement
        );
      }
    }

    return results;
  }

  private static pulseTimeout: ReturnType<typeof setTimeout> | null = null;

  /**
   * Periodic re-scan triggered by DOM changes.
   */
  static async pulse(): Promise<void> {
    if (this.pulseTimeout) {
      clearTimeout(this.pulseTimeout);
    }

    this.pulseTimeout = setTimeout(async () => {
      log.info('Pulse executing: Analyzing dynamic DOM changes...');
      try {
        const inputs = Array.from(
          document.querySelectorAll('input, select, textarea')
        ) as HTMLElement[];
        if (inputs.length > 0) {
          await this.analyze(inputs);
        }
      } catch (e) {
        log.error('Pulse analysis failed', e);
      } finally {
        this.pulseTimeout = null;
      }
    }, 1200); // Debounce for 1.2s to prevent thrashing
  }

  private static setupMutationObserver(): void {
    if (this.observer) {
      return;
    }

    this.observer = new MutationObserver((mutations) => {
      if (mutations.some((m) => m.addedNodes.length > 0)) {
        this.pulse();
      }
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: false,
    });
  }
}

export default SentinelBrain;
