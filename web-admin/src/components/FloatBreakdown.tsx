/**
 * Platform Float Breakdown Widget
 *
 * Displays platform float analysis across multiple dimensions:
 * - Stripe Account (external liability)
 * - User Wallets (internal liability)
 * - Contest Pools (internal liability)
 * - Unaccounted delta (problem indicator)
 *
 * Provides navigation links to diagnostic pages for deeper investigation.
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export interface FloatBreakdownProps {
  stripeBalance?: number; // cents
  userWalletsTotal?: number; // cents
  contestPoolsTotal?: number; // cents (sum of negative pools)
  unaccountedDelta?: number; // cents (negative = deficit)
  isLoading?: boolean;
  onNavigateToContestPools?: () => void;
  onNavigateToUserWallets?: () => void;
  onNavigateToLedgerVerification?: () => void;
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function FloatComponent({
  label,
  value,
  type = 'neutral',
  onNavigate,
  description,
}: {
  label: string;
  value: number;
  type?: 'positive' | 'negative' | 'neutral' | 'warning';
  onNavigate?: () => void;
  description?: string;
}) {
  const textColorMap = {
    positive: 'text-green-700',
    negative: 'text-red-700',
    neutral: 'text-gray-700',
    warning: 'text-yellow-700',
  };

  const bgColorMap = {
    positive: 'bg-green-50 border-green-200',
    negative: 'bg-red-50 border-red-200',
    neutral: 'bg-gray-50 border-gray-200',
    warning: 'bg-yellow-50 border-yellow-200',
  };

  const iconMap = {
    positive: '↗',
    negative: '↘',
    neutral: '→',
    warning: '⚠',
  };

  return (
    <div
      className={`rounded-lg border p-4 ${bgColorMap[type]} ${
        onNavigate ? 'cursor-pointer hover:shadow-md transition-shadow' : ''
      }`}
      onClick={onNavigate}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-xs font-medium text-gray-600 uppercase">{label}</p>
          <p className={`mt-2 text-2xl font-semibold ${textColorMap[type]}`}>
            {formatCents(value)}
          </p>
          {description && <p className="mt-2 text-xs text-gray-600">{description}</p>}
        </div>
        <span className="text-3xl text-gray-300">{iconMap[type]}</span>
      </div>
      {onNavigate && <p className="mt-2 text-xs text-gray-500">Click to investigate →</p>}
    </div>
  );
}

export function FloatBreakdown({
  stripeBalance = 66944,
  userWalletsTotal = 49000,
  contestPoolsTotal = 24000,
  unaccountedDelta = -6056,
  isLoading = false,
  onNavigateToContestPools,
  onNavigateToUserWallets,
  onNavigateToLedgerVerification,
}: FloatBreakdownProps) {
  const navigate = useNavigate();
  const [totalDelta, setTotalDelta] = useState(0);

  useEffect(() => {
    // Total = stripe + wallets + pools + unaccounted
    // All positive means platform assets minus liabilities
    const total = stripeBalance - userWalletsTotal - contestPoolsTotal + unaccountedDelta;
    setTotalDelta(total);
  }, [stripeBalance, userWalletsTotal, contestPoolsTotal, unaccountedDelta]);

  const hasDiscrepancy = unaccountedDelta !== 0;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        {/* Header */}
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
          <h2 className="text-lg font-medium text-gray-900">Platform Float Analysis</h2>
          <p className="mt-1 text-sm text-gray-600">
            Where does platform money come from and where does it go?
          </p>
        </div>

        {/* Content */}
        <div className="px-4 py-6">
          {isLoading ? (
            <div className="text-center text-gray-600">Loading float data...</div>
          ) : (
            <>
              {/* Float Components */}
              <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
                <FloatComponent
                  label="Stripe Account"
                  value={stripeBalance}
                  type="positive"
                  description="Platform balance at payment processor (external source)"
                />
                <FloatComponent
                  label="User Wallets Owed"
                  value={userWalletsTotal}
                  type="negative"
                  onNavigate={onNavigateToUserWallets}
                  description="Sum of all user wallet balances (platform owes users)"
                />
                <FloatComponent
                  label="Contest Pools Deficit"
                  value={contestPoolsTotal}
                  type="negative"
                  onNavigate={onNavigateToContestPools}
                  description="Sum of negative contest pool balances"
                />
                <FloatComponent
                  label={hasDiscrepancy ? 'Unaccounted Loss' : 'Float Delta'}
                  value={unaccountedDelta}
                  type={hasDiscrepancy ? 'warning' : 'neutral'}
                  onNavigate={hasDiscrepancy ? onNavigateToLedgerVerification : undefined}
                  description={
                    hasDiscrepancy
                      ? 'Missing balance not accounted for'
                      : 'Balanced (no discrepancy)'
                  }
                />
              </div>

              {/* Calculation Explanation */}
              <div className="rounded border border-gray-200 bg-gray-50 p-4 mb-6">
                <p className="text-sm font-medium text-gray-900 mb-3">How Float Works</p>
                <div className="space-y-2 text-sm text-gray-700">
                  <div className="flex items-center justify-between">
                    <span>Stripe balance (platform assets):</span>
                    <span className="font-mono font-semibold text-green-700">
                      +{formatCents(stripeBalance)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>User wallets (platform owes):</span>
                    <span className="font-mono font-semibold text-red-700">
                      −{formatCents(userWalletsTotal)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Contest pool deficits (platform owes):</span>
                    <span className="font-mono font-semibold text-red-700">
                      −{formatCents(contestPoolsTotal)}
                    </span>
                  </div>
                  <div className="border-t border-gray-300 pt-2 flex items-center justify-between">
                    <span>Calculated float:</span>
                    <span
                      className={`font-mono font-semibold ${
                        totalDelta >= 0 ? 'text-green-700' : 'text-red-700'
                      }`}
                    >
                      {totalDelta >= 0 ? '+' : '−'}
                      {formatCents(Math.abs(totalDelta))}
                    </span>
                  </div>
                </div>
              </div>

              {/* Diagnostic Path */}
              {hasDiscrepancy && (
                <div className="rounded border border-red-200 bg-red-50 p-4">
                  <p className="text-sm font-semibold text-red-900 mb-3">
                    ⚠️ {formatCents(Math.abs(unaccountedDelta))} Unaccounted Loss Detected
                  </p>
                  <p className="text-sm text-red-800 mb-4">
                    The platform has a {formatCents(Math.abs(unaccountedDelta))} discrepancy that doesn't match
                    expected liabilities. Use the diagnostic tools below to investigate where the loss occurred.
                  </p>
                  <div className="space-y-2 text-sm">
                    <p className="font-medium text-red-900">Diagnostic Steps:</p>
                    <ol className="space-y-2 list-decimal list-inside text-red-800">
                      <li>
                        <button
                          onClick={onNavigateToContestPools}
                          className="text-red-700 hover:underline font-medium"
                        >
                          Check Contest Pool Diagnostics
                        </button>
                        — Are there unexpected negative pools?
                      </li>
                      <li>
                        <button
                          onClick={onNavigateToUserWallets}
                          className="text-red-700 hover:underline font-medium"
                        >
                          Check User Wallet Ledger
                        </button>
                        — Do wallets show balances that don't match ledger entries?
                      </li>
                      <li>
                        <button
                          onClick={onNavigateToLedgerVerification}
                          className="text-red-700 hover:underline font-medium"
                        >
                          Check Ledger Verification
                        </button>
                        — Is the ledger itself balanced?
                      </li>
                      <li>
                        If all checks pass, contact engineering with this screenshot and the unaccounted amount.
                      </li>
                    </ol>
                  </div>
                </div>
              )}

              {!hasDiscrepancy && (
                <div className="rounded border border-green-200 bg-green-50 p-4">
                  <p className="text-sm text-green-800">
                    ✓ Platform float is balanced. All liabilities are accounted for.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Quick Help */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm p-4">
        <p className="text-xs font-medium text-gray-600 mb-2">💡 WHAT IS FLOAT?</p>
        <p className="text-xs text-gray-700">
          Float is the difference between Stripe balance and all platform liabilities (user wallets + contest
          pools). A negative float means the platform owes more than it has. A positive float means the platform
          has a buffer.
        </p>
      </div>
    </div>
  );
}
