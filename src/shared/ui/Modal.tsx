import {
  AnimatePresence,
  motion,
  useReducedMotion,
} from 'framer-motion';
import React, {
  useEffect,
  useId,
  useRef,
} from 'react';
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
  closeOnOverlay?: boolean;
  children?: React.ReactNode;
}

const focusableSelector = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * GhostFill shared UI primitives.
 *
 * Styling follows the Spectre design language:
 * graphite canvases, machined hairline surfaces, restrained elevation,
 * Iris accent and semantic status colors.
 */
export const Modal: React.FC<ModalProps> = ({
  open,
  onClose,
  title,
  description,
  actions,
  className,
  labelledBy,
  closeOnOverlay = true,
  children,
}) => {
  const generatedId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const reduceMotion = useReducedMotion();

  const titleId =
    labelledBy ?? (title ? `gf-modal-title-${generatedId}` : undefined);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';

    const frame = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      const firstFocusable =
        dialog?.querySelector<HTMLElement>(focusableSelector);

      (firstFocusable ?? dialog)?.focus();
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== 'Tab') {
        return;
      }

      const dialog = dialogRef.current;
      if (!dialog) {
        return;
      }

      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(focusableSelector)
      );

      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (!first || !last) {
        return;
      }

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);

    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKeyDown);
      document.documentElement.style.overflow = previousOverflow;
      restoreFocusRef.current?.focus();
    };
  }, [open, onClose]);

  const overlayTransition = reduceMotion
    ? { duration: 0 }
    : { duration: 0.16 };

  const dialogTransition = reduceMotion
    ? { duration: 0 }
    : springSoft;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="gf-modal__overlay"
          onClick={(event) => {
            if (
              closeOnOverlay &&
              event.target === event.currentTarget
            ) {
              onClose();
            }
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={overlayTransition}
        >
          <motion.div
            ref={dialogRef}
            className={cx('gf-modal', className)}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            initial={{ opacity: 0, scale: 0.95, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={dialogTransition}
          >
            {title && (
              <h2 id={titleId} className="gf-modal__title">
                {title}
              </h2>
            )}

            {description && (
              <p className="gf-modal__desc">{description}</p>
            )}

            {children}

            {actions && (
              <div className="gf-modal__actions">{actions}</div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
