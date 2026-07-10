import React from 'react';
import { cx } from './cx';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  interactive?: boolean;
  flush?: boolean;
  sunken?: boolean;
}

/**
 * GhostFill shared UI primitives.
 *
 * Styling follows the Spectre design language:
 * graphite canvases, machined hairline surfaces, restrained elevation,
 * Iris accent and semantic status colors.
 */
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
