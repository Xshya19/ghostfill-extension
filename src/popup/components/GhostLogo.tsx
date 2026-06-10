import { motion } from 'framer-motion';
import React from 'react';

interface GhostLogoProps {
  size?: number;
  className?: string;
}

const wrapStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
};

const wobble = {
  rotate: [0, -10, 10, -6, 4, 0],
  transition: { duration: 0.55, ease: 'easeInOut' },
};

const press = { scale: 0.85 };

/**
 * GhostFill brand mark — inline SVG, Halcyon-themed.
 * Uses CSS custom properties so it adapts to both popup and settings themes.
 */
const GhostLogo: React.FC<GhostLogoProps> = React.memo(({ size = 24, className = '' }) => {
  return (
    <motion.div
      className={`ghost-logo-container ${className}`}
      style={wrapStyle as any}
      whileHover={wobble as any}
      whileTap={press as any}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className="ghost-logo-svg"
      >
        {/* Body — filled with current mustard/sienna accent via CSS */}
        <path
          className="ghost-body"
          d="M16 3C9.9 3 6 7.6 6 13v14l3.4-2.3 3.4 2.3 3.2-2.3 3.2 2.3 3.4-2.3L26 27V13C26 7.6 22.1 3 16 3z"
          fill="var(--gf-mustard, #FFAC10)"
          stroke="var(--gf-ink, #221A0F)"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        {/* Belly highlight — warm paper oval */}
        <ellipse cx="16" cy="16" rx="5.5" ry="6" fill="var(--gf-bg, #FFF8E1)" opacity="0.35" />
        {/* Left eye whites */}
        <circle cx="12.5" cy="13.5" r="2.2" fill="var(--gf-bg, #FFF8E1)" />
        {/* Left pupil */}
        <circle cx="12.8" cy="14" r="1" fill="var(--gf-ink, #221A0F)" />
        {/* Left eye glint */}
        <circle cx="13.3" cy="13.2" r="0.4" fill="var(--gf-bg, #FFF8E1)" />
        {/* Right eye whites */}
        <circle cx="19.5" cy="13.5" r="2.2" fill="var(--gf-bg, #FFF8E1)" />
        {/* Right pupil */}
        <circle cx="19.8" cy="14" r="1" fill="var(--gf-ink, #221A0F)" />
        {/* Right eye glint */}
        <circle cx="20.3" cy="13.2" r="0.4" fill="var(--gf-bg, #FFF8E1)" />
      </svg>
    </motion.div>
  );
});

GhostLogo.displayName = 'GhostLogo';
export default GhostLogo;
