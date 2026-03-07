/**
 * Alert Summary Widget — Dashboard Component
 *
 * Displays alert counts by severity on the dashboard with a link to Alert Center.
 * Auto-refreshes every 30 seconds to show current alert state.
 */
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { getAlertSummary } from '../api/alerts';

export function AlertSummaryWidget() {
  const navigate = useNavigate();

  const { data: summary, isLoading } = useQuery({
    queryKey: ['alertSummary'],
    queryFn: getAlertSummary,
    refetchInterval: 30000, // Auto-refresh every 30 seconds
    staleTime: 10000,
  });

  if (isLoading || !summary) {
    return (
      <div className="bg-white rounded-lg shadow p-6 animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-1/4 mb-4"></div>
        <div className="space-y-3">
          <div className="h-3 bg-gray-200 rounded w-1/3"></div>
          <div className="h-3 bg-gray-200 rounded w-1/3"></div>
          <div className="h-3 bg-gray-200 rounded w-1/3"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">System Alerts</h2>
        {summary.unacknowledged > 0 && (
          <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-bold text-white bg-red-600">
            {summary.unacknowledged} new
          </span>
        )}
      </div>

      {/* Alert Summary Grid */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        {/* Critical Alerts */}
        <div className="bg-red-50 rounded p-4 cursor-pointer hover:bg-red-100 transition-colors" onClick={() => navigate('/alerts?severity=CRITICAL')}>
          <div className="text-sm text-red-700 font-medium">Critical</div>
          <div className="text-2xl font-bold text-red-600">{summary.critical}</div>
        </div>

        {/* Warnings */}
        <div className="bg-amber-50 rounded p-4 cursor-pointer hover:bg-amber-100 transition-colors" onClick={() => navigate('/alerts?severity=WARNING')}>
          <div className="text-sm text-amber-700 font-medium">Warnings</div>
          <div className="text-2xl font-bold text-amber-600">{summary.warning}</div>
        </div>

        {/* Info */}
        <div className="bg-blue-50 rounded p-4 cursor-pointer hover:bg-blue-100 transition-colors" onClick={() => navigate('/alerts?severity=INFO')}>
          <div className="text-sm text-blue-700 font-medium">Info</div>
          <div className="text-2xl font-bold text-blue-600">{summary.info}</div>
        </div>

        {/* Total */}
        <div className="bg-gray-50 rounded p-4 cursor-pointer hover:bg-gray-100 transition-colors" onClick={() => navigate('/alerts')}>
          <div className="text-sm text-gray-700 font-medium">Total</div>
          <div className="text-2xl font-bold text-gray-600">{summary.total}</div>
        </div>
      </div>

      {/* Unacknowledged Badge */}
      {summary.unacknowledged > 0 && (
        <div className="bg-red-50 border-l-4 border-red-600 p-3 mb-4">
          <p className="text-sm text-red-800">
            <span className="font-semibold">{summary.unacknowledged}</span> unacknowledged alert{summary.unacknowledged !== 1 ? 's' : ''}
          </p>
        </div>
      )}

      {/* View All Button */}
      <button
        onClick={() => navigate('/alerts')}
        className="w-full px-4 py-2 border border-gray-300 text-sm font-medium text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
      >
        View All Alerts →
      </button>
    </div>
  );
}
