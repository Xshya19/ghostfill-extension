import { AnimatePresence, motion } from 'framer-motion';
import React, { useEffect } from 'react';
import { cx } from './cx';
import { springSoft } from './motion';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  labelledBy?: string;
  children?: React.ReactNode;
}

/**
 * Neo-brutalist modal: dimmed overlay + bordered card with a hard shadow.
 * Closes on overlay click and Escape. Focus management beyond this is the
 * caller's responsibility when a custom focus trap is needed.
 */
export const Modal: React.FC<ModalProps> = ({
  open,
  onClose,
  title,
  description,
  actions,
  className,
  labelledBy,
  children,
}) => {
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const titleId = labelledBy ?? (title ? 'gf-modal-title' : undefined);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="gf-modal__overlay"
          onClick={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className={cx('gf-modal', className)}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, scale: 0.95, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={springSoft}
          >
            {title && (
              <h2 id={titleId} className="gf-modal__title">
                {title}
              </h2>
            )}
            {description && <p className="gf-modal__desc">{description}</p>}
            {children}
            {actions && <div className="gf-modal__actions">{actions}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
