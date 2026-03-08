/**
 * AnomalyList Component
 *
 * Displays list of detected anomalies with details
 */

import React from 'react';
import type { Anomaly } from '../types/SystemInvariants';
import '../styles/SystemInvariantMonitor.css';

interface AnomalyListProps {
  title: string;
  anomalies: Anomaly[];
  isExpanded?: boolean;
  onToggle?: () => void;
}

export const AnomalyList: React.FC<AnomalyListProps> = ({
  title,
  anomalies,
  isExpanded = false,
  onToggle
}) => {
  if (anomalies.length === 0) {
    return null;
  }

  return (
    <div className="anomaly-section">
      <div className="anomaly-header" onClick={onToggle} style={{ cursor: onToggle ? 'pointer' : 'default' }}>
        <h4>{title} ({anomalies.length})</h4>
        {onToggle && <span className={`expand-icon ${isExpanded ? 'expanded' : ''}`}>▶</span>}
      </div>

      {isExpanded && (
        <div className="anomaly-list">
          {anomalies.map((anomaly, index) => (
            <div key={index} className="anomaly-item">
              <div className="anomaly-type">
                <strong>{anomaly.type}</strong>
              </div>

              {anomaly.contest_name && (
                <div className="anomaly-detail">
                  Contest: <strong>{anomaly.contest_name}</strong>
                  {anomaly.contest_id && <code>{anomaly.contest_id.slice(0, 8)}...</code>}
                </div>
              )}

              {anomaly.problem && (
                <div className="anomaly-detail">
                  Problem: <strong>{anomaly.problem}</strong>
                </div>
              )}

              {anomaly.time_overdue_minutes !== undefined && (
                <div className="anomaly-detail">
                  Overdue: <strong>{anomaly.time_overdue_minutes} minutes</strong>
                </div>
              )}

              {anomaly.count !== undefined && (
                <div className="anomaly-detail">
                  Count: <strong>{anomaly.count}</strong>
                </div>
              )}

              {anomaly.message && (
                <div className="anomaly-detail">
                  <em>{anomaly.message}</em>
                </div>
              )}

              {anomaly.details && typeof anomaly.details === 'object' && (
                <div className="anomaly-detail">
                  <details>
                    <summary>Details</summary>
                    <pre>{JSON.stringify(anomaly.details, null, 2)}</pre>
                  </details>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
