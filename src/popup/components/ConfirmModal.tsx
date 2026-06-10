import { motion, AnimatePresence } from 'framer-motion';
import React, { useEffect, useId, useRef } from 'react';

interface ConfirmModalProps {
  readonly isOpen: boolean;
  readonly title: string;
  readonly message: string;
  readonly confirmText?: string;
  readonly cancelText?: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  readonly isDestructive?: boolean;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  onConfirm,
  onCancel,
  isDestructive = false,
}) => {
  const cancelBtnRef = useRef<HTMLButtonElement | null>(null);
  const modalRef = useRef<HTMLDivElement | null>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descId = useId();

  // Store active element before modal opens
  useEffect(() => {
    if (!isOpen) {
      // Restore focus to whatever was focused before the modal opened.
      previousActiveElementRef.current?.focus();
      return;
    }

    previousActiveElementRef.current = document.activeElement as HTMLElement | null;
    // Delay focus slightly to let the entry animation begin.
    const focusTimer = setTimeout(() => cancelBtnRef.current?.focus(), 50);
    return () => clearTimeout(focusTimer);
  }, [isOpen]);

  // Trap focus and listen for Escape key
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
        return;
      }

      if (e.key === 'Tab') {
        if (!modalRef.current) {
          return;
        }
        const focusableElements = modalRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusableElements.length === 0) {
          return;
        }

        const first = focusableElements[0];
        const last = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first && last) {
            last.focus();
            e.preventDefault();
          }
        } else {
          if (document.activeElement === last && first) {
            first.focus();
            e.preventDefault();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onCancel]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="modal-overlay"
          onClick={onCancel}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            ref={modalRef}
            className="memphis-card confirmation-modal"
            onClick={(e) => e.stopPropagation()}
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descId}
          >
            <h3 id={titleId}>{title}</h3>
            <p id={descId}>{message}</p>
            <div className="confirm-modal-actions">
              <motion.button
                ref={cancelBtnRef}
                className="ios-button button-secondary confirm-modal-btn"
                onClick={onCancel}
                whileHover={{ x: -1, y: -1 }}
                whileTap={{ x: 1, y: 1 }}
              >
                {cancelText}
              </motion.button>
              <motion.button
                className={`ios-button button-primary confirm-modal-btn${isDestructive ? ' button-primary--destructive' : ''}`}
                onClick={onConfirm}
                whileHover={{ x: -1, y: -1 }}
                whileTap={{ x: 1, y: 1 }}
              >
                {confirmText}
              </motion.button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
