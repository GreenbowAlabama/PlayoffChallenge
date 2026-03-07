/**
 * Alert API Module — Web-Admin Observability System
 *
 * Provides API calls for fetching alerts, summaries, and acknowledging alerts.
 * All calls require admin authentication via bearer token.
 */

import { apiRequest } from './client';
import type { SystemAlert, AlertSummary, AlertResponse } from '../types/alerts';

/**
 * Fetch list of alerts with optional filtering
 *
 * @param severity Filter by severity level (optional)
 * @param limit Max alerts per page (default: 50)
 * @param offset Pagination offset (default: 0)
 * @param filter Filter type: 'all', 'unacknowledged', 'acknowledged' (default: 'all')
 * @returns AlertResponse with paginated alert list
 */
export async function getAlerts(
  severity?: string,
  limit: number = 50,
  offset: number = 0,
  filter?: string
): Promise<AlertResponse> {
  const params = new URLSearchParams();
  if (severity) params.append('severity', severity);
  params.append('limit', limit.toString());
  params.append('offset', offset.toString());
  if (filter) params.append('filter', filter);

  return apiRequest<AlertResponse>(
    `/api/admin/alerts?${params.toString()}`
  );
}

/**
 * Fetch alert summary for dashboard widget
 *
 * @returns AlertSummary with total counts by severity
 */
export async function getAlertSummary(): Promise<AlertSummary> {
  return apiRequest<AlertSummary>('/api/admin/alerts/summary');
}

/**
 * Mark an alert as acknowledged (read)
 *
 * @param alertId Alert UUID to acknowledge
 * @returns Updated alert record
 */
export async function acknowledgeAlert(alertId: string): Promise<{ alert: SystemAlert }> {
  return apiRequest<{ alert: SystemAlert }>(
    `/api/admin/alerts/${alertId}/acknowledge`,
    {
      method: 'PATCH',
      body: JSON.stringify({ acknowledged: true }),
    }
  );
}

/**
 * Mark an alert as unacknowledged (unread)
 *
 * @param alertId Alert UUID to unacknowledge
 * @returns Updated alert record
 */
export async function unacknowledgeAlert(alertId: string): Promise<{ alert: SystemAlert }> {
  return apiRequest<{ alert: SystemAlert }>(
    `/api/admin/alerts/${alertId}/acknowledge`,
    {
      method: 'PATCH',
      body: JSON.stringify({ acknowledged: false }),
    }
  );
}

/**
 * Bulk acknowledge multiple alerts
 *
 * @param alertIds Array of alert UUIDs to acknowledge
 * @returns Count of alerts acknowledged
 */
export async function bulkAcknowledgeAlerts(alertIds: string[]): Promise<{ count: number }> {
  return apiRequest<{ count: number }>(
    '/api/admin/alerts/bulk-acknowledge',
    {
      method: 'POST',
      body: JSON.stringify({ alert_ids: alertIds }),
    }
  );
}
