import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  getFinancialHealth,
  type FinancialHealthResponse,
} from '../api/admin';
import {
  getNegativePoolContests,
} from '../api/contest-pools';
import {
  getOrphanedFundsSummary,
} from '../api/orphaned-funds';
import { FloatBreakdown } from '../components/FloatBreakdown';
import { getLedgerVerification } from '../api/ledger-verification';

function formatCurrency(cents: number): string {
  const dollars = (cents / 100).toFixed(2);
  return `$${dollars}`;
}

function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

function StatusBadge({ status, label }: { status: 'healthy' | 'warning' | 'critical'; label: string }) {
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

export function Dashboard() {
  const navigate = useNavigate();

  // Financial Health
  const { data: healthData, isLoading: healthLoading } = useQuery({
    queryKey: ['admin', 'financial-health'],
    queryFn: getFinancialHealth,
    refetchInterval: 60000,
  });

  // Anomaly counts
  const { data: poolsData } = useQuery({
    queryKey: ['contestPools', 'negative'],
    queryFn: getNegativePoolContests,
    staleTime: Infinity,
  });

  const { data: orphanedData } = useQuery({
    queryKey: ['orphaned-funds', 'summary'],
    queryFn: getOrphanedFundsSummary,
  });

  // Ledger verification
  const { data: ledgerData } = useQuery({
    queryKey: ['ledgerVerification'],
    queryFn: getLedgerVerification,
    staleTime: 60 * 1000,
  });

  const getHealthStatus = (data: FinancialHealthResponse): 'healthy' | 'warning' | 'critical' => {
    const ledgerBalanced = data.ledger.balanced;
    const liquidityGood = data.liquidity_ratio >= 1.05;

    if (!ledgerBalanced || data.liquidity_ratio < 1.0) {
      return 'critical';
    }
    if (!liquidityGood) {
      return 'warning';
    }
    return 'healthy';
  };

  const healthStatus = healthData ? getHealthStatus(healthData) : 'critical';

  // Count anomalies
  const negativePoolCount = poolsData?.total_count || 0;
  const orphanedFundsCount = orphanedData?.contests_with_stranded_funds.length || 0;
  const totalAnomalies = negativePoolCount + orphanedFundsCount;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
        <p className="mt-1 text-sm text-gray-600">Quick overview of platform financial health</p>
      </div>

      {/* Financial Summary Panel */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-medium text-gray-900">Funds Summary</h2>
              <p className="text-sm text-gray-500">Current platform financial state</p>
            </div>
            {healthData && (
              <StatusBadge
                status={healthStatus}
                label={healthStatus === 'healthy' ? 'Healthy' : healthStatus === 'warning' ? 'Warning' : 'Critical'}
              />
            )}
          </div>
        </div>

        {healthLoading ? (
          <div className="px-4 py-8 text-center text-gray-600">Loading financial data...</div>
        ) : healthData ? (
          <div className="space-y-4 px-4 py-5">
            {/* 3-Box Summary */}
            <div className="grid grid-cols-3 gap-4">
              <div className="rounded border border-gray-200 bg-gray-50 p-3">
                <dt className="text-xs font-semibold text-gray-600 uppercase">Stripe Balance</dt>
                <dd className="mt-1 text-2xl font-semibold text-gray-900">
                  {formatCurrency(healthData.stripe_total_balance)}
                </dd>
              </div>
              <div className="rounded border border-gray-200 bg-gray-50 p-3">
                <dt className="text-xs font-semibold text-gray-600 uppercase">User Wallets</dt>
                <dd className="mt-1 text-2xl font-semibold text-gray-900">
                  {formatCurrency(healthData.wallet_balance)}
                </dd>
              </div>
              <div className="rounded border border-gray-200 bg-gray-50 p-3">
                <dt className="text-xs font-semibold text-gray-600 uppercase">Contest Pools</dt>
                <dd className="mt-1 text-2xl font-semibold text-gray-900">
                  {formatCurrency(healthData.contest_pool_balance)}
                </dd>
              </div>
            </div>

            {/* Liquidity Coverage */}
            <div className="grid grid-cols-2 gap-4 border-t border-gray-200 pt-4">
              <div>
                <dt className="text-sm font-medium text-gray-600">Liquidity Coverage Ratio</dt>
                <dd
                  className={`mt-1 text-lg font-semibold ${healthData.liquidity_ratio >= 1.0 ? 'text-green-700' : 'text-red-700'}`}
                >
                  {formatPercent(healthData.liquidity_ratio)}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-600">Ledger Status</dt>
                <dd className="mt-1">
                  {healthData.ledger.balanced ? (
                    <StatusBadge status="healthy" label="Balanced" />
                  ) : (
                    <StatusBadge status="critical" label="Imbalanced" />
                  )}
                </dd>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* Float Breakdown Widget */}
      <FloatBreakdown
        stripeBalance={healthData?.stripe_total_balance || 0}
        userWalletsTotal={healthData?.wallet_balance || 0}
        contestPoolsTotal={poolsData?.total_negative_cents ? Math.abs(poolsData.total_negative_cents) : 0}
        unaccountedDelta={ledgerData?.is_balanced ? 0 : (ledgerData?.net || 0)}
        isLoading={healthLoading}
        onNavigateToContestPools={() => navigate('/funding')}
        onNavigateToUserWallets={() => navigate('/funding')}
        onNavigateToLedgerVerification={() => navigate('/funding')}
      />

      {/* Alert Panel */}
      {totalAnomalies > 0 && (
        <div className="rounded-lg border-l-4 border-yellow-400 border border-yellow-200 bg-yellow-50 p-4">
          <div className="flex items-start">
            <div className="flex-shrink-0">
              <span className="text-2xl text-yellow-600">⚠</span>
            </div>
            <div className="ml-3 flex-1">
              <h3 className="text-sm font-medium text-yellow-800">Funding Issues Detected</h3>
              <div className="mt-2 text-sm text-yellow-700">
                <ul className="list-disc list-inside space-y-1">
                  {negativePoolCount > 0 && <li>{negativePoolCount} contest(s) with negative pool balances</li>}
                  {orphanedFundsCount > 0 && <li>{orphanedFundsCount} contest(s) with stranded funds</li>}
                </ul>
              </div>
              <div className="mt-4">
                <button
                  onClick={() => navigate('/funding')}
                  className="inline-flex items-center rounded-md bg-yellow-600 px-4 py-2 text-sm font-medium text-white hover:bg-yellow-700"
                >
                  View Funding Page →
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
