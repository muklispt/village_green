import React, { useState } from "react";
import { LockKeyhole, Eye, EyeOff } from "lucide-react";
import { getPasswordStrength } from "../../utils/validation";

/**
 * Reusable Password Input component with visibility toggle and strength indicator
 */
export default function PasswordInput({
  label,
  id,
  name,
  placeholder = "Enter password",
  value,
  onChange,
  onBlur,
  error,
  required = false,
  autoComplete = "new-password",
  showStrength = false,
  className = "",
  ...props
}) {
  const [visible, setVisible] = useState(false);
  const inputId = id || name;

  const strength = showStrength ? getPasswordStrength(value) : null;

  return (
    <div className={`gv-input-group ${error ? "has-error" : ""} ${className}`}>
      {label && (
        <label htmlFor={inputId} className="gv-label">
          {label}
          {required && <span className="gv-required-star">*</span>}
        </label>
      )}

      <div className="gv-input-wrapper">
        <span className="gv-input-icon-left" aria-hidden="true">
          <LockKeyhole size={18} />
        </span>
        <input
          id={inputId}
          name={name}
          type={visible ? "text" : "password"}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          onBlur={onBlur}
          required={required}
          autoComplete={autoComplete}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${inputId}-error` : undefined}
          className="gv-input gv-input--with-icon gv-input--with-toggle"
          {...props}
        />
        <button
          type="button"
          className="gv-toggle-visibility"
          onClick={() => setVisible((prev) => !prev)}
          aria-label={visible ? "Hide password" : "Show password"}
          tabIndex={-1}
        >
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>

      {showStrength && (
        <div className="gv-strength-container">
          <div className="gv-strength-bars" aria-hidden="true">
            {[1, 2, 3, 4].map((level) => (
              <span
                key={level}
                className={`gv-strength-bar ${
                  (strength?.score || 0) >= level ? "active" : ""
                } strength-score-${strength?.score || 0}`}
              />
            ))}
          </div>
          <span className="gv-strength-hint">
            Minimum 8 characters with numbers & symbols
          </span>
          {value && (
            <span
              className={`gv-strength-badge strength-badge-${strength?.score || 0}`}
            >
              {strength?.label}
            </span>
          )}
        </div>
      )}

      {error && (
        <small id={`${inputId}-error`} className="gv-field-error" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}
