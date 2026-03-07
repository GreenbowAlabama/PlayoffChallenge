/**
 * Alert Types — Web-Admin Observability System
 *
 * Defines all alert types, severity levels, and response structures
 * for the admin alert center and dashboard widgets.
 */

export type AlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export type AlertType =
  | 'WALLET_LOW'
  | 'SETTLEMENT_FAILURE'
  | 'LIFECYCLE_ERROR'
  | 'CAPACITY_FULL'
  | 'DATA_INCONSISTENCY';

/**
 * SystemAlert — Individual alert record from backend
 */
export interface SystemAlert {
  id: string;
  contest_id?: string;
  user_id?: string;
  alert_type: AlertType;
  severity: AlertSeverity;
  title: string;
  description: string;
  context: Record<string, unknown>;
  acknowledged: boolean;
  acknowledged_at?: string;
  acknowledged_by?: string;
  created_at: string;
}

/**
 * AlertSummary — Dashboard widget summary data
 */
export interface AlertSummary {
  total: number;
  critical: number;
  warning: number;
  info: number;
  unacknowledged: number;
}

/**
 * AlertResponse — Paginated alert list response
 */
export interface AlertResponse {
  alerts: SystemAlert[];
  total: number;
  unacknowledged_count: number;
}

/**
 * AlertFilter — Query parameters for listing alerts
 */
export interface AlertFilter {
  severity?: AlertSeverity;
  limit?: number;
  offset?: number;
  filter?: 'all' | 'unacknowledged' | 'acknowledged';
}

/**
 * Alert severity color mapping for UI
 */
export const ALERT_COLORS: Record<AlertSeverity, string> = {
  INFO: 'text-blue-600',
  WARNING: 'text-amber-600',
  CRITICAL: 'text-red-600'
};

/**
 * Alert severity background colors
 */
export const ALERT_BG_COLORS: Record<AlertSeverity, string> = {
  INFO: 'bg-blue-50',
  WARNING: 'bg-amber-50',
  CRITICAL: 'bg-red-50'
};

/**
 * Alert type descriptions
 */
export const ALERT_TYPE_LABELS: Record<AlertType, string> = {
  WALLET_LOW: 'Low Wallet Balance',
  SETTLEMENT_FAILURE: 'Settlement Failure',
  LIFECYCLE_ERROR: 'Lifecycle Error',
  CAPACITY_FULL: 'Contest Capacity Reached',
  DATA_INCONSISTENCY: 'Data Inconsistency'
};
