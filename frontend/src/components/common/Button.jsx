import React from "react";

/**
 * Reusable Button component
 */
export default function Button({
  children,
  type = "button",
  variant = "primary",
  size = "md",
  disabled = false,
  loading = false,
  onClick,
  className = "",
  icon = null,
  iconPosition = "left",
  ...props
}) {
  return (
    <button
      type={type}
      disabled={disabled || Boolean(loading)}
      onClick={onClick}
      className={`gv-button gv-button--${variant} gv-button--${size} ${loading ? "is-loading" : ""} ${className}`}
      {...props}
    >
      {loading ? (
        <span className="gv-button-loading">
          <span className="gv-spinner" aria-hidden="true" />
          <span>{typeof loading === "string" ? loading : "Loading..."}</span>
        </span>
      ) : (
        <>
          {icon && iconPosition === "left" && (
            <span className="gv-button-icon gv-button-icon--left" aria-hidden="true">
              {icon}
            </span>
          )}
          {children && <span className="gv-button-label">{children}</span>}
          {icon && iconPosition === "right" && (
            <span className="gv-button-icon gv-button-icon--right" aria-hidden="true">
              {icon}
            </span>
          )}
        </>
      )}
    </button>
  );
}
