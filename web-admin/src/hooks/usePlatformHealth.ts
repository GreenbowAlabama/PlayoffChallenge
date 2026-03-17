/**
 * usePlatformHealth Hook
 *
 * Polls platform health status and provides real-time operator signal.
 * Updates every 30 seconds.
 */

import { useState, useEffect } from 'react';
import { getPlatformHealth, getPlatformHealthStatus, type PlatformHealthResponse } from '../api/platform-health';
import { systemInvariantsApi } from '../api/system-invariants';

export function usePlatformHealth() {
  const [health, setHealth] = useState<PlatformHealthResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [invariantsData, setInvariantsData] = useState<any>(null);

  useEffect(() => {
    // Initial fetch
    const fetchHealth = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const [platformData, invariantsResponse] = await Promise.all([
          getPlatformHealth(),
          systemInvariantsApi.getCurrentStatus().catch(() => null)
        ]);
        setHealth(platformData);
        setInvariantsData(invariantsResponse);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch health');
        // Default to unknown on error
        setHealth({
          status: 'unknown',
          timestamp: new Date().toISOString(),
          services: {
            database: 'unknown',
            externalApis: 'unknown',
            workers: 'unknown',
            contestLifecycle: 'unknown',
            invariants: 'unknown'
          }
        });
      } finally {
        setIsLoading(false);
      }
    };

    fetchHealth();

    // Poll every 30 seconds
    const interval = setInterval(fetchHealth, 30000);

    return () => clearInterval(interval);
  }, []);

  // Determine status from financial invariant (source of truth)
  const status = invariantsData ? getPlatformHealthStatus(invariantsData) : (health?.status || 'unknown');

  return {
    health,
    isLoading,
    error,
    status
  };
}
