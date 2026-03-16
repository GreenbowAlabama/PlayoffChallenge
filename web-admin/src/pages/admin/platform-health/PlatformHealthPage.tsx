/**
 * Platform Health Tower
 *
 * Displays infrastructure and worker health status.
 * Fetches from /api/admin/platform-health and /api/admin/system-invariants
 */

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getPlatformHealth, getHealthDisplay } from '../../../api/platform-health';
import { systemInvariantsApi } from '../../../api/system-invariants';
import { AdminPanel } from '../../../components/admin/AdminPanel';
import { RefreshIndicator } from '../../../components/admin/RefreshIndicator';

function ServiceHealth({ name, status }: { name: string; status: string }) {
  const statusColors: Record<string, string> = {
    healthy: 'bg-green-100 text-green-800',
    degraded: 'bg-amber-100 text-amber-800',
    unhealthy: 'bg-red-100 text-red-800',
    unknown: 'bg-gray-100 text-gray-800',
  };

  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm font-medium text-gray-700">{name}</span>
      <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${statusColors[status] || statusColors.unknown}`}>
        {status}
      </span>
    </div>
  );
}

function formatServerTime(timestamp: string): string {
  return new Date(timestamp).toLocaleString();
}


export function PlatformHealthPage() {
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  // Platform health query
  const { data: platformHealth, isLoading: healthLoading } = useQuery({
    queryKey: ['platformHealth'],
    queryFn: getPlatformHealth,
    refetchInterval: 10000,
  });

  // System invariants query
  const { data: invariants, isLoading: invariantsLoading } = useQuery({
    queryKey: ['systemInvariants'],
    queryFn: () => systemInvariantsApi.getCurrentStatus(),
    refetchInterval: 10000,
  });

  // Update lastUpdated timestamp when data changes
  useEffect(() => {
    if (platformHealth) {
      setLastUpdated(new Date().toLocaleString());
    }
  }, [platformHealth?.timestamp]);

  const healthDisplay = platformHealth ? getHealthDisplay(platformHealth.status) : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Platform Health</h1>
          <p className="mt-1 text-sm text-gray-600">Infrastructure & worker operational status</p>
        </div>
        <RefreshIndicator lastUpdated={lastUpdated} refreshInterval={10000} />
      </div>

      {/* Overall Status */}
      {platformHealth && healthDisplay && (
        <div
          className="rounded-lg border-2 p-6 flex items-center gap-4"
          style={{ backgroundColor: healthDisplay.bgColor, borderColor: healthDisplay.color }}
        >
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 font-bold text-2xl"
            style={{ backgroundColor: healthDisplay.color, color: 'white' }}
          >
            {healthDisplay.icon}
          </div>
          <div>
            <h2 className="text-2xl font-bold" style={{ color: healthDisplay.color }}>
              {healthDisplay.label}
            </h2>
            <p className="text-sm" style={{ color: healthDisplay.color, opacity: 0.8 }}>
              {platformHealth.timestamp && formatServerTime(platformHealth.timestamp)}
            </p>
          </div>
        </div>
      )}

      {/* Loading state */}
      {(healthLoading || invariantsLoading) && !platformHealth && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-6 text-center">
          <p className="text-gray-600">Loading platform health...</p>
        </div>
      )}

      {/* Services Status Grid */}
      {platformHealth && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Database */}
          <AdminPanel
            title="Database"
            tooltip="Core database connection and query performance"
          >
            <ServiceHealth name="Status" status={platformHealth.services.database} />
          </AdminPanel>

          {/* External APIs */}
          <AdminPanel
            title="External APIs"
            tooltip="Third-party API integrations (ESPN, etc.)"
          >
            <ServiceHealth name="Status" status={platformHealth.services.externalApis} />
          </AdminPanel>

          {/* Workers */}
          <AdminPanel
            title="Workers"
            tooltip="Background job processors and ingestion workers"
            alert={
              platformHealth.services.workers === 'degraded'
                ? {
                    type: 'warning',
                    message: 'Worker degradation - some jobs may be delayed',
                  }
                : undefined
            }
          >
            <ServiceHealth name="Status" status={platformHealth.services.workers} />
          </AdminPanel>

          {/* Contest Lifecycle */}
          <AdminPanel
            title="Contest Lifecycle"
            tooltip="Contest state transitions and orchestration"
          >
            <ServiceHealth name="Status" status={platformHealth.services.contestLifecycle} />
          </AdminPanel>

          {/* System Invariants */}
          <AdminPanel
            title="System Invariants"
            tooltip="Financial and operational constraint validation"
          >
            <ServiceHealth name="Status" status={platformHealth.services.invariants} />
          </AdminPanel>

          {/* Server Time */}
          <AdminPanel
            title="Server Time"
            tooltip="Current server time for synchronization checks"
          >
            <div className="text-sm text-gray-700 font-mono">
              {platformHealth.timestamp ? formatServerTime(platformHealth.timestamp) : '—'}
            </div>
          </AdminPanel>
        </div>
      )}

      {/* System Invariants Summary */}
      {invariants && (
        <div className="grid grid-cols-1 gap-6">
          <AdminPanel
            title="Invariant Status Summary"
            tooltip="System constraint validation results"
          >
            <div className="space-y-3">
              {/* System checks */}
              <div className="border-t pt-3">
                <h4 className="text-sm font-semibold text-gray-700 mb-2">Status</h4>
                <div className="text-sm text-gray-600">
                  <span className={`inline-flex items-center gap-2 ${
                    invariants.overall_status === 'HEALTHY' ? 'text-green-700' :
                    invariants.overall_status === 'WARNING' ? 'text-amber-700' :
                    invariants.overall_status === 'CRITICAL' ? 'text-red-700' :
                    'text-gray-700'
                  }`}>
                    <span className={`inline-block w-2 h-2 rounded-full ${
                      invariants.overall_status === 'HEALTHY' ? 'bg-green-600' :
                      invariants.overall_status === 'WARNING' ? 'bg-amber-600' :
                      invariants.overall_status === 'CRITICAL' ? 'bg-red-600' :
                      'bg-gray-600'
                    }`}></span>
                    {invariants.overall_status === 'HEALTHY' && 'All system invariants healthy'}
                    {invariants.overall_status === 'WARNING' && 'System invariants degraded - review anomalies'}
                    {invariants.overall_status === 'CRITICAL' && 'System invariants critical - immediate attention required'}
                    {!['HEALTHY', 'WARNING', 'CRITICAL'].includes(invariants.overall_status) && 'Unknown invariant status'}
                  </span>
                </div>
              </div>
            </div>
          </AdminPanel>
        </div>
      )}

      {/* Error state */}
      {platformHealth?.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-700">
            <strong>Error:</strong> {platformHealth.error}
          </p>
        </div>
      )}
    </div>
  );
}
