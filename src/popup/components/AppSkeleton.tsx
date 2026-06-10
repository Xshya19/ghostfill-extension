import { motion } from 'framer-motion';
import React from 'react';

const AppSkeleton = React.forwardRef<HTMLDivElement>((props, ref) => {
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="app-skeleton app-view-container"
      aria-hidden="true"
    >
      <div className="header skeleton-header-gap">
        <div className="header-left">
          <div className="skeleton-pulse app-skeleton-circle" />
          <div className="header-title-container skeleton-title-gap">
            <div className="skeleton-pulse app-skeleton-pill skeleton-w-80" />
            <div className="skeleton-pulse app-skeleton-pill skeleton-w-40" />
          </div>
        </div>
        <div className="header-actions">
          <div className="skeleton-pulse app-skeleton-circle skeleton-icon" />
        </div>
      </div>

      <div className="ghost-dashboard skeleton-dashboard-pad">
        <div className="memphis-card identity-card">
          <div className="identity-row">
            <div className="skeleton-pulse app-skeleton-circle skeleton-icon-lg" />
            <div className="identity-content skeleton-content-gap">
              <div className="skeleton-pulse app-skeleton-pill skeleton-w-60" />
              <div className="skeleton-pulse app-skeleton-pill skeleton-w-150" />
            </div>
            <div className="identity-actions skeleton-actions-gap">
              <div className="skeleton-pulse app-skeleton-circle skeleton-icon-sm" />
              <div className="skeleton-pulse app-skeleton-circle skeleton-icon-sm" />
            </div>
          </div>
          <div className="identity-row">
            <div className="skeleton-pulse app-skeleton-circle skeleton-icon-lg" />
            <div className="identity-content skeleton-content-gap">
              <div className="skeleton-pulse app-skeleton-pill skeleton-w-80" />
              <div className="skeleton-pulse app-skeleton-pill skeleton-w-120" />
            </div>
            <div className="identity-actions skeleton-actions-gap">
              <div className="skeleton-pulse app-skeleton-circle skeleton-icon-sm" />
              <div className="skeleton-pulse app-skeleton-circle skeleton-icon-sm" />
            </div>
          </div>
        </div>

        <div className="inbox-section skeleton-inbox-flex">
          <div className="inbox-header-row">
            <div className="inbox-title-group skeleton-title-gap">
              <div className="skeleton-pulse app-skeleton-circle skeleton-icon-md" />
              <div className="skeleton-pulse app-skeleton-pill skeleton-w-100" />
            </div>
            <div className="skeleton-pulse app-skeleton-pill skeleton-w-60" />
          </div>
          <div className="inbox-list skeleton-mt-10">
            <div className="shimmer hub-empty-state">
              <div className="skeleton-pulse app-skeleton-circle skeleton-icon-md" />
              <div className="skeleton-pulse app-skeleton-pill skeleton-w-80" />
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
});

AppSkeleton.displayName = 'AppSkeleton';

export default AppSkeleton;
