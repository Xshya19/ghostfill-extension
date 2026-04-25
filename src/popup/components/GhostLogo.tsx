import { motion, useReducedMotion } from 'framer-motion';
import React from 'react';
import iconLogo from '../../assets/icons/icon48.png';

interface GhostLogoProps {
  size?: number;
  className?: string;
}

const GhostLogo: React.FC<GhostLogoProps> = React.memo(({ size = 24, className = '' }) => {
  const shouldReduceMotion = useReducedMotion();

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
      animate={
        shouldReduceMotion
          ? {}
          : {
              filter: [
                'drop-shadow(0 0 2px rgba(124, 92, 252, 0.1))',
                'drop-shadow(0 0 16px rgba(124, 92, 252, 0.7))',
                'drop-shadow(0 0 2px rgba(124, 92, 252, 0.1))',
              ],
            }
      }
      transition={
        shouldReduceMotion
          ? { duration: 0 }
          : {
              duration: 4,
              ease: 'easeInOut',
              repeat: Infinity,
            }
      }
      whileHover={shouldReduceMotion ? {} : { scale: 1.05 }}
      whileTap={shouldReduceMotion ? {} : { scale: 0.96 }}
    >
      <motion.img
        src={iconLogo}
        alt="GhostFill Logo"
        className="ghost-logo-img"
        width={size}
        height={size}
        animate={
          shouldReduceMotion
            ? {}
            : {
                opacity: [0.85, 1, 0.85],
              }
        }
        transition={
          shouldReduceMotion
            ? { duration: 0 }
            : {
                duration: 3,
                ease: 'easeInOut',
                repeat: Infinity,
              }
        }
      />
    </motion.div>
  );
});
GhostLogo.displayName = 'GhostLogo';

export default GhostLogo;
