import { motion } from 'framer-motion';
import React from 'react';

const AppSkeleton: React.FC = () => {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="app-skeleton app-view-container"
      style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
    >
      {/* Header Skeleton */}
      <div className="header" style={{ borderBottom: '2px solid var(--gf-ink)', background: 'var(--gf-surface)', gap: '8px' }}>
        <div className="header-left">
          <div className="skeleton-pulse app-skeleton-circle" />
          <div className="header-title-container" style={{ gap: '4px' }}>
            <div className="skeleton-pulse app-skeleton-pill" style={{ width: '80px', height: '14px' }} />
            <div className="skeleton-pulse app-skeleton-pill" style={{ width: '40px', height: '10px' }} />
          </div>
        </div>
        <div className="header-actions">
          <div className="skeleton-pulse app-skeleton-circle" style={{ width: '28px', height: '28px', borderRadius: '4px' }} />
        </div>
      </div>

      {/* Main Content Dashboard Skeleton */}
      <div className="ghost-dashboard" style={{ flex: 1, padding: 'var(--space-2) var(--space-4) var(--space-3) var(--space-4)' }}>
        {/* Identity Card Skeleton */}
        <div className="glass-card identity-card" style={{ display: 'flex', flexDirection: 'column' }}>
          {/* Email Row Skeleton */}
          <div className="identity-row">
            <div className="skeleton-pulse app-skeleton-circle" style={{ width: '36px', height: '36px' }} />
            <div className="identity-content" style={{ gap: '4px' }}>
              <div className="skeleton-pulse app-skeleton-pill" style={{ width: '60px', height: '10px' }} />
              <div className="skeleton-pulse app-skeleton-pill" style={{ width: '150px', height: '14px' }} />
            </div>
            <div className="identity-actions" style={{ gap: '6px' }}>
              <div className="skeleton-pulse app-skeleton-circle" style={{ width: '24px', height: '24px', borderRadius: '4px' }} />
              <div className="skeleton-pulse app-skeleton-circle" style={{ width: '24px', height: '24px', borderRadius: '4px' }} />
            </div>
          </div>
          {/* Password Row Skeleton */}
          <div className="identity-row">
            <div className="skeleton-pulse app-skeleton-circle" style={{ width: '36px', height: '36px' }} />
            <div className="identity-content" style={{ gap: '4px' }}>
              <div className="skeleton-pulse app-skeleton-pill" style={{ width: '80px', height: '10px' }} />
              <div className="skeleton-pulse app-skeleton-pill" style={{ width: '120px', height: '14px' }} />
            </div>
            <div className="identity-actions" style={{ gap: '6px' }}>
              <div className="skeleton-pulse app-skeleton-circle" style={{ width: '24px', height: '24px', borderRadius: '4px' }} />
              <div className="skeleton-pulse app-skeleton-circle" style={{ width: '24px', height: '24px', borderRadius: '4px' }} />
            </div>
          </div>
        </div>

        {/* Inbox Section Skeleton */}
        <div className="inbox-section" style={{ flex: 1 }}>
          <div className="inbox-header-row">
            <div className="inbox-title-group" style={{ gap: '8px' }}>
              <div className="skeleton-pulse app-skeleton-circle" style={{ width: '22px', height: '22px', borderRadius: '4px' }} />
              <div className="skeleton-pulse app-skeleton-pill" style={{ width: '100px', height: '12px' }} />
            </div>
            <div className="skeleton-pulse app-skeleton-pill" style={{ width: '60px', height: '12px' }} />
          </div>
          <div className="inbox-list" style={{ marginTop: '10px' }}>
            <div className="shimmer hub-empty-state" style={{ borderStyle: 'dashed' }}>
              <div className="skeleton-pulse app-skeleton-circle" style={{ width: '18px', height: '18px', borderRadius: '50%' }} />
              <div className="skeleton-pulse app-skeleton-pill" style={{ width: '80px', height: '12px' }} />
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
};

export default AppSkeleton;
