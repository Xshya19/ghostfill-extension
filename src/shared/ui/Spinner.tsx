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
