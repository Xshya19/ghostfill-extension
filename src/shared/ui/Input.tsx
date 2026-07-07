import React from 'react';
import { cx } from './cx';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  mono?: boolean;
  invalid?: boolean;
  leftIcon?: React.ReactNode;
}

/** Neo-brutalist text input. Pass `leftIcon` to render a leading glyph. */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { mono = false, invalid = false, leftIcon, className, ...rest },
  ref
) {
  const input = (
    <input
      ref={ref}
      className={cx('gf-input', mono && 'gf-input--mono', invalid && 'gf-input--invalid', className)}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );

  if (!leftIcon) {
    return input;
  }

  return (
    <span className="gf-input-group">
      <span className="gf-input-group__icon" aria-hidden>
        {leftIcon}
      </span>
      {input}
    </span>
  );
});

export interface FieldProps {
  label?: React.ReactNode;
  htmlFor?: string;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

/** Label + control + hint/error wrapper. */
export const Field: React.FC<FieldProps> = ({ label, htmlFor, hint, error, className, children }) => (
  <div className={cx('gf-field', className)}>
    {label && (
      <label className="gf-field__label" htmlFor={htmlFor}>
        {label}
      </label>
    )}
    {children}
    {error ? (
      <span className="gf-field__error">{error}</span>
    ) : hint ? (
      <span className="gf-field__hint">{hint}</span>
    ) : null}
  </div>
);
