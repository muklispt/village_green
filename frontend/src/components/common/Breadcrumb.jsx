import { Link } from "react-router-dom";
import { ChevronRight, Home } from "lucide-react";

/**
 * Accessible Breadcrumb navigation
 * @param {Array<{ label: string, to?: string }>} items
 */
export default function Breadcrumb({ items = [] }) {
  return (
    <nav className="gv-breadcrumb" aria-label="Breadcrumb">
      <ol className="gv-breadcrumb-list">
        <li className="gv-breadcrumb-item">
          <Link to="/" className="gv-breadcrumb-link" aria-label="Home">
            <Home size={14} className="gv-breadcrumb-icon" />
            <span>Home</span>
          </Link>
        </li>
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li key={index} className="gv-breadcrumb-item">
              <ChevronRight size={14} className="gv-breadcrumb-separator" aria-hidden="true" />
              {isLast || !item.to ? (
                <span className="gv-breadcrumb-current" aria-current="page">
                  {item.label}
                </span>
              ) : (
                <Link to={item.to} className="gv-breadcrumb-link">
                  {item.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
