import { useState } from 'react';
import './InfoTooltip.css';

interface InfoTooltipProps {
  text: string;
  className?: string;
}

/**
 * InfoTooltip Component
 *
 * Displays a small "ⓘ" icon that shows a tooltip on hover (desktop) or tap (mobile).
 *
 * @param text - The tooltip text to display
 * @param className - Optional additional CSS classes
 */
export function InfoTooltip({ text, className = '' }: InfoTooltipProps) {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <span
      className={`info-tooltip ${className}`}
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
      onClick={() => setIsVisible(!isVisible)}
      role="tooltip"
      aria-label={text}
    >
      <span className="info-icon" aria-hidden="true">
        ⓘ
      </span>
      {isVisible && <span className="tooltip-text">{text}</span>}
    </span>
  );
}
