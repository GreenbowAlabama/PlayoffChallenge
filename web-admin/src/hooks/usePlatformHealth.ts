/**
 * usePlatformHealth Hook
 *
 * Polls platform health status and provides real-time operator signal.
 * Updates every 30 seconds.
 */

import { useState, useEffect } from 'react';
import { getPlatformHealth, type PlatformHealthResponse } from '../api/platform-health';

export function usePlatformHealth() {
  const [health, setHealth] = useState<PlatformHealthResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Initial fetch
    const fetchHealth = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const data = await getPlatformHealth();
        setHealth(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch health');
        // Default to healthy on error to avoid alarming users
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

  return {
    health,
    isLoading,
    error,
    status: health?.status || 'unknown'
  };
}
