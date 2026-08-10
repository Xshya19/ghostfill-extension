import { AnimatePresence, motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import React, { useEffect } from 'react';
import { springSoft } from './motion';

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

/* ── IconButton ─────────────────────────────────────────────────────────── */

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

/* ── Card ───────────────────────────────────────────────────────────────── */

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
