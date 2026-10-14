import React from "react";

/**
 * Reusable Form Input component
 */
export default function Input({
  label,
  id,
  name,
  type = "text",
  placeholder,
  value,
  onChange,
  onBlur,
  error,
  icon = null,
  required = false,
  autoComplete,
  className = "",
  ...props
}) {
  const inputId = id || name;

  return (
    <div className={`gv-input-group ${error ? "has-error" : ""} ${className}`}>
      {label && (
        <label htmlFor={inputId} className="gv-label">
          {label}
          {required && <span className="gv-required-star">*</span>}
        </label>
      )}

      <div className="gv-input-wrapper">
        {icon && <span className="gv-input-icon-left">{icon}</span>}
        <input
          id={inputId}
          name={name}
          type={type}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          onBlur={onBlur}
          required={required}
          autoComplete={autoComplete}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${inputId}-error` : undefined}
          className={`gv-input ${icon ? "gv-input--with-icon" : ""}`}
          {...props}
        />
      </div>

      {error && (
        <small id={`${inputId}-error`} className="gv-field-error" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}
