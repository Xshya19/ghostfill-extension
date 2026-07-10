import {
  AnimatePresence,
  motion,
  useReducedMotion,
} from 'framer-motion';
import React from 'react';
import { springSoft } from './motion';

export interface ToastProps {
  message: string | null;
}

export const Toast: React.FC<ToastProps> = ({ message }) => {
  const reduceMotion = useReducedMotion();

  const transition = reduceMotion ? { duration: 0 } : springSoft;

  return (
    <AnimatePresence>
      {message && (
        <motion.div
          className="gf-toast"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          initial={{ opacity: 0, scale: 0.95, y: 20, x: '-50%' }}
          animate={{ opacity: 1, scale: 1, y: 0, x: '-50%' }}
          exit={{ opacity: 0, scale: 0.95, y: 20, x: '-50%' }}
          transition={transition}
        >
          {message}
        </motion.div>
      )}
    </AnimatePresence>
  );
};
