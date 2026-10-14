import { Minus, Plus } from "lucide-react";

/**
 * Quantity selector with stock boundary enforcement
 * @param {Object} props
 * @param {number} props.quantity
 * @param {number} props.max
 * @param {number} [props.min=1]
 * @param {(newQty: number) => void} props.onChange
 * @param {boolean} [props.disabled=false]
 */
export default function QuantitySelector({
  quantity = 1,
  max = 99,
  min = 1,
  onChange,
  disabled = false,
}) {
  const handleDecrement = (e) => {
    e.preventDefault();
    if (quantity > min && !disabled) {
      onChange(quantity - 1);
    }
  };

  const handleIncrement = (e) => {
    e.preventDefault();
    if (quantity < max && !disabled) {
      onChange(quantity + 1);
    }
  };

  const handleInputChange = (e) => {
    const val = parseInt(e.target.value, 10);
    if (isNaN(val)) return;
    const clamped = Math.max(min, Math.min(val, max));
    onChange(clamped);
  };

  return (
    <div className="gv-qty-selector" role="group" aria-label="Product quantity">
      <button
        type="button"
        className="gv-qty-btn gv-qty-btn--minus"
        onClick={handleDecrement}
        disabled={disabled || quantity <= min}
        aria-label="Decrease quantity"
      >
        <Minus size={14} />
      </button>

      <input
        type="number"
        className="gv-qty-input"
        value={quantity}
        min={min}
        max={max}
        onChange={handleInputChange}
        disabled={disabled}
        aria-label="Quantity amount"
      />

      <button
        type="button"
        className="gv-qty-btn gv-qty-btn--plus"
        onClick={handleIncrement}
        disabled={disabled || quantity >= max}
        aria-label="Increase quantity"
      >
        <Plus size={14} />
      </button>
    </div>
  );
}
