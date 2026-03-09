/**
 * Financial Ops Tower
 *
 * Displays platform financial health, ledger integrity, wallet liability,
 * contest pools, settlement pipeline, and payout execution.
 */

import { useQuery } from '@tanstack/react-query';
import { getFinancialOpsSnapshot, type FinancialOpsSnapshot } from '../../../api/financial-ops';
import { InfoTooltip } from '../../../components/InfoTooltip';
import { RefreshIndicator } from '../../../components/admin/RefreshIndicator';

function formatCurrency(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatTimestamp(timestamp: string | undefined): string {
  if (!timestamp) return '—';
  try {
    return new Date(timestamp).toLocaleString();
  } catch {
    return '—';
  }
}

function MetricCard({
  title,
  value,
  label,
  tooltip,
  variant = 'default',
  secondary,
}: {
  title: string;
  value: string | number;
  label?: string;
  tooltip?: string;
  variant?: 'default' | 'warning' | 'error' | 'success';
  secondary?: { label: string; value: string | number };
}) {
  const variantStyles: Record<string, string> = {
    default: 'bg-white border-gray-200',
    warning: 'bg-amber-50 border-amber-200',
    error: 'bg-red-50 border-red-200',
    success: 'bg-green-50 border-green-200',
  };

  const valueStyles: Record<string, string> = {
    default: 'text-gray-900',
    warning: 'text-amber-900',
    error: 'text-red-900',
    success: 'text-green-900',
  };

  return (
    <div className={`rounded-lg border ${variantStyles[variant]} p-4 shadow-sm`}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
          {title}
          {tooltip && <InfoTooltip text={tooltip} />}
        </h3>
      </div>
      <p className={`text-2xl font-bold ${valueStyles[variant]} mb-1`}>{value}</p>
      {label && <p className="text-xs text-gray-500">{label}</p>}
      {secondary && (
        <div className="mt-3 pt-3 border-t border-gray-200">
          <p className="text-xs text-gray-600">{secondary.label}</p>
          <p className="text-lg font-bold text-gray-900">{secondary.value}</p>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: 'balanced' | 'drift' }) {
  const colors = {
    balanced: 'bg-green-100 text-green-800 border-green-300',
    drift: 'bg-red-100 text-red-800 border-red-300',
  };

  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium border ${colors[status]}`}>
      {status === 'balanced' ? '✓ Balanced' : '⚠ Drift'}
    </span>
  );
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="text-center">
        <div className="h-8 w-8 border-4 border-gray-300 border-t-indigo-600 rounded-full animate-spin mx-auto mb-3"></div>
        <p className="text-gray-600">Loading financial data...</p>
      </div>
    </div>
  );
}

function ErrorState({ error }: { error: Error }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4">
      <p className="text-sm font-semibold text-red-800">Error loading financial data</p>
      <p className="text-xs text-red-700 mt-1">{error.message}</p>
    </div>
  );
}

function FinancialOpsContent({ snapshot }: { snapshot: FinancialOpsSnapshot }) {
  const reconciliationVariant =
    snapshot.reconciliation.status === 'balanced' ? 'success' : 'error';

  return (
    <div className="space-y-8">
      {/* Header with refresh */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Financial Ops</h1>
          <p className="text-gray-600 mt-1">Platform financial health monitoring</p>
        </div>
        <RefreshIndicator timestamp={snapshot.timestamp} refetchInterval={10000} />
      </div>

      {/* Ledger Health */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Ledger Health</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <MetricCard
            title="Total Credits"
            value={formatCurrency(snapshot.ledger.total_credits_cents)}
            tooltip="Sum of all CREDIT ledger entries"
          />
          <MetricCard
            title="Total Debits"
            value={formatCurrency(snapshot.ledger.total_debits_cents)}
            tooltip="Sum of all DEBIT ledger entries"
          />
          <MetricCard
            title="Net Balance"
            value={formatCurrency(snapshot.ledger.net_cents)}
            tooltip="Credits minus debits"
          />
        </div>
      </section>

      {/* Wallet Liability */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Wallet Liability</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <MetricCard
            title="Total User Wallets"
            value={formatCurrency(snapshot.wallets.wallet_liability_cents)}
            label="Amount owed to users"
            tooltip="Sum of all user wallet balances from ledger"
          />
          <MetricCard
            title="Users with Positive Balance"
            value={snapshot.wallets.users_with_positive_balance}
            label="users with available funds"
            tooltip="Count of users with balance > 0"
          />
        </div>
      </section>

      {/* Contest Pools */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Contest Pools</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <MetricCard
            title="Total Pool Balance"
            value={formatCurrency(snapshot.contest_pools.contest_pools_cents)}
            label="Entry fees minus payouts"
            tooltip="Sum of entry fees (debits) minus refunds and payouts (credits)"
          />
          <MetricCard
            title="Negative Pool Contests"
            value={snapshot.contest_pools.negative_pool_contests}
            label="contests with insufficient funds"
            variant={snapshot.contest_pools.negative_pool_contests > 0 ? 'error' : 'success'}
            tooltip="Contests where payouts exceed collected entry fees"
          />
        </div>
      </section>

      {/* Settlement Pipeline */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Settlement Pipeline</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <MetricCard
            title="Pending Settlements"
            value={snapshot.settlement.pending_settlement_contests}
            label="contests in STARTED state"
            variant={snapshot.settlement.pending_settlement_contests > 0 ? 'warning' : 'success'}
            tooltip="Number of settlement_audit records with status=STARTED"
          />
          <MetricCard
            title="Settlement Failures"
            value={snapshot.settlement.settlement_failures}
            label="contests with FAILED status"
            variant={snapshot.settlement.settlement_failures > 0 ? 'error' : 'success'}
            tooltip="Number of settlement_audit records with status=FAILED"
          />
        </div>
      </section>

      {/* Payout Execution */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Payout Execution</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <MetricCard
            title="Pending Payout Jobs"
            value={snapshot.payouts.pending_payout_jobs}
            label="jobs in pending or processing state"
            variant={snapshot.payouts.pending_payout_jobs > 0 ? 'warning' : 'success'}
            tooltip="Number of payout_jobs with status IN (pending, processing)"
          />
          <MetricCard
            title="Failed Payout Transfers"
            value={snapshot.payouts.failed_payout_transfers}
            label="transfers with terminal failure"
            variant={snapshot.payouts.failed_payout_transfers > 0 ? 'error' : 'success'}
            tooltip="Number of payout_transfers with status=failed_terminal"
          />
        </div>
      </section>

      {/* Reconciliation Status */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Reconciliation Status</h2>
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div>
              <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-3">
                Expected Funding
              </h3>
              <p className="text-2xl font-bold text-gray-900">
                {formatCurrency(snapshot.reconciliation.expected_cents)}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                Wallet liability + Contest pools
              </p>
              <div className="mt-4 space-y-2 border-t pt-4">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-600">Wallet Liability:</span>
                  <span className="text-gray-900 font-mono">
                    {formatCurrency(snapshot.wallets.wallet_liability_cents)}
                  </span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-600">Contest Pools:</span>
                  <span className="text-gray-900 font-mono">
                    {formatCurrency(snapshot.contest_pools.contest_pools_cents)}
                  </span>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-3">
                Actual Funding
              </h3>
              <p className="text-2xl font-bold text-gray-900">
                {formatCurrency(snapshot.reconciliation.actual_cents)}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                Deposits minus withdrawals
              </p>
              <div className="mt-4 space-y-2 border-t pt-4">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-600">Deposits:</span>
                  <span className="text-gray-900 font-mono">
                    {formatCurrency(snapshot.reconciliation.deposits_cents)}
                  </span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-600">Withdrawals:</span>
                  <span className="text-gray-900 font-mono">
                    {formatCurrency(snapshot.reconciliation.withdrawals_cents)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="border-t pt-6 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
                Reconciliation Drift
              </p>
              <p className="text-2xl font-bold text-gray-900">
                {formatCurrency(snapshot.reconciliation.difference_cents)}
              </p>
              {snapshot.reconciliation.difference_cents !== 0 && (
                <p className="text-xs text-red-600 mt-1">
                  {snapshot.reconciliation.difference_cents > 0
                    ? 'Actual less than expected'
                    : 'Actual more than expected'}
                </p>
              )}
            </div>
            <StatusBadge status={snapshot.reconciliation.status} />
          </div>
        </div>
      </section>

      {/* Footer */}
      <div className="text-center text-xs text-gray-500 pt-4 border-t">
        <p>Last updated: {formatTimestamp(snapshot.timestamp)}</p>
      </div>
    </div>
  );
}

export function FinancialOpsPage() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['financialOps'],
    queryFn: getFinancialOpsSnapshot,
    refetchInterval: 10000,
    refetchIntervalInBackground: true,
  });

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="max-w-7xl mx-auto">
        {isLoading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState error={error as Error} />
        ) : data ? (
          <FinancialOpsContent snapshot={data} />
        ) : (
          <div className="text-center py-12 text-gray-600">No data available</div>
        )}
      </div>
    </div>
  );
}
