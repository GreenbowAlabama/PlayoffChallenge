/**
 * Financial Health Panel
 *
 * Read-only operational financial monitoring for the Admin console.
 * Displays Stripe balance, wallet balances, contest pools, platform float, and ledger integrity.
 *
 * This panel answers:
 * - "Are funds in Stripe aligned with user balances?"
 * - "What's our platform float and liquidity coverage?"
 * - "Is the ledger balanced and consistent?"
 *
 * No mutations. No auto-remediation. Visibility only.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  getFinancialHealth,
  getFinancialReconciliationHistory,
  type FinancialHealthResponse,
  type FinancialReconciliationHistoryResponse,
} from '../api/admin';

// ============================================
// CURRENCY FORMATTER
// ============================================

function formatCurrency(cents: number): string {
  const dollars = (cents / 100).toFixed(2);
  return `$${dollars}`;
}

function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

// ============================================
// STATUS BADGE COMPONENT
// ============================================

interface StatusBadgeProps {
  status: 'healthy' | 'warning' | 'critical';
  label: string;
}

function StatusBadge({ status, label }: StatusBadgeProps) {
  const colors: Record<string, string> = {
    healthy: 'bg-green-100 text-green-800',
    warning: 'bg-yellow-100 text-yellow-800',
    critical: 'bg-red-100 text-red-800',
  };

  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${colors[status]}`}>
      {status === 'healthy' && <span className="h-2 w-2 rounded-full bg-green-600 mr-1.5"></span>}
      {status === 'warning' && <span className="h-2 w-2 rounded-full bg-yellow-600 mr-1.5"></span>}
      {status === 'critical' && <span className="h-2 w-2 rounded-full bg-red-600 mr-1.5"></span>}
      {label}
    </span>
  );
}

// ============================================
// METRIC CARD COMPONENT
// ============================================

interface MetricCardProps {
  label: string;
  value: string;
  subtext?: string;
}

function MetricCard({ label, value, subtext }: MetricCardProps) {
  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 p-4">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">{label}</p>
      <p className="text-2xl font-semibold text-gray-900">{value}</p>
      {subtext && <p className="text-xs text-gray-500 mt-1">{subtext}</p>}
    </div>
  );
}

// ============================================
// MAIN FINANCIAL HEALTH PANEL
// ============================================

export function FinancialHealthPanel() {
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['admin', 'financial-health'],
    queryFn: getFinancialHealth,
    refetchInterval: 60000, // Refresh every 60 seconds
  });

  const { data: historyData, isLoading: historyLoading, refetch: refetchHistory } = useQuery({
    queryKey: ['admin', 'financial-reconciliation-history'],
    queryFn: () => getFinancialReconciliationHistory(30),
    refetchInterval: 300000, // Refresh every 5 minutes
  });

  const handleRefresh = async () => {
    await Promise.all([refetch(), refetchHistory()]);
    setLastRefresh(new Date().toLocaleTimeString());
  };

  // Determine health status based on invariants
  const getHealthStatus = (data: FinancialHealthResponse): 'healthy' | 'warning' | 'critical' => {
    const ledgerBalanced = data.ledger.balanced;
    const liquidityGood = data.liquidity_ratio >= 1.05;
    const liquidityOkay = data.liquidity_ratio >= 1.0;

    if (!ledgerBalanced || data.liquidity_ratio < 1.0) {
      return 'critical';
    }
    if (!liquidityGood) {
      return 'warning';
    }
    return 'healthy';
  };

  const healthStatus = data ? getHealthStatus(data) : 'critical';

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-4">
            <div>
              <h2 className="text-lg font-medium text-gray-900">Financial Health</h2>
              <p className="text-sm text-gray-500">
                Platform funds reconciliation and liquidity monitoring
              </p>
            </div>
            {data && (
              <div>
                <StatusBadge status={healthStatus} label={healthStatus === 'healthy' ? 'Healthy' : healthStatus === 'warning' ? 'Warning' : 'Critical'} />
              </div>
            )}
          </div>
          <button
            onClick={handleRefresh}
            disabled={isFetching}
            className="inline-flex items-center rounded-md bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 disabled:opacity-50"
          >
            {isFetching ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        {/* Last Reconciliation Run Summary */}
        {historyData?.records && historyData.records.length > 0 && (
          <div className="p-3 bg-white rounded-md border border-gray-200">
            {(() => {
              const lastRec = historyData.records[0];
              const recStatus = lastRec.status === 'HEALTHY' ? 'healthy' : lastRec.status === 'WARNING' ? 'warning' : 'critical';
              return (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-medium text-gray-600">Last Reconciliation:</span>
                    <span className="text-xs text-gray-700">
                      {new Date(lastRec.created_at).toLocaleString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                        timeZone: 'UTC'
                      })} UTC
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={recStatus} label={lastRec.status} />
                    <span className={`text-xs font-medium ${
                      lastRec.difference === 0
                        ? 'text-green-600'
                        : Math.abs(lastRec.difference) < 100
                          ? 'text-yellow-600'
                          : 'text-red-600'
                    }`}>
                      {formatCurrency(lastRec.difference)}
                    </span>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {lastRefresh && (
          <p className="text-xs text-gray-500 mt-2">
            Dashboard refreshed: {lastRefresh}
          </p>
        )}
      </div>

      <div className="p-6">
        {isLoading && (
          <div className="animate-pulse space-y-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-20 bg-gray-200 rounded"></div>
            ))}
          </div>
        )}

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 p-4">
            <p className="text-sm text-red-600">
              Failed to load financial health data. Please try again.
            </p>
          </div>
        )}

        {data && (
          <div className="space-y-6">
            {/* Stripe & Balances Section */}
            <div>
              <h3 className="text-sm font-medium text-gray-900 mb-4">Funds by Source</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <MetricCard
                  label="Stripe Available"
                  value={formatCurrency(data.stripe_available_balance)}
                  subtext="Real bank balance"
                />
                <MetricCard
                  label="User Wallets"
                  value={formatCurrency(data.wallet_balance)}
                  subtext="Total user balance"
                />
                <MetricCard
                  label="Contest Pools"
                  value={formatCurrency(data.contest_pool_balance)}
                  subtext="Entry fees + prizes"
                />
                <MetricCard
                  label="Platform Float"
                  value={formatCurrency(data.platform_float)}
                  subtext="Stripe minus liabilities"
                />
              </div>
            </div>

            {/* Liquidity Coverage Section */}
            <div className="border-t border-gray-200 pt-6">
              <h3 className="text-sm font-medium text-gray-900 mb-4">Liquidity Coverage</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-md border border-gray-200 bg-gray-50 p-4">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                    Coverage Ratio
                  </p>
                  <p className="text-2xl font-semibold text-gray-900">
                    {formatPercent(data.liquidity_ratio)}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    {data.liquidity_ratio >= 1.05
                      ? 'Healthy: >105% coverage'
                      : data.liquidity_ratio >= 1.0
                        ? 'Warning: 100-105% coverage'
                        : 'Critical: <100% coverage'}
                  </p>
                </div>

                <div className="rounded-md border border-gray-200 bg-gray-50 p-4">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                    Calculation
                  </p>
                  <p className="text-sm text-gray-600 mt-2 space-y-1">
                    <div>Stripe: {formatCurrency(data.stripe_available_balance)}</div>
                    <div className="text-gray-400">÷</div>
                    <div>
                      (Wallets + Pools):{' '}
                      {formatCurrency(data.wallet_balance + data.contest_pool_balance)}
                    </div>
                  </p>
                </div>
              </div>
            </div>

            {/* Ledger Integrity Section */}
            <div className="border-t border-gray-200 pt-6">
              <h3 className="text-sm font-medium text-gray-900 mb-4">Ledger Integrity</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-md border border-gray-200 bg-gray-50 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                      Ledger Status
                    </p>
                    <StatusBadge
                      status={data.ledger.balanced ? 'healthy' : 'critical'}
                      label={data.ledger.balanced ? 'Balanced' : 'Out of Balance'}
                    />
                  </div>
                  <dl className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <dt className="text-gray-600">Total Credits</dt>
                      <dd className="font-medium text-gray-900">
                        {formatCurrency(data.ledger.credits)}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-gray-600">Total Debits</dt>
                      <dd className="font-medium text-gray-900">
                        {formatCurrency(data.ledger.debits)}
                      </dd>
                    </div>
                    <div className="border-t border-gray-300 pt-2 flex justify-between">
                      <dt className="text-gray-600 font-medium">Net</dt>
                      <dd className="font-semibold text-gray-900">
                        {formatCurrency(data.ledger.net)}
                      </dd>
                    </div>
                  </dl>
                </div>

                <div className="rounded-md border border-gray-200 bg-gray-50 p-4">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">
                    Invariants
                  </p>
                  <ul className="space-y-2 text-sm">
                    <li className="flex items-center gap-2">
                      {data.ledger.balanced ? (
                        <span className="text-green-600">✓</span>
                      ) : (
                        <span className="text-red-600">✗</span>
                      )}
                      <span className={data.ledger.balanced ? 'text-gray-700' : 'text-red-600'}>
                        Ledger is balanced
                      </span>
                    </li>
                    <li className="flex items-center gap-2">
                      {data.liquidity_ratio > 1.0 ? (
                        <span className="text-green-600">✓</span>
                      ) : (
                        <span className="text-red-600">✗</span>
                      )}
                      <span
                        className={
                          data.liquidity_ratio > 1.0 ? 'text-gray-700' : 'text-red-600'
                        }
                      >
                        Stripe covers liabilities
                      </span>
                    </li>
                    <li className="flex items-center gap-2">
                      {data.liquidity_ratio > 1.05 ? (
                        <span className="text-green-600">✓</span>
                      ) : (
                        <span className="text-yellow-600">⚠</span>
                      )}
                      <span
                        className={
                          data.liquidity_ratio > 1.05
                            ? 'text-gray-700'
                            : 'text-yellow-600'
                        }
                      >
                        Healthy buffer (>5%)
                      </span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>

            {/* Reconciliation History */}
            <div className="border-t border-gray-200 pt-6 mt-6">
              <h3 className="text-sm font-medium text-gray-900 mb-4">Reconciliation History</h3>
              {historyLoading && (
                <div className="animate-pulse">
                  <div className="h-40 bg-gray-200 rounded"></div>
                </div>
              )}

              {!historyLoading && historyData?.records && historyData.records.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="text-left py-2 px-3 font-medium text-gray-600">Date</th>
                        <th className="text-right py-2 px-3 font-medium text-gray-600">Stripe Balance</th>
                        <th className="text-right py-2 px-3 font-medium text-gray-600">Wallet Balance</th>
                        <th className="text-right py-2 px-3 font-medium text-gray-600">Contest Pool</th>
                        <th className="text-right py-2 px-3 font-medium text-gray-600">Difference</th>
                        <th className="text-center py-2 px-3 font-medium text-gray-600">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historyData.records.slice(0, 30).map((record) => (
                        <tr key={record.id} className="border-b border-gray-100">
                          <td className="py-2 px-3 text-gray-900">
                            {new Date(record.created_at).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </td>
                          <td className="py-2 px-3 text-right text-gray-900">
                            {formatCurrency(record.stripe_balance)}
                          </td>
                          <td className="py-2 px-3 text-right text-gray-900">
                            {formatCurrency(record.wallet_balance)}
                          </td>
                          <td className="py-2 px-3 text-right text-gray-900">
                            {formatCurrency(record.contest_pool_balance)}
                          </td>
                          <td className={`py-2 px-3 text-right font-medium ${
                            record.difference === 0
                              ? 'text-green-600'
                              : Math.abs(record.difference) < 100
                                ? 'text-yellow-600'
                                : 'text-red-600'
                          }`}>
                            {formatCurrency(record.difference)}
                          </td>
                          <td className="py-2 px-3 text-center">
                            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                              record.status === 'HEALTHY'
                                ? 'bg-green-100 text-green-800'
                                : record.status === 'WARNING'
                                  ? 'bg-yellow-100 text-yellow-800'
                                  : 'bg-red-100 text-red-800'
                            }`}>
                              {record.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : !historyLoading ? (
                <p className="text-sm text-gray-500">No reconciliation history available yet</p>
              ) : null}
            </div>

            {/* Explanation Footer */}
            <div className="border-t border-gray-200 pt-4 mt-6">
              <p className="text-xs text-gray-500">
                <strong>What this means:</strong> This dashboard monitors three critical invariants:
                (1) Stripe balance should cover all user liabilities (wallets + contest pools);
                (2) Ledger must balance (credits = debits + net); (3) Healthy coverage ratio indicates
                platform solvency. All values are read-only and updated every 60 seconds.
              </p>
              <p className="text-xs text-gray-500 mt-2">
                <strong>Reconciliation History:</strong> Daily automated reconciliation runs at 02:00 UTC
                to verify the financial invariant is maintained. Alerts are sent if discrepancies are detected.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
