import React from 'react';
import { cx } from './cx';

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
