# GhostFill Shared UI Component Library Code Dump

This file contains the complete source code of all UI components located in the `src/shared/ui` directory.

---

## 1. Badge.tsx
```tsx
import React from 'react';
import { cx } from './cx';

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  mono?: boolean;
}

/** Small pill label / status chip. */
export const Badge: React.FC<BadgeProps> = ({
  tone = 'neutral',
  mono = false,
  className,
  children,
  ...rest
}) => (
  <span
    className={cx('gf-badge', tone !== 'neutral' && `gf-badge--${tone}`, mono && 'gf-badge--mono', className)}
    {...rest}
  >
    {children}
  </span>
);

export type DotTone = 'success' | 'warning' | 'danger' | 'accent';

/** Tiny status dot. */
export const Dot: React.FC<{ tone: DotTone; className?: string }> = ({ tone, className }) => (
  <span className={cx('gf-dot', `gf-dot--${tone}`, className)} aria-hidden />
);
```

---

## 2. Button.tsx
```tsx
import { Loader2 } from 'lucide-react';
import React from 'react';
import { cx } from './cx';

export type ButtonVariant = 'default' | 'primary' | 'danger' | 'soft' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

/**
 * Neo-brutalist button. Hover/press are CSS-driven (lift / press against the
 * hard offset shadow); see `.gf-btn` in shared/styles/primitives.css.
 */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'default',
    size = 'md',
    block = false,
    loading = false,
    leftIcon,
    rightIcon,
    className,
    children,
    disabled,
    ...rest
  },
  ref
) {
  return (
    <button
      ref={ref}
      className={cx(
        'gf-btn',
        variant !== 'default' && `gf-btn--${variant}`,
        size !== 'md' && `gf-btn--${size}`,
        block && 'gf-btn--block',
        className
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 size={16} className="gf-spin" aria-hidden /> : leftIcon}
      {children}
      {!loading && rightIcon}
    </button>
  );
});
```

---

## 3. Card.tsx
```tsx
import React from 'react';
import { cx } from './cx';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  interactive?: boolean;
  flush?: boolean;
  sunken?: boolean;
}

/** Neo-brutalist surface card (2px ink border, hard offset shadow). */
export const Card = React.forwardRef<HTMLDivElement, CardProps>(function Card(
  { interactive = false, flush = false, sunken = false, className, children, ...rest },
  ref
) {
  return (
    <div
      ref={ref}
      className={cx(
        'gf-card',
        interactive && 'gf-card--interactive',
        flush && 'gf-card--flush',
        sunken && 'gf-card--sunken',
        className
      )}
      {...rest}
    >
      {children}
    </div>
  );
});
```

---

## 4. cx.ts
```typescript
/** Tiny className joiner — filters out falsy values. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
```

---

## 5. EmptyState.tsx
```tsx
import React from 'react';
import { cx } from './cx';

export interface EmptyStateProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  icon?: React.ReactNode;
  title?: React.ReactNode;
  description?: React.ReactNode;
}

/** Centered empty / placeholder state. */
export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  className,
  children,
  ...rest
}) => (
  <div className={cx('gf-empty', className)} {...rest}>
    {icon}
    {title && <span className="gf-empty__title">{title}</span>}
    {description && <span className="gf-empty__desc">{description}</span>}
    {children}
  </div>
);
```

---

## 6. IconButton.tsx
```tsx
import React from 'react';
import { cx } from './cx';

export type IconButtonVariant = 'default' | 'primary' | 'danger' | 'success' | 'plain';
export type IconButtonSize = 'sm' | 'md';

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name — required, since the button has no text. */
  label: string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
}

/** Square neo-brutalist icon button. */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, variant = 'default', size = 'md', className, children, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={rest.title ?? label}
      className={cx(
        'gf-icon-btn',
        variant !== 'default' && `gf-icon-btn--${variant}`,
        size !== 'md' && `gf-icon-btn--${size}`,
        className
      )}
      {...rest}
    >
      {children}
    </button>
  );
});
```

---

## 7. index.ts
```typescript
/**
 * GhostFill shared UI primitives — the single, neo-brutalist component vocabulary
 * used by the popup and options surfaces. Styling lives in
 * src/shared/styles/primitives.css.
 */
export { Button } from './Button';
export type { ButtonProps, ButtonVariant, ButtonSize } from './Button';
export { IconButton } from './IconButton';
export type { IconButtonProps, IconButtonVariant, IconButtonSize } from './IconButton';
export { Card } from './Card';
export type { CardProps } from './Card';
export { Input, Field } from './Input';
export type { InputProps, FieldProps } from './Input';
export { Toggle } from './Toggle';
export type { ToggleProps } from './Toggle';
export { Badge, Dot } from './Badge';
export type { BadgeProps, BadgeTone, DotTone } from './Badge';
export { Spinner } from './Spinner';
export type { SpinnerProps } from './Spinner';
export { EmptyState } from './EmptyState';
export type { EmptyStateProps } from './EmptyState';
export { Modal } from './Modal';
export type { ModalProps } from './Modal';
export { Toast } from './Toast';
export type { ToastProps } from './Toast';
export { cx } from './cx';
export * from './motion';
```

