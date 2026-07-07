import React from 'react';
import { cx } from './cx';

export interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
}

/**
 * Accessible switch. A native <button> handles Enter/Space → click, so we wire
 * only onClick — avoiding the double-fire the old ToggleSwitch had (Space fired
 * onKeyDown *and* onClick).
 */
export const Toggle: React.FC<ToggleProps> = ({
  checked,
  onChange,
  disabled = false,
  id,
  className,
  ...aria
}) => (
  <button
    type="button"
    role="switch"
    id={id}
    aria-checked={checked}
    disabled={disabled}
    className={cx('gf-toggle', className)}
    onClick={() => onChange(!checked)}
    {...aria}
  />
);
