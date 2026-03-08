/**
 * Worker Heartbeats API Client
 *
 * Surfaces background worker operational status for operator visibility.
 * Detects: stalled ingestion, scoring pipeline lag, lifecycle worker failure.
 */

export interface WorkerStatus {
  name: string;
  type: string;
  status: 'HEALTHY' | 'DEGRADED' | 'ERROR' | 'STALE' | 'UNKNOWN';
  status_color: 'green' | 'orange' | 'red' | 'gray';
  is_critical: boolean;
  last_run: string | null;
  error_count: number;
  freshness: {
    minutes_old: number;
    window_minutes: number;
    is_stale: boolean;
  } | null;
  stale_message: string | null;
}

export interface WorkerHeartbeatResponse {
  timestamp: string;
  overall_status: 'healthy' | 'degraded' | 'unknown';
  workers: WorkerStatus[];
  error?: string;
}

/**
 * Fetch current status of all critical background workers
 */
export async function getWorkerStatus(): Promise<WorkerHeartbeatResponse> {
  const response = await fetch('/api/admin/diagnostics/workers');

  if (!response.ok) {
    throw new Error(`Worker status fetch failed: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Get display properties for worker status
 */
export function getWorkerStatusDisplay(status: string) {
  const displays: Record<string, { icon: string; label: string; color: string }> = {
    HEALTHY: {
      icon: '✓',
      label: 'Healthy',
      color: '#16a34a'
    },
    DEGRADED: {
      icon: '⚠',
      label: 'Degraded',
      color: '#f59e0b'
    },
    ERROR: {
      icon: '✗',
      label: 'Error',
      color: '#dc2626'
    },
    STALE: {
      icon: '⏱',
      label: 'Stale',
      color: '#f59e0b'
    },
    UNKNOWN: {
      icon: '?',
      label: 'Unknown',
      color: '#6b7280'
    }
  };

  return displays[status] || displays.UNKNOWN;
}

/**
 * Get human-readable worker name
 */
export function getWorkerDisplayName(workerName: string): string {
  const names: Record<string, string> = {
    discovery_worker: 'Discovery Worker',
    ingestion_worker: 'Ingestion Worker',
    lifecycle_reconciler: 'Lifecycle Reconciler',
    payout_scheduler: 'Payout Scheduler',
    financial_reconciler: 'Financial Reconciler'
  };

  return names[workerName] || workerName;
}