---

## 8. Input.tsx
```tsx
import React from 'react';
import { cx } from './cx';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  mono?: boolean;
  invalid?: boolean;
  leftIcon?: React.ReactNode;
}

/** Neo-brutalist text input. Pass `leftIcon` to render a leading glyph. */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { mono = false, invalid = false, leftIcon, className, ...rest },
  ref
) {
  const input = (
    <input
      ref={ref}
      className={cx('gf-input', mono && 'gf-input--mono', invalid && 'gf-input--invalid', className)}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );

  if (!leftIcon) {
    return input;
  }

  return (
    <span className="gf-input-group">
      <span className="gf-input-group__icon" aria-hidden>
        {leftIcon}
      </span>
      {input}
    </span>
  );
});

export interface FieldProps {
  label?: React.ReactNode;
  htmlFor?: string;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

/** Label + control + hint/error wrapper. */
export const Field: React.FC<FieldProps> = ({ label, htmlFor, hint, error, className, children }) => (
  <div className={cx('gf-field', className)}>
    {label && (
      <label className="gf-field__label" htmlFor={htmlFor}>
        {label}
      </label>
    )}
    {children}
    {error ? (
      <span className="gf-field__error">{error}</span>
    ) : hint ? (
      <span className="gf-field__hint">{hint}</span>
    ) : null}
  </div>
);
```

---

## 9. Modal.tsx
```tsx
import { AnimatePresence, motion } from 'framer-motion';
import React, { useEffect } from 'react';
import { cx } from './cx';
import { springSoft } from './motion';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  labelledBy?: string;
  children?: React.ReactNode;
}

/**
 * Neo-brutalist modal: dimmed overlay + bordered card with a hard shadow.
 * Closes on overlay click and Escape. Focus management beyond this is the
 * caller's responsibility when a custom focus trap is needed.
 */
export const Modal: React.FC<ModalProps> = ({
  open,
  onClose,
  title,
  description,
  actions,
  className,
  labelledBy,
  children,
}) => {
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const titleId = labelledBy ?? (title ? 'gf-modal-title' : undefined);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="gf-modal__overlay"
          onClick={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className={cx('gf-modal', className)}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, scale: 0.95, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={springSoft}
          >
            {title && (
              <h2 id={titleId} className="gf-modal__title">
                {title}
              </h2>
            )}
            {description && <p className="gf-modal__desc">{description}</p>}
            {children}
            {actions && <div className="gf-modal__actions">{actions}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
```

---

## 10. motion.ts
```typescript
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
```

---

## 11. Spinner.tsx
```tsx
import { Loader2 } from 'lucide-react';
import React from 'react';
import { cx } from './cx';

export interface SpinnerProps {
  size?: number;
  className?: string;
  label?: string;
}

/** Spinning loader using the shared `gf-spin` keyframe. */
export const Spinner: React.FC<SpinnerProps> = ({ size = 18, className, label = 'Loading' }) => (
  <span className={cx('gf-spinner', className)} role="status" aria-label={label}>
    <Loader2 size={size} className="gf-spin" aria-hidden />
  </span>
);
```

---

## 12. Toast.tsx
```tsx
import { AnimatePresence, motion } from 'framer-motion';
import React from 'react';
import { springSoft } from './motion';

export interface ToastProps {
  message: string | null;
}

/** Bottom-centered transient toast. Render once near the app root. */
export const Toast: React.FC<ToastProps> = ({ message }) => (
  <AnimatePresence>
    {message && (
      <motion.div
        className="gf-toast"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        initial={{ opacity: 0, scale: 0.95, y: 20, x: '-50%' }}
        animate={{ opacity: 1, scale: 1, y: 0, x: '-50%' }}
        exit={{ opacity: 0, scale: 0.95, y: 20, x: '-50%' }}
        transition={springSoft}
      >
        {message}
      </motion.div>
    )}
  </AnimatePresence>
);
```

---

## 13. Toggle.tsx
```tsx
import React from 'react';
import { cx } from './cx';

export interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
}

/**
 * Accessible switch. A native <button> handles Enter/Space → click, so we wire
 * only onClick — avoiding the double-fire the old ToggleSwitch had (Space fired
 * onKeyDown *and* onClick).
 */
export const Toggle: React.FC<ToggleProps> = ({
  checked,
  onChange,
  disabled = false,
  id,
  className,
  ...aria
}) => (
  <button
    type="button"
    role="switch"
    id={id}
    aria-checked={checked}
    disabled={disabled}
    className={cx('gf-toggle', className)}
    onClick={() => onChange(!checked)}
    {...aria}
  />
);
```
