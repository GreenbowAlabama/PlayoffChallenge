/**
 * Global System Status Banner
 *
 * Shows quick health status of all four towers at a glance.
 * Displayed at top of Control Room.
 */

import { useQuery } from '@tanstack/react-query';
import { getPlatformHealth } from '../../api/platform-health';
import { getPlayerDataOpsSnapshot } from '../../api/player-data-ops';
import { getUserOpsSnapshot } from '../../api/user-ops';
import { getSystemInstances } from '../../api/discovery';

interface TowerStatus {
  name: string;
  status: 'healthy' | 'degraded' | 'error' | 'loading';
  icon: string;
  details?: string;
}

function getTowerStatus(loading: boolean, error: Error | null, checkFn: () => TowerStatus | null): TowerStatus {
  if (loading) return { name: '', status: 'loading', icon: '⏳' };
  if (error) return { name: '', status: 'error', icon: '✗' };
  return checkFn() || { name: '', status: 'loading', icon: '⏳' };
}

function StatusIndicator({ status }: { status: 'healthy' | 'degraded' | 'error' | 'loading' }) {
  const colors = {
    healthy: 'bg-green-100 text-green-800 border-green-300',
    degraded: 'bg-amber-100 text-amber-800 border-amber-300',
    error: 'bg-red-100 text-red-800 border-red-300',
    loading: 'bg-gray-100 text-gray-800 border-gray-300',
  };

  const labels = {
    healthy: 'Healthy',
    degraded: 'Lagging',
    error: 'Error',
    loading: 'Checking...',
  };

  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium border ${colors[status]}`}>
      {status === 'healthy' && '🟢'}
      {status === 'degraded' && '🟡'}
      {status === 'error' && '🔴'}
      {status === 'loading' && '⏳'}
      {' '}
      {labels[status]}
    </span>
  );
}

export function SystemStatusBanner() {
  // Fetch Platform Health
  const { data: platformHealth, isLoading: platformLoading, error: platformError } = useQuery({
    queryKey: ['systemStatus', 'platformHealth'],
    queryFn: getPlatformHealth,
    refetchInterval: 10000,
  });

  // Fetch Player Data Ops
  const { data: playerData, isLoading: playerDataLoading, error: playerDataError } = useQuery({
    queryKey: ['systemStatus', 'playerData'],
    queryFn: getPlayerDataOpsSnapshot,
    refetchInterval: 10000,
  });

  // Fetch User Ops
  const { data: userOps, isLoading: userOpsLoading, error: userOpsError } = useQuery({
    queryKey: ['systemStatus', 'userOps'],
    queryFn: getUserOpsSnapshot,
    refetchInterval: 10000,
  });

  // Fetch Contest Ops (simple LIVE status check)
  const { data: liveContests, isLoading: contestsLoading, error: contestsError } = useQuery({
    queryKey: ['systemStatus', 'contests'],
    queryFn: () => getSystemInstances(undefined, 'LIVE'),
    refetchInterval: 10000,
  });

  // Determine Platform Health tower status
  const platformStatus: TowerStatus = getTowerStatus(platformLoading, platformError as Error | null, () => {
    if (!platformHealth) return null;
    if (platformHealth.status === 'healthy') return { name: 'Platform Health', status: 'healthy', icon: '🟢' };
    if (platformHealth.status === 'degraded') return { name: 'Platform Health', status: 'degraded', icon: '🟡' };
    return { name: 'Platform Health', status: 'error', icon: '🔴' };
  });

  // Determine Contest Ops tower status
  const contestStatus: TowerStatus = getTowerStatus(contestsLoading, contestsError as Error | null, () => {
    if (!liveContests) return null;
    // Contests are healthy if they exist and are loading correctly
    return { name: 'Contest Ops', status: 'healthy', icon: '🟢', details: `${liveContests.length} live` };
  });

  // Determine Player Data tower status (check ingestion lag)
  const playerDataStatus: TowerStatus = getTowerStatus(playerDataLoading, playerDataError as Error | null, () => {
    if (!playerData) return null;
    const lagSeconds = playerData.ingestion.lag_seconds || 0;
    if (lagSeconds < 300) return { name: 'Player Data', status: 'healthy', icon: '🟢' };
    if (lagSeconds < 600) return { name: 'Player Data', status: 'degraded', icon: '🟡', details: `${Math.round(lagSeconds / 60)}m lag` };
    return { name: 'Player Data', status: 'error', icon: '🔴', details: `${Math.round(lagSeconds / 60)}m lag` };
  });

  // Determine User Ops tower status
  const userOpsStatus: TowerStatus = getTowerStatus(userOpsLoading, userOpsError as Error | null, () => {
    if (!userOps) return null;
    // Check if wallet reconciliation is healthy
    const totalUsers = userOps.users.users_total;
    const fundedUsers = userOps.wallets.users_with_wallet_balance;
    const fundingRate = totalUsers > 0 ? (fundedUsers / totalUsers) * 100 : 0;

    if (fundingRate > 5) return { name: 'User Ops', status: 'healthy', icon: '🟢' };
    if (fundingRate > 0) return { name: 'User Ops', status: 'degraded', icon: '🟡', details: `${fundingRate.toFixed(1)}% funded` };
    return { name: 'User Ops', status: 'degraded', icon: '🟡' };
  });

  const towers = [
    { label: 'Platform Health', status: platformStatus.status, details: platformStatus.details },
    { label: 'Contest Ops', status: contestStatus.status, details: contestStatus.details },
    { label: 'Player Data', status: playerDataStatus.status, details: playerDataStatus.details },
    { label: 'User Ops', status: userOpsStatus.status, details: userOpsStatus.details },
  ];

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm mb-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">System Status</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {towers.map((tower) => (
          <div key={tower.label} className="flex flex-col gap-2">
            <p className="text-sm font-medium text-gray-700">{tower.label}</p>
            <div className="flex items-center justify-between">
              <StatusIndicator status={tower.status} />
              {tower.details && <span className="text-xs text-gray-500 ml-2">{tower.details}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
