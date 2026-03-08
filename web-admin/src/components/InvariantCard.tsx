/**
 * InvariantCard Component
 *
 * Displays a single invariant check status with color-coded indicator
 */

import React from 'react';
import type { InvariantStatus } from '../types/SystemInvariants';
import '../styles/SystemInvariantMonitor.css';

interface InvariantCardProps {
  title: string;
  status: InvariantStatus | string;
  executionTime?: number;
  details?: React.ReactNode;
  anomalyCount?: number;
}

const getStatusColor = (status: string): string => {
  switch (status) {
    case 'HEALTHY':
    case 'BALANCED':
    case 'CONSISTENT':
      return 'status-healthy';
    case 'WARNING':
    case 'DRIFT':
    case 'DEGRADED':
    case 'INCOMPLETE':
    case 'VIOLATIONS':
    case 'STUCK_TRANSITIONS':
      return 'status-warning';
    case 'CRITICAL':
    case 'CRITICAL_IMBALANCE':
    case 'ERROR':
    case 'FAILED':
      return 'status-critical';
    default:
      return 'status-unknown';
  }
};

export const InvariantCard: React.FC<InvariantCardProps> = ({
  title,
  status,
  executionTime,
  details,
  anomalyCount
}) => {
  return (
    <div className={`invariant-card ${getStatusColor(status)}`}>
      <div className="card-header">
        <h3>{title}</h3>
        <span className={`status-badge ${getStatusColor(status)}`}>
          {status}
        </span>
      </div>

      <div className="card-content">
        {details && (
          <div className="card-details">
            {details}
          </div>
        )}

        {anomalyCount !== undefined && anomalyCount > 0 && (
          <div className="anomaly-count">
            ⚠️ {anomalyCount} anomal{anomalyCount === 1 ? 'y' : 'ies'} detected
          </div>
        )}
      </div>

      {executionTime !== undefined && (
        <div className="card-footer">
          <small>Execution: {executionTime}ms</small>
        </div>
      )}
    </div>
  );
};
