import { motion } from 'framer-motion';
import React from 'react';
import iconLogo from '../../assets/icons/icon48.png';

interface GhostLogoProps {
  size?: number;
  className?: string;
}

const GhostLogo: React.FC<GhostLogoProps> = React.memo(({ size = 24, className = '' }) => {
  // MotionConfig reducedMotion="never" in App.tsx handles this globally.
  // Do NOT call useReducedMotion() here — it reads the OS media query directly
  // and fires the "Reduced Motion enabled" DevTools warning every render.

  return (
    <motion.div
      className={`ghost-logo-container ${className}`}
      style={{
        width: size,
        height: size,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
      }}
      animate={{
        filter: [
          // Memphis Neon: magenta glow
          'drop-shadow(0 0 2px rgba(255, 59, 212, 0.1))',
          'drop-shadow(0 0 14px rgba(255, 59, 212, 0.8))',
          'drop-shadow(0 0 2px rgba(255, 59, 212, 0.1))',
        ],
      }}
      transition={{
        duration: 3.5,
        ease: 'easeInOut',
        repeat: Infinity,
      }}
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.94 }}
    >
      <motion.img
        src={iconLogo}
        alt="GhostFill Logo"
        className="ghost-logo-img"
        width={size}
        height={size}
        animate={{
          opacity: [0.82, 1, 0.82],
        }}
        transition={{
          duration: 2.8,
          ease: 'easeInOut',
          repeat: Infinity,
        }}
      />
    </motion.div>
  );
});
GhostLogo.displayName = 'GhostLogo';

export default GhostLogo;
