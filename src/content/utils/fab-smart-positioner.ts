/**
 * fab-smart-positioner.ts — SmartPositioner
 *
 * Extracted from floatingButton.ts §4. Handles collision-aware spatial
 * placement of the FAB relative to its target input field and the viewport.
 */
import type { PositionConfig, MenuPositionConfig } from './fab-types';

const VIEWPORT_MARGIN = 8;
const OFF_SCREEN = -9999;
const Z_INDEX_BOOST = 100;
const ABSOLUTE_MAX_Z = 2147483647;

export class SmartPositioner {
  static calculate(field: HTMLElement, buttonSize: number): PositionConfig {
    const rect = field.getBoundingClientRect();

    const vv = window.visualViewport;
    const vw = vv ? vv.width : window.innerWidth;
    const vh = vv ? vv.height : window.innerHeight;
    const m = VIEWPORT_MARGIN;

    if (rect.bottom < 0 || rect.top > vh || rect.right < 0 || rect.left > vw) {
      return { left: OFF_SCREEN, top: OFF_SCREEN, placement: 'inside-right' };
    }

    const style = window.getComputedStyle(field);
    const paddingRight = parseFloat(style.paddingRight) || 0;
    const dynamicPadding = paddingRight > 24 ? paddingRight + 4 : 8;

    let left = rect.right - buttonSize - dynamicPadding;
    let top = rect.top + (rect.height - buttonSize) / 2;
    let placement: PositionConfig['placement'] = 'inside-right';

    if (rect.width < buttonSize + 32) {
      left = rect.right + m;
      placement = 'outside-right';
      if (left + buttonSize > vw - m) {
        left = rect.left - buttonSize - m;
        placement = 'outside-left';
      }
      if (left < m) {
        left = rect.left;
        top = rect.bottom + m;
        placement = 'below';
      }
    }

    left = Math.max(m, Math.min(left, vw - buttonSize - m));
    top = Math.max(m, Math.min(top, vh - buttonSize - m));

    return { left, top, placement };
  }

  static checkObstructions(left: number, top: number, size: number): boolean {
    if (left === OFF_SCREEN) {return false;}

    const points = [
      [left + 2, top + 2],
      [left + size - 2, top + 2],
      [left + 2, top + size - 2],
      [left + size - 2, top + size - 2],
      [left + size / 2, top + size / 2],
    ];

    for (const [x, y] of points) {
      try {
        const el = document.elementFromPoint(x!, y!);
        if (el) {
          if (el.closest('#ghostfill-fab') || el.closest('.gf-fab')) {continue;}
          const elStyle = window.getComputedStyle(el);
          if (elStyle.opacity === '0' || elStyle.pointerEvents === 'none') {continue;}
          const zIndex = parseInt(elStyle.zIndex, 10) || 0;
          if (zIndex > 1000) {return true;}
        }
      } catch { /* ignore points outside viewport */ }
    }
    return false;
  }

  /** H10: Cached z-index with 5-second TTL to avoid repeated 500-element DOM scans */
  private static _cachedMaxZ = 0;
  private static _cachedMaxZTs = 0;
  private static readonly Z_CACHE_TTL_MS = 5000;

  static getMaxZIndex(): number {
    const now = Date.now();
    if (this._cachedMaxZ > 0 && now - this._cachedMaxZTs < this.Z_CACHE_TTL_MS) {
      return this._cachedMaxZ;
    }
    try {
      const all = document.querySelectorAll('*');
      let max = 10000;
      for (let i = 0, len = Math.min(all.length, 500); i < len; i++) {
        const z = parseInt(window.getComputedStyle(all[i]!).zIndex, 10);
        if (!isNaN(z) && z > max && z < ABSOLUTE_MAX_Z) {max = z;}
      }
      const result = Math.min(max + Z_INDEX_BOOST, ABSOLUTE_MAX_Z);
      this._cachedMaxZ = result;
      this._cachedMaxZTs = now;
      return result;
    } catch {
      return ABSOLUTE_MAX_Z;
    }
  }

  static invalidateZCache(): void {
    this._cachedMaxZTs = 0;
  }

  static calculateMenuPosition(
    buttonRect: DOMRect,
    menuWidth: number,
    menuHeight: number
  ): MenuPositionConfig {
    const vh = window.innerHeight;
    const m = VIEWPORT_MARGIN;

    let top = `${buttonRect.height + 8}px`;
    let right = '0';
    let bottom = 'auto';
    let left = 'auto';
    let transformOrigin = 'top right';

    if (buttonRect.bottom + menuHeight + m > vh) {
      top = 'auto';
      bottom = `${buttonRect.height + 8}px`;
      transformOrigin = 'bottom right';
    }

    if (buttonRect.right - menuWidth < m) {
      right = 'auto';
      left = '0';
      transformOrigin = top !== 'auto' ? 'top left' : 'bottom left';
    }

    return { top, right, bottom, left, transformOrigin };
  }
}
