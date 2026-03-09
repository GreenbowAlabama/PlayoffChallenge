/**
 * User Ops Tower
 *
 * Displays user growth, wallet health, and participation metrics.
 * Fetches from /api/admin/users/ops
 */

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getUserOpsSnapshot } from '../../../api/user-ops';
import { InfoTooltip } from '../../../components/InfoTooltip';
import { AdminPanel } from '../../../components/admin/AdminPanel';
import { RefreshIndicator } from '../../../components/admin/RefreshIndicator';
import type { UserOpsSnapshot } from '../../../api/user-ops';

function formatCurrency(cents: number): string {
  const dollars = cents / 100;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(dollars);
}

function formatNumber(num: number): string {
  return new Intl.NumberFormat('en-US').format(num);
}

function StatCard({ label, value, subtext, trend }: { label: string; value: string | number; subtext?: string; trend?: 'up' | 'down' | 'stable' }) {
  const trendColors = {
    up: 'text-green-600',
    down: 'text-red-600',
    stable: 'text-gray-600',
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-xs font-medium text-gray-600 uppercase mb-2">{label}</p>
      <div className="flex items-end justify-between">
        <div>
          <p className="text-2xl font-bold text-gray-900">{value}</p>
          {subtext && <p className="text-xs text-gray-500 mt-1">{subtext}</p>}
        </div>
        {trend && (
          <svg className={`w-4 h-4 ${trendColors[trend]}`} fill="currentColor" viewBox="0 0 20 20">
            {trend === 'up' && <path fillRule="evenodd" d="M12 7a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0V9.414l-4.293 4.293a1 1 0 01-1.414-1.414L13.586 8H12z" clipRule="evenodd" />}
            {trend === 'down' && <path fillRule="evenodd" d="M12 13a1 1 0 110 2h-5a1 1 0 01-1-1V9a1 1 0 112 0v2.586l4.293-4.293a1 1 0 011.414 1.414L6.414 12H12z" clipRule="evenodd" />}
            {trend === 'stable' && <path fillRule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 11-2 0V5H5v1a1 1 0 11-2 0V4zm0 10a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 11-2 0v-1H5v1a1 1 0 11-2 0v-2z" clipRule="evenodd" />}
          </svg>
        )}
      </div>
    </div>
  );
}


export function UserOpsPage() {
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['userOps'],
    queryFn: getUserOpsSnapshot,
    refetchInterval: 10000,
  });

  useEffect(() => {
    if (data) {
      setLastUpdated(new Date().toLocaleString());
    }
  }, [data?.server_time]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">User Ops Tower</h1>
          <p className="mt-1 text-sm text-gray-600">User growth, wallet health & participation metrics</p>
        </div>
        <RefreshIndicator lastUpdated={lastUpdated} refreshInterval={10000} />
      </div>

      {isLoading && !data && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-6 text-center">
          <p className="text-gray-600">Loading user operations data...</p>
        </div>
      )}

      {data && (
        <>
          {/* User Growth Section */}
          <AdminPanel
            title="User Growth"
            tooltip="Track new user acquisition over time periods"
          >
            <div className="grid grid-cols-3 gap-4">
              <StatCard
                label="Total Users"
                value={formatNumber(data.users.users_total)}
                trend="stable"
              />
              <StatCard
                label="Created Today"
                value={formatNumber(data.users.users_created_today)}
                trend={data.users.users_created_today > 0 ? 'up' : 'stable'}
              />
              <StatCard
                label="Created Last 7 Days"
                value={formatNumber(data.users.users_created_last_7_days)}
                trend={data.users.users_created_last_7_days > data.users.users_created_today ? 'up' : 'stable'}
              />
            </div>
          </AdminPanel>

          {/* Wallet Health Section */}
          <AdminPanel
            title="Wallet Health"
            tooltip="Wallet Balance Total is the sum of all user wallet balances"
          >
            <div className="space-y-4">
              {/* Total Balance */}
              <div className="rounded-lg bg-green-50 border border-green-200 p-4">
                <p className="text-xs font-medium text-green-700 uppercase mb-1">Total Wallet Balance</p>
                <p className="text-3xl font-bold text-green-900">{formatCurrency(data.wallets.wallet_balance_total)}</p>
              </div>

              {/* Balance metrics grid */}
              <div className="grid grid-cols-2 gap-3">
                <StatCard
                  label="Average Balance"
                  value={formatCurrency(Math.round(data.wallets.wallet_balance_avg))}
                  trend="stable"
                />
                <StatCard
                  label="Users with Balance"
                  value={formatNumber(data.wallets.users_with_wallet_balance)}
                  trend="stable"
                />
              </div>

              <div className="border-t pt-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">Users with Zero Balance</span>
                  <span className={`text-lg font-bold ${data.wallets.users_with_zero_balance > 0 ? 'text-amber-700' : 'text-green-700'}`}>
                    {formatNumber(data.wallets.users_with_zero_balance)}
                  </span>
                </div>
              </div>
            </div>
          </AdminPanel>

          {/* Participation Section */}
          <AdminPanel
            title="Participation Metrics"
            tooltip="Users Joined Contests Today counts unique users who entered contests today"
          >
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <StatCard
                  label="Joined Today"
                  value={formatNumber(data.participation.users_joined_contests_today)}
                  trend={data.participation.users_joined_contests_today > 0 ? 'up' : 'stable'}
                />
                <StatCard
                  label="Joined Last 7 Days"
                  value={formatNumber(data.participation.users_joined_contests_last_7_days)}
                  trend={data.participation.users_joined_contests_last_7_days > 0 ? 'up' : 'stable'}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <StatCard
                  label="Avg Contests Per User"
                  value={data.participation.avg_contests_per_user.toFixed(2)}
                  trend="stable"
                />
                <StatCard
                  label="Users with No Entries"
                  value={formatNumber(data.participation.users_with_no_entries)}
                  trend={data.participation.users_with_no_entries > 0 ? 'down' : 'stable'}
                />
              </div>
            </div>
          </AdminPanel>

          {/* Quick Stats Summary */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
              <h4 className="text-sm font-semibold text-blue-900 mb-3">Engagement Rate</h4>
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-blue-800">Participating Users</span>
                  <span className="font-bold text-blue-900">
                    {data.users.users_total > 0
                      ? ((data.participation.users_joined_contests_last_7_days / data.users.users_total) * 100).toFixed(1)
                      : 0}%
                  </span>
                </div>
                <div className="w-full bg-blue-200 rounded-full h-2">
                  <div
                    className="bg-blue-600 h-2 rounded-full transition-all"
                    style={{
                      width: `${Math.min(100, (data.users.users_total > 0
                        ? (data.participation.users_joined_contests_last_7_days / data.users.users_total) * 100
                        : 0))}%`
                    }}
                  ></div>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-purple-200 bg-purple-50 p-4">
              <h4 className="text-sm font-semibold text-purple-900 mb-3">Funded Users</h4>
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-purple-800">With Active Balance</span>
                  <span className="font-bold text-purple-900">
                    {data.users.users_total > 0
                      ? ((data.wallets.users_with_wallet_balance / data.users.users_total) * 100).toFixed(1)
                      : 0}%
                  </span>
                </div>
                <div className="w-full bg-purple-200 rounded-full h-2">
                  <div
                    className="bg-purple-600 h-2 rounded-full transition-all"
                    style={{
                      width: `${Math.min(100, (data.users.users_total > 0
                        ? (data.wallets.users_with_wallet_balance / data.users.users_total) * 100
                        : 0))}%`
                    }}
                  ></div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
