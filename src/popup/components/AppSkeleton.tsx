import React from 'react';
import { motion } from 'framer-motion';

const AppSkeleton: React.FC = () => {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="app-skeleton app-view-container"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        padding: '16px',
        width: '100%',
        height: '100%',
        position: 'absolute',
        top: 0,
        left: 0,
        zIndex: 10,
        background: 'var(--bg-primary)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', zIndex: 1 }}>
        <div className="skeleton-pulse" style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'var(--glass-border)' }} />
        <div className="skeleton-pulse" style={{ width: '120px', height: '20px', borderRadius: '4px', background: 'var(--glass-border)' }} />
        <div className="skeleton-pulse" style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'var(--glass-border)' }} />
      </div>
      
      <div className="skeleton-pulse" style={{ width: '100%', height: '140px', borderRadius: '16px', background: 'var(--glass-bg)', zIndex: 1 }} />
      <div className="skeleton-pulse" style={{ width: '100%', height: '80px', borderRadius: '16px', background: 'var(--glass-bg)', zIndex: 1 }} />
      
      <div style={{ display: 'flex', gap: '12px', marginTop: 'auto', zIndex: 1 }}>
        <div className="skeleton-pulse" style={{ flex: 1, height: '48px', borderRadius: '12px', background: 'var(--glass-bg)' }} />
        <div className="skeleton-pulse" style={{ flex: 1, height: '48px', borderRadius: '12px', background: 'var(--glass-bg)' }} />
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 1; }
        }
        .skeleton-pulse {
          animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }
      `}</style>
    </motion.div>
  );
};

export default AppSkeleton;
