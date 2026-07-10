import React from 'react';
import { cx } from './cx';

export type IconButtonVariant =
  | 'default'
  | 'primary'
  | 'danger'
  | 'success'
  | 'warning'
  | 'plain';

export type IconButtonSize = 'sm' | 'md';

export interface IconButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name required because the button has no visible text. */
  label: string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
}

/**
 * GhostFill shared UI primitives.
 *
 * Styling follows the Spectre design language:
 * graphite canvases, machined hairline surfaces, restrained elevation,
 * Iris accent and semantic status colors.
 */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    label,
    variant = 'default',
    size = 'md',
    className,
    children,
    title,
    type = 'button',
    ...rest
  },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={title ?? label}
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
