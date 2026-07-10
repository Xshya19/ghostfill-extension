import { Loader2 } from 'lucide-react';
import React from 'react';
import { cx } from './cx';

export type ButtonVariant =
  | 'default'
  | 'primary'
  | 'danger'
  | 'success'
  | 'warning'
  | 'soft'
  | 'soft-success'
  | 'soft-warning'
  | 'soft-danger'
  | 'ghost';

export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  loading?: boolean;
  loadingLabel?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

/**
 * GhostFill shared UI primitives.
 *
 * Styling follows the Spectre design language:
 * graphite canvases, machined hairline surfaces, restrained elevation,
 * Iris accent and semantic status colors.
 */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = 'default',
      size = 'md',
      block = false,
      loading = false,
      loadingLabel = 'Loading',
      leftIcon,
      rightIcon,
      className,
      children,
      disabled,
      type = 'button',
      ...rest
    },
    ref
  ) {
    const isDisabled = Boolean(disabled || loading);

    return (
      <button
        ref={ref}
        type={type}
        disabled={isDisabled}
        className={cx(
          'gf-btn',
          variant !== 'default' && `gf-btn--${variant}`,
          size !== 'md' && `gf-btn--${size}`,
          block && 'gf-btn--block',
          className
        )}
        {...rest}
      >
        {loading ? (
          <Loader2 size={16} className="gf-spin" aria-hidden />
        ) : (
          leftIcon
        )}

        {loading ? loadingLabel : children}

        {!loading && rightIcon}
      </button>
    );
  }
);
