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
