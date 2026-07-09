/**
 * Motion system — centralized spring + tween definitions (shared).
 *
 * Single source of truth for every animation across the popup and options.
 * One motion language, two families: spring for organic motion (buttons,
 * toggles, FAB), tween for state changes (entrance, exit, route changes).
 *
 * Coupled to the CSS tokens in shared/styles/design-tokens.css:
 *   --gf-dur-fast = 140ms · --gf-dur = 200ms · --gf-dur-slow = 360ms
 *   --gf-ease-out = cubic-bezier(0.16, 1, 0.3, 1)
 *   --gf-ease     = cubic-bezier(0.22, 1, 0.36, 1)
 *   --gf-ease-back = cubic-bezier(0.34, 1.56, 0.64, 1)
 */
import type { Transition, Variants } from 'framer-motion';

/* ── Springs ─────────────────────────────────────────────────────── */

/** Default spring — buttons, toggles, FAB press. Fast, snappy. */
export const springDefault: Transition = {
  type: 'spring',
  stiffness: 380,
  damping: 35,
  mass: 0.8,
};

/** Soft spring — page transitions, list reorder, sheet enter. */
export const springSoft: Transition = {
  type: 'spring',
  stiffness: 260,
  damping: 28,
  mass: 0.85,
};

/** Tab pill spring — used for the sliding active-tab indicator (layoutId). */
export const springTab: Transition = {
  type: 'spring',
  stiffness: 320,
  damping: 28,
  mass: 0.85,
};

/** Per-digit spring — tight, snappy entrance for OTP characters. */
export const springDigit: Transition = {
  type: 'spring',
  stiffness: 300,
  damping: 15,
  mass: 0.7,
};

/** Playful spring with a small overshoot — success toasts, copy button. */
export const springBounce: Transition = {
  type: 'spring',
  stiffness: 500,
  damping: 22,
  mass: 0.65,
};

/* ── Tweens (state transitions) ─────────────────────────────────── */

/** Snappy entrance — toast, banner, modal. */
export const tweenIn: Transition = {
  duration: 0.22,
  ease: [0.16, 1, 0.3, 1],
};

/** Slow entrance — page-level fade. */
export const tweenFade: Transition = {
  duration: 0.32,
  ease: [0.22, 1, 0.36, 1],
};

/** Spring-back entrance. */
export const tweenBack: Transition = {
  duration: 0.4,
  ease: [0.34, 1.56, 0.64, 1],
};

/** Quick exit. */
export const tweenOut: Transition = {
  duration: 0.16,
  ease: [0.4, 0, 1, 1],
};

/** 1s smooth tween — used for the OTP timer bar width animation. */
export const tweenTimerBar: Transition = {
  duration: 1,
  ease: 'linear',
};

/* ── Hover / Press / Focus (the interactive vocabulary) ──────────── */

export const hoverLift = {
  y: -2,
  boxShadow: 'var(--gf-shadow-lg)',
  transition: { type: 'spring', stiffness: 480, damping: 22 } as Transition,
};

export const pressDown = {
  y: 1,
  boxShadow: 'var(--gf-shadow-sm)',
  transition: { type: 'spring', stiffness: 600, damping: 26 } as Transition,
};

export const rest = {
  y: 0,
  boxShadow: 'var(--gf-shadow)',
  transition: { type: 'spring', stiffness: 360, damping: 28 } as Transition,
};

export const fabHover = {
  scale: 1.06,
  rotate: -3,
  boxShadow: 'var(--gf-shadow-lg)',
  transition: { type: 'spring', stiffness: 480, damping: 20 } as Transition,
};

export const fabPress = {
  scale: 0.94,
  rotate: 0,
  boxShadow: 'var(--gf-shadow-sm)',
  transition: { type: 'spring', stiffness: 640, damping: 24 } as Transition,
};

/* ── Page / view transitions ────────────────────────────────────── */

export const viewFade: Variants = {
  initial: { opacity: 0, y: 8, scale: 0.99 },
  animate: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.28, ease: [0.16, 1, 0.3, 1] },
  },
  exit: {
    opacity: 0,
    y: -6,
    scale: 0.99,
    transition: { duration: 0.16, ease: [0.4, 0, 1, 1] },
  },
};

export const sheetUp: Variants = {
  initial: { opacity: 0, y: 24 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.32, ease: [0.16, 1, 0.3, 1] } },
  exit: { opacity: 0, y: 12, transition: { duration: 0.18, ease: [0.4, 0, 1, 1] } },
};

export const stagger: Variants = {
  animate: { transition: { staggerChildren: 0.04, delayChildren: 0.04 } },
};

export const itemRise: Variants = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.24, ease: [0.16, 1, 0.3, 1] } },
};

/** Drop-in <motion.button> whileHover/whileTap preset. */
export const interactiveSurface = {
  whileHover: hoverLift,
  whileTap: pressDown,
  initial: rest,
  animate: rest,
};
