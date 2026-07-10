import React from 'react';
import { cx } from './cx';

export interface EmptyStateProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  icon?: React.ReactNode;
  title?: React.ReactNode;
  description?: React.ReactNode;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  className,
  children,
  ...rest
}) => (
  <div className={cx('gf-empty', className)} {...rest}>
    {icon && (
      <span className="gf-empty__icon" aria-hidden>
        {icon}
      </span>
    )}

    {title && <span className="gf-empty__title">{title}</span>}

    {description && (
      <span className="gf-empty__desc">{description}</span>
    )}

    {children}
  </div>
);
