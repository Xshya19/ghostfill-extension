import React from 'react';

/**
 * Accessible Toggle Switch component
 * - Keyboard navigation (Enter/Space)
 * - Proper ARIA attributes
 * - Focus visible states
 * - WCAG 2.1 AA compliant
 */
interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  id?: string;
  disabled?: boolean;
}

const ToggleSwitch: React.FC<ToggleProps> = ({
  checked,
  onChange,
  ariaLabel,
  ariaLabelledBy,
  id,
  disabled = false,
}) => {
  // A native <button> already activates on Enter/Space and fires onClick, so we
  // wire only onClick — adding a keydown handler that also calls onChange would
  // double-fire on Space (keydown + the synthesized click).
  return (
    <button
      id={id}
      className={`toggle ${checked ? 'toggle--active' : ''}`}
      onClick={() => !disabled && onChange(!checked)}
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      aria-disabled={disabled}
      type="button"
      disabled={disabled}
      tabIndex={disabled ? -1 : 0}
    >
      <span className="toggle-slider" aria-hidden="true" />
    </button>
  );
};

export default ToggleSwitch;
