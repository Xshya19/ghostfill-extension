import React, { useEffect, useRef, useState, useCallback, useId } from 'react';

export interface CustomSelectOption {
  value: string;
  label: string;
}

interface CustomSelectProps {
  id?: string | undefined;
  value: string;
  onChange: (value: string) => void;
  options: CustomSelectOption[];
  ariaLabel?: string | undefined;
  ariaDescribedBy?: string | undefined;
  disabled?: boolean | undefined;
}

/**
 * Accessible custom select that replaces the native <select> popup.
 *
 * Why not native? The native dropdown is OS-rendered: it cannot inherit the
 * app's border-radius, cannot use the indigo hover, and in dark mode it
 * still paints white unless color-scheme is perfect — the exact mismatch
 * captured in the screenshot (rounded purple trigger floating above a
 * sharp-cornered white-bordered panel with OS blue hover). This component
 * renders the panel in-DOM so it shares the same tokens, radius, and
 * shadow as every other card.
 *
 * Keeps full keyboard support: ArrowUp/Down, Home/End, Enter, Space,
 * Escape, and type-ahead is left to the browser's native <select>
 * fallback only when JS is disabled (not applicable here).
 */
export const CustomSelect: React.FC<CustomSelectProps> = ({
  id,
  value,
  onChange,
  options,
  ariaLabel,
  ariaDescribedBy,
  disabled = false,
}) => {
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(() =>
    Math.max(0, options.findIndex((o) => o.value === value))
  );
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  const selected = options.find((o) => o.value === value);
  // Unknown value (e.g. a provider removed from the picker but still stored):
  // show an explicit placeholder instead of a blank trigger with an empty
  // tooltip, so the control never looks broken.
  const selectedLabel = selected?.label ?? 'Select…';

  // Flip the panel upward when there is no room below (e.g. the Button
  // position picker sitting at the bottom of its card). Otherwise the
  // panel overflows the card and collides with the section underneath.
  useEffect(() => {
    if (!open) {
      return;
    }
    const trigger = buttonRef.current;
    if (!trigger) {
      setOpenUp(false);
      return;
    }
    try {
      const rect = trigger.getBoundingClientRect();
      // Panel height estimate: rows are min 36px + 12px list padding,
      // capped by the CSS max-height of 220px.
      const panelH = Math.min(options.length * 38 + 12, 220);
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      setOpenUp(spaceBelow < panelH + 12 && spaceAbove > panelH + 12);
    } catch {
      setOpenUp(false);
    }
  }, [open, options.length]);

  // Keep highlight in sync with value when closed
  useEffect(() => {
    if (!open) {
      const idx = options.findIndex((o) => o.value === value);
      if (idx >= 0) {
        setHighlightIdx(idx);
      }
    }
  }, [value, options, open]);

  // Scroll highlighted option into view
  useEffect(() => {
    if (!open || !listRef.current) {
      return;
    }
    const el = listRef.current.querySelector<HTMLElement>(`[data-idx="${highlightIdx}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlightIdx, open]);

  const close = useCallback(() => {
    setOpen(false);
    // Return focus to trigger — required for keyboard flow
    buttonRef.current?.focus();
  }, []);

  // Click outside + Escape
  useEffect(() => {
    if (!open) {
      return;
    }
    const onDown = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  const selectIdx = (idx: number) => {
    const opt = options[idx];
    if (!opt) {
      return;
    }
    onChange(opt.value);
    setOpen(false);
  };

  const onTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) {
      return;
    }
    // Open on ArrowDown/Up/Space/Enter when closed
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' ', 'Spacebar'].includes(e.key)) {
        e.preventDefault();
        setOpen(true);
        const current = Math.max(0, options.findIndex((o) => o.value === value));
        setHighlightIdx(current);
        return;
      }
      return;
    }
    // When open: navigate
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightIdx((i) => Math.min(options.length - 1, i + 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightIdx((i) => Math.max(0, i - 1));
        break;
      case 'Home':
        e.preventDefault();
        setHighlightIdx(0);
        break;
      case 'End':
        e.preventDefault();
        setHighlightIdx(options.length - 1);
        break;
      case 'Enter':
      case ' ':
      case 'Spacebar':
        e.preventDefault();
        selectIdx(highlightIdx);
        break;
      case 'Tab':
        setOpen(false);
        break;
      default:
        break;
    }
  };

  return (
    <div
      ref={wrapperRef}
      className="gf-custom-select"
      data-open={open ? 'true' : undefined}
      data-open-up={open && openUp ? 'true' : undefined}
    >
      <button
        ref={buttonRef}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        aria-disabled={disabled ? 'true' : undefined}
        disabled={disabled}
        className="gf-custom-select-trigger"
        title={selectedLabel}
        onClick={() => {
          if (!disabled) {
            setOpen((v) => !v);
          }
        }}
        onKeyDown={onTriggerKeyDown}
      >
        <span className="gf-custom-select-value">{selectedLabel}</span>
        <span className="gf-custom-select-chevron" aria-hidden="true" />
      </button>

      {open && (
        <ul
          id={listboxId}
          ref={listRef}
          role="listbox"
          className="gf-custom-select-panel"
          aria-label={ariaLabel}
          aria-activedescendant={`${listboxId}-opt-${highlightIdx}`}
          tabIndex={-1}
        >
          {options.map((opt, idx) => {
            const isSelected = opt.value === value;
            const isHighlighted = idx === highlightIdx;
            return (
              <li
                key={opt.value}
                id={`${listboxId}-opt-${idx}`}
                data-idx={idx}
                role="option"
                aria-selected={isSelected}
                className={[
                  'gf-custom-select-option',
                  isSelected ? 'is-selected' : '',
                  isHighlighted ? 'is-highlighted' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onMouseEnter={() => setHighlightIdx(idx)}
                onMouseDown={(e) => {
                  // Prevent button blur before click
                  e.preventDefault();
                }}
                onClick={() => selectIdx(idx)}
              >
                <span className="gf-custom-select-option-label">{opt.label}</span>
                {isSelected && (
                  <span className="gf-custom-select-check" aria-hidden="true">
                    ✓
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};