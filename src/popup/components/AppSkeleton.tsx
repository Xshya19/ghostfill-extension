import { motion } from 'framer-motion';
import React from 'react';

const AppSkeleton: React.FC = () => {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="app-skeleton app-view-container"
    >
      <div className="app-skeleton-header">
        <div className="skeleton-pulse app-skeleton-circle" />
        <div className="skeleton-pulse app-skeleton-pill" />
        <div className="skeleton-pulse app-skeleton-circle" />
      </div>

      <div className="skeleton-pulse app-skeleton-card app-skeleton-card-lg" />
      <div className="skeleton-pulse app-skeleton-card app-skeleton-card-md" />

      <div className="app-skeleton-actions">
        <div className="skeleton-pulse app-skeleton-action" />
        <div className="skeleton-pulse app-skeleton-action" />
      </div>
    </motion.div>
  );
};

export default AppSkeleton;
