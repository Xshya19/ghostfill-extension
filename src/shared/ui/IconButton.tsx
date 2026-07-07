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
