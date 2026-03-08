/**
 * Worker Heartbeat Panel
 *
 * Displays operational status of critical background workers.
 * Detects: stalled ingestion, scoring pipeline lag, lifecycle worker failure.
 */

import React, { useState, useEffect } from 'react';
import { getWorkerStatus, getWorkerStatusDisplay, getWorkerDisplayName, type WorkerHeartbeatResponse } from '../api/worker-heartbeats';

interface WorkerHeartbeatPanelProps {
  isFetching?: boolean;
}

export const WorkerHeartbeatPanel: React.FC<WorkerHeartbeatPanelProps> = ({ isFetching = false }) => {
  const [data, setData] = useState<WorkerHeartbeatResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchWorkerStatus = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await getWorkerStatus();
        setData(response);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch worker status');
      } finally {
        setLoading(false);
      }
    };

    fetchWorkerStatus();
  }, []);

  if (loading && !data) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
          <h2 className="text-lg font-medium text-gray-900">Background Workers</h2>
          <p className="text-sm text-gray-500">Operational status of critical workers</p>
        </div>
        <div className="p-4 animate-pulse">
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-12 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
          <h2 className="text-lg font-medium text-gray-900">Background Workers</h2>
        </div>
        <div className="p-4">
          <p className="text-sm text-red-600">Error loading worker status: {error}</p>
        </div>
      </div>
    );
  }

  const getWorkerIcon = (status: string) => {
    const statusMap: Record<string, string> = {
      HEALTHY: '✓',
      DEGRADED: '⚠',
      ERROR: '✗',
      STALE: '⏱',
      UNKNOWN: '?'
    };
    return statusMap[status] || '?';
  };

  const getStatusBgColor = (status: string) => {
    const colorMap: Record<string, string> = {
      HEALTHY: '#dcfce7',
      DEGRADED: '#fef3c7',
      ERROR: '#fee2e2',
      STALE: '#fef3c7',
      UNKNOWN: '#f3f4f6'
    };
    return colorMap[status] || '#f3f4f6';
  };

  const getStatusTextColor = (status: string) => {
    const colorMap: Record<string, string> = {
      HEALTHY: '#166534',
      DEGRADED: '#92400e',
      ERROR: '#7f1d1d',
      STALE: '#92400e',
      UNKNOWN: '#374151'
    };
    return colorMap[status] || '#374151';
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-medium text-gray-900">Background Workers</h2>
            <p className="text-sm text-gray-500">Detects stalled ingestion, pipeline lag, worker failure</p>
          </div>
          <div
            className="px-3 py-1 rounded-full text-xs font-medium"
            style={{
              backgroundColor: data.overall_status === 'healthy' ? '#dcfce7' : data.overall_status === 'degraded' ? '#fef3c7' : '#f3f4f6',
              color: data.overall_status === 'healthy' ? '#166534' : data.overall_status === 'degraded' ? '#92400e' : '#374151'
            }}
          >
            {data.overall_status === 'healthy' ? '✓ All Healthy' : data.overall_status === 'degraded' ? '⚠ Degraded' : '? Unknown'}
          </div>
        </div>
      </div>

      <div className="p-4">
        <div className="space-y-3">
          {data.workers.map((worker) => {
            const display = getWorkerStatusDisplay(worker.status);
            const isCritical = worker.is_critical;

            return (
              <div
                key={worker.name}
                className="rounded-lg border p-4"
                style={{
                  backgroundColor: getStatusBgColor(worker.status),
                  borderColor: display.color,
                  borderWidth: '2px'
                }}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-white text-sm"
                      style={{ backgroundColor: display.color }}
                    >
                      {getWorkerIcon(worker.status)}
                    </div>
                    <div>
                      <div className="font-medium" style={{ color: getStatusTextColor(worker.status) }}>
                        {getWorkerDisplayName(worker.name)}
                        {isCritical && <span className="ml-2 text-xs font-bold">(CRITICAL)</span>}
                      </div>
                      <div className="text-xs" style={{ color: getStatusTextColor(worker.status) }}>
                        {display.label}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span style={{ color: getStatusTextColor(worker.status) }}>Last Run:</span>
                    <div className="font-mono text-gray-700 mt-0.5">
                      {worker.last_run
                        ? new Date(worker.last_run).toLocaleTimeString()
                        : '—'}
                    </div>
                  </div>
                  <div>
                    <span style={{ color: getStatusTextColor(worker.status) }}>Errors:</span>
                    <div className="font-mono text-gray-700 mt-0.5">
                      {worker.error_count}
                    </div>
                  </div>
                </div>

                {worker.freshness && (
                  <div className="mt-2 pt-2 border-t" style={{ borderColor: display.color, borderOpacity: 0.3 }}>
                    <div className="text-xs" style={{ color: getStatusTextColor(worker.status) }}>
                      Freshness: {worker.freshness.minutes_old}m old
                      {worker.freshness.is_stale && (
                        <span className="ml-2 font-bold">
                          (max {worker.freshness.window_minutes}m)
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {worker.stale_message && (
                  <div className="mt-2 text-xs font-semibold" style={{ color: display.color }}>
                    ⚠ {worker.stale_message}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {data.workers.length === 0 && (
          <p className="text-sm text-gray-500">No workers configured</p>
        )}

        <p className="text-xs text-gray-400 mt-4">
          Updated: {new Date(data.timestamp).toLocaleTimeString()}
        </p>
      </div>
    </div>
  );
};
