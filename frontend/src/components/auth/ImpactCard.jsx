import React from "react";

/**
 * Reusable Impact Card component for sidebar
 */
export default function ImpactCard({ icon, title, description, text }) {
  const content = description || text;

  return (
    <div className="gv-impact-card">
      <div className="gv-impact-icon-wrapper" aria-hidden="true">
        {icon}
      </div>
      <div className="gv-impact-content">
        <h3 className="gv-impact-title">{title}</h3>
        <p className="gv-impact-desc">{content}</p>
      </div>
    </div>
  );
}
