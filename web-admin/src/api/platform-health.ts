/**
 * Platform Health API Client
 *
 * Single endpoint for operator-facing platform health status.
 * Aggregates all platform signals into one contract.
 */

import { apiRequest } from './client';

export interface PlatformHealthResponse {
  status: 'healthy' | 'degraded' | 'critical' | 'unknown';
  timestamp: string;
  services: {
    database: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
    externalApis: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
    workers: 'healthy' | 'degraded' | 'unknown';
    contestLifecycle: 'healthy' | 'degraded' | 'unknown';
    invariants: 'healthy' | 'degraded' | 'critical' | 'unknown';
  };
  error?: string;
}

/**
 * Fetch current platform health status.
 * This is the single source of truth for UI platform state.
 */
export async function getPlatformHealth(): Promise<PlatformHealthResponse> {
  return apiRequest<PlatformHealthResponse>('/api/admin/platform-health');
}

/**
 * Determine Platform Health status from financial invariant (source of truth)
 *
 * Financial balance (difference_cents) is the authoritative health indicator.
 * If balanced (difference_cents === 0), system is healthy.
 * Otherwise, system is degraded.
 */
export function getPlatformHealthStatus(data: any): 'healthy' | 'degraded' {
  const diff = data?.invariants?.financial?.values?.difference_cents;
  return diff === 0 ? 'healthy' : 'degraded';
}

/**
 * Map platform health status to UI color and label.
 */
export function getHealthDisplay(status: string) {
  switch (status) {
    case 'healthy':
      return {
        color: '#16a34a',
        bgColor: '#dcfce7',
        label: 'System Healthy',
        icon: '✓'
      };
    case 'degraded':
      return {
        color: '#f59e0b',
        bgColor: '#fef3c7',
        label: 'Degraded',
        icon: '⚠'
      };
    case 'critical':
      return {
        color: '#dc2626',
        bgColor: '#fee2e2',
        label: 'Critical Issue',
        icon: '✗'
      };
    default:
      return {
        color: '#6b7280',
        bgColor: '#f3f4f6',
        label: 'Unknown',
        icon: '?'
      };
  }
}
