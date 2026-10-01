/**
 * GhostFill shared UI — Apple-inspired component vocabulary + motion system.
 *
 * One module for both frontends (popup and options): the primitives
 * (Button, Card, Input, Modal, Toast, Toggle…) and the tween
 * definitions they animate with. Styling lives in frontend/styles/globals.css.
 *
 * Motion is coupled to the CSS tokens in frontend/styles/globals.css:
 *   --gf-dur-fast = 120ms · --gf-dur = 200ms · --gf-dur-slow = 340ms
 *   --gf-ease-out = cubic-bezier(0.16, 1, 0.3, 1)
 *   --gf-ease     = cubic-bezier(0.16, 1, 0.3, 1)
 */
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  type Transition,
  type Variants,
} from 'framer-motion';
import { Info, Loader2 } from 'lucide-react';
import React, { useEffect, useId, useRef } from 'react';

/** Short surface entrance; frequent control feedback belongs to CSS. */
export const tweenSurface: Transition = {
  type: 'tween',
  duration: 0.18,
  ease: [0.16, 1, 0.3, 1],
};

/* ── Tweens (state transitions) ─────────────────────────────────── */

/** Snappy entrance — toast, banner, modal. */
export const tweenIn: Transition = {
  duration: 0.22,
  ease: [0.16, 1, 0.3, 1],
};

/** Quick exit. */
export const tweenOut: Transition = {
  duration: 0.12,
  ease: [0.16, 1, 0.3, 1],
};

/* ── Page / view transitions ────────────────────────────────────── */

export const viewFade: Variants = {
  // Keep labels at their original size during the short view transition.
  initial: { opacity: 0, y: 6 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.17, ease: [0.16, 1, 0.3, 1] },
  },
  exit: {
    opacity: 0,
    y: -4,
    transition: { duration: 0.11, ease: [0.16, 1, 0.3, 1] },
  },
};

/** Tiny className joiner — filters out falsy values. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/* ── Badge & Dot ────────────────────────────────────────────────────────── */

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
    className={cx(
      'gf-badge',
      tone !== 'neutral' && `gf-badge--${tone}`,
      mono && 'gf-badge--mono',
      className
    )}
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

/* ── Button ────────────────────────────────────────────────────────────── */

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
 * Primary action button. Hover/press are CSS-driven (a 1px lift, then a press
 * back into the surface); see `.gf-btn` in shared/styles/primitives.css.
 */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'default',
    size = 'md',
    block = false,
    loading = false,
    type = 'button',
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
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Loader2 size={16} className="gf-spin" aria-hidden /> : leftIcon}
      {children}
      {!loading && rightIcon}
    </button>
  );
});

/* ── IconButton ─────────────────────────────────────────────────────────── */

export type IconButtonVariant = 'default' | 'primary' | 'danger' | 'success' | 'plain';
export type IconButtonSize = 'sm' | 'md';

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name — required, since the button has no text. */
  label: string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
}

/** Square icon-only button. */
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

/* ── Card ───────────────────────────────────────────────────────────────── */

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  interactive?: boolean;
  flush?: boolean;
  sunken?: boolean;
}

/** Machined surface card (hairline border, inset top highlight, soft shadow). */
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

/* ── EmptyState ─────────────────────────────────────────────────────────── */

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

/* ── Input & Field ──────────────────────────────────────────────────────── */

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  mono?: boolean;
  invalid?: boolean;
  leftIcon?: React.ReactNode;
}

/** Text input. Pass `leftIcon` to render a leading glyph. */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { mono = false, invalid = false, leftIcon, className, ...rest },
  ref
) {
  const input = (
    <input
      ref={ref}
      className={cx(
        'gf-input',
        mono && 'gf-input--mono',
        invalid && 'gf-input--invalid',
        className
      )}
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
export const Field: React.FC<FieldProps> = ({
  label,
  htmlFor,
  hint,
  error,
  className,
  children,
}) => (
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

/* ── Modal ──────────────────────────────────────────────────────────────── */

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
 * Modal: scrim + bordered card. Closes on overlay click and Escape. Focus
 * management beyond this is the caller's responsibility when a custom focus
 * trap is needed.
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
  const generatedTitleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) {
      return;
    }
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const focusableSelector =
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusable = dialog?.querySelectorAll<HTMLElement>(focusableSelector);
    const first = focusable?.[0] ?? dialog;
    if (dialog && !focusable?.length) {
      dialog.tabIndex = -1;
    }
    first?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
      } else if (e.key === 'Tab' && dialog) {
        const items = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector));
        if (items.length === 0) {
          e.preventDefault();
          dialog.focus();
          return;
        }
        const firstItem = items[0];
        const lastItem = items[items.length - 1];
        if (e.shiftKey && document.activeElement === firstItem) {
          e.preventDefault();
          lastItem?.focus();
        } else if (!e.shiftKey && document.activeElement === lastItem) {
          e.preventDefault();
          firstItem?.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previouslyFocused?.focus();
    };
  }, [open]);

  const titleId = labelledBy ?? (title ? generatedTitleId : undefined);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="gf-modal__overlay"
          onClick={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { duration: 0.14 } }}
          exit={{ opacity: 0, transition: { duration: 0.1 } }}
        >
          <motion.div
            ref={dialogRef}
            className={cx('gf-modal', className)}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={description ? descriptionId : undefined}
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, scale: 0.95, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={tweenSurface}
          >
            {title && (
              <h2 id={generatedTitleId} className="gf-modal__title">
                {title}
              </h2>
            )}
            {description && (
              <p id={descriptionId} className="gf-modal__desc">
                {description}
              </p>
            )}
            {children}
            {actions && <div className="gf-modal__actions">{actions}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

/* ── Spinner ────────────────────────────────────────────────────────────── */

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

/* ── Toast ──────────────────────────────────────────────────────────────── */

export interface ToastProps {
  message: string | null;
  revision?: number;
}

/** One nonblocking capsule; repeated feedback updates the persistent live region. */
export const Toast: React.FC<ToastProps> = ({ message, revision }) => {
  const reducedMotion = useReducedMotion();
  return (
    <>
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {message && <span key={revision ?? message}>{message}</span>}
      </span>
      <div className="gf-toast-viewport" aria-hidden="true">
        <AnimatePresence>
          {message && (
            <motion.div
              className="gf-toast"
              initial={{
                opacity: 0,
                transform: reducedMotion ? 'none' : 'translateY(8px) scale(0.98)',
              }}
              animate={{ opacity: 1, transform: 'none' }}
              exit={{
                opacity: 0,
                transform: reducedMotion ? 'none' : 'translateY(4px) scale(0.99)',
                transition: { duration: 0.1 },
              }}
              transition={{
                type: 'tween',
                duration: reducedMotion ? 0.08 : 0.2,
                ease: [0.16, 1, 0.3, 1],
              }}
            >
              <Info className="gf-toast__icon" size={18} />
              <span className="gf-toast__message">{message}</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
};

/* ── Toggle ─────────────────────────────────────────────────────────────── */

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
