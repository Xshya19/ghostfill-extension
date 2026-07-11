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
