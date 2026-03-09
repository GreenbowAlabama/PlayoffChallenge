/**
 * Refresh Indicator Component
 *
 * Shows data freshness and auto-refresh status.
 * Displays last updated timestamp and refresh interval.
 */

interface RefreshIndicatorProps {
  lastUpdated?: string | null;
  refreshInterval?: number; // in milliseconds
}

export function RefreshIndicator({ lastUpdated, refreshInterval = 10000 }: RefreshIndicatorProps) {
  const refreshSeconds = Math.round(refreshInterval / 1000);

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2">
        <span className="inline-block w-2 h-2 rounded-full bg-green-600 animate-pulse"></span>
        <span className="text-xs font-medium text-gray-600">Live</span>
      </div>
      <span className="text-xs text-gray-500">Refreshing every {refreshSeconds}s</span>
      {lastUpdated && (
        <>
          <span className="text-gray-300">•</span>
          <span className="text-xs text-gray-500">
            Updated: <span className="font-mono text-gray-700">{lastUpdated}</span>
          </span>
        </>
      )}
    </div>
  );
}
