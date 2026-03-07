/**
 * Alert Center — Web-Admin Observability System
 *
 * Displays all system alerts with filtering, pagination, and bulk actions.
 * Auto-refreshes every 30 seconds to stay current with live alerts.
 */

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { getAlerts, acknowledgeAlert, unacknowledgeAlert, bulkAcknowledgeAlerts } from '../api/alerts';
import { ALERT_COLORS, ALERT_BG_COLORS, ALERT_TYPE_LABELS } from '../types/alerts';
import type { SystemAlert, AlertSeverity } from '../types/alerts';

export function AlertCenter() {
  const [severity, setSeverity] = useState<AlertSeverity | null>(null);
  const [filter, setFilter] = useState<'all' | 'unacknowledged' | 'acknowledged'>('unacknowledged');
  const [page, setPage] = useState(0);
  const [selectedAlerts, setSelectedAlerts] = useState<Set<string>>(new Set());
  const itemsPerPage = 50;

  // Fetch alerts with auto-refresh
  const { data: alertsData, isLoading, refetch } = useQuery({
    queryKey: ['alerts', severity, filter, page],
    queryFn: () => getAlerts(severity || undefined, itemsPerPage, page * itemsPerPage, filter),
    refetchInterval: 30000, // Auto-refresh every 30 seconds
    staleTime: 10000,
  });

  // Acknowledge single alert mutation
  const { mutate: acknowledgeAlertMutation } = useMutation({
    mutationFn: (alertId: string) => acknowledgeAlert(alertId),
    onSuccess: () => {
      refetch();
    },
  });

  // Unacknowledge alert mutation
  const { mutate: unacknowledgeAlertMutation } = useMutation({
    mutationFn: (alertId: string) => unacknowledgeAlert(alertId),
    onSuccess: () => {
      refetch();
    },
  });

  // Bulk acknowledge mutation
  const { mutate: bulkAcknowledge, isPending: isBulkLoading } = useMutation({
    mutationFn: (alertIds: string[]) => bulkAcknowledgeAlerts(alertIds),
    onSuccess: () => {
      setSelectedAlerts(new Set());
      refetch();
    },
  });

  const handleSelectAlert = (alertId: string) => {
    const newSelected = new Set(selectedAlerts);
    if (newSelected.has(alertId)) {
      newSelected.delete(alertId);
    } else {
      newSelected.add(alertId);
    }
    setSelectedAlerts(newSelected);
  };

  const handleSelectAll = () => {
    if (alertsData?.alerts) {
      if (selectedAlerts.size === alertsData.alerts.length) {
        setSelectedAlerts(new Set());
      } else {
        setSelectedAlerts(new Set(alertsData.alerts.map(a => a.id)));
      }
    }
  };

  const handleBulkAcknowledge = () => {
    if (selectedAlerts.size > 0) {
      bulkAcknowledge(Array.from(selectedAlerts));
    }
  };

  const totalPages = alertsData ? Math.ceil(alertsData.total / itemsPerPage) : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Alert Center</h1>
          <p className="mt-1 text-sm text-gray-600">
            System alerts for customer service and technical support
          </p>
        </div>
        <div className="text-sm text-gray-600">
          Auto-refreshing every 30 seconds
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Severity Filter */}
          <div>
            <label htmlFor="severity" className="block text-sm font-medium text-gray-700 mb-1">
              Severity
            </label>
            <select
              id="severity"
              value={severity || ''}
              onChange={(e) => {
                setSeverity((e.target.value as AlertSeverity) || null);
                setPage(0);
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">All Severity Levels</option>
              <option value="INFO">Info</option>
              <option value="WARNING">Warning</option>
              <option value="CRITICAL">Critical</option>
            </select>
          </div>

          {/* Status Filter */}
          <div>
            <label htmlFor="filter" className="block text-sm font-medium text-gray-700 mb-1">
              Status
            </label>
            <select
              id="filter"
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value as 'all' | 'unacknowledged' | 'acknowledged');
                setPage(0);
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="unacknowledged">Unacknowledged Only</option>
              <option value="acknowledged">Acknowledged Only</option>
              <option value="all">All Alerts</option>
            </select>
          </div>

          {/* Summary */}
          <div className="flex items-end">
            <div className="text-sm text-gray-600">
              {isLoading ? (
                <span>Loading...</span>
              ) : (
                <span>
                  Showing {alertsData?.alerts.length || 0} of {alertsData?.total || 0} alerts
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Bulk Actions */}
        {selectedAlerts.size > 0 && (
          <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded p-3">
            <span className="text-sm font-medium text-blue-900">
              {selectedAlerts.size} alert{selectedAlerts.size !== 1 ? 's' : ''} selected
            </span>
            <button
              onClick={handleBulkAcknowledge}
              disabled={isBulkLoading}
              className="inline-flex items-center px-3 py-1.5 border border-blue-300 text-sm font-medium rounded-md text-blue-700 bg-white hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isBulkLoading ? 'Acknowledging...' : 'Mark as Acknowledged'}
            </button>
          </div>
        )}
      </div>

      {/* Alerts Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-gray-600">
            <div className="inline-flex items-center space-x-2">
              <div className="animate-spin h-5 w-5 border-2 border-blue-500 border-t-transparent rounded-full"></div>
              <span>Loading alerts...</span>
            </div>
          </div>
        ) : !alertsData?.alerts || alertsData.alerts.length === 0 ? (
          <div className="p-8 text-center text-gray-600">
            <p>No alerts to display</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left">
                    <input
                      type="checkbox"
                      checked={selectedAlerts.size === alertsData.alerts.length && alertsData.alerts.length > 0}
                      onChange={handleSelectAll}
                      className="rounded border-gray-300"
                    />
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Severity</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Title</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Created</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Status</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {alertsData.alerts.map((alert: SystemAlert) => (
                  <tr key={alert.id} className={`hover:bg-gray-50 ${selectedAlerts.has(alert.id) ? 'bg-blue-50' : ''}`}>
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedAlerts.has(alert.id)}
                        onChange={() => handleSelectAlert(alert.id)}
                        className="rounded border-gray-300"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${ALERT_COLORS[alert.severity]} ${ALERT_BG_COLORS[alert.severity]}`}>
                        {alert.severity}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {ALERT_TYPE_LABELS[alert.alert_type] || alert.alert_type}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      <div className="font-medium">{alert.title}</div>
                      <div className="text-xs text-gray-600 mt-1 line-clamp-2">{alert.description}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {new Date(alert.created_at).toLocaleDateString()} {new Date(alert.created_at).toLocaleTimeString()}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {alert.acknowledged ? (
                        <span className="text-gray-600">Acknowledged</span>
                      ) : (
                        <span className="text-yellow-600 font-medium">Unacknowledged</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right space-x-1">
                      {alert.acknowledged ? (
                        <button
                          onClick={() => unacknowledgeAlertMutation(alert.id)}
                          className="inline-flex items-center px-2 py-1 border border-gray-300 text-xs font-medium rounded text-gray-700 hover:bg-gray-50"
                        >
                          Mark Unread
                        </button>
                      ) : (
                        <button
                          onClick={() => acknowledgeAlertMutation(alert.id)}
                          className="inline-flex items-center px-2 py-1 border border-blue-300 text-xs font-medium rounded text-blue-700 bg-white hover:bg-blue-50"
                        >
                          Mark Read
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="bg-white rounded-lg shadow p-4 flex items-center justify-between">
          <div className="text-sm text-gray-600">
            Page {page + 1} of {totalPages}
          </div>
          <div className="flex space-x-2">
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              className="px-3 py-1 border border-gray-300 rounded text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
            >
              Previous
            </button>
            <button
              onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
              disabled={page >= totalPages - 1}
              className="px-3 py-1 border border-gray-300 rounded text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
