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
