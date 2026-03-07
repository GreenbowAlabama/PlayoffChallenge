import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getUsers, getUserWalletLedger } from '../api/users';
import type { UserWalletLedger, WalletTransaction } from '../api/users';

// Duplicate detection: find transactions that might be duplicates
function findSuspectedDuplicates(transactions: WalletTransaction[]): Set<string> {
  const suspected = new Set<string>();

  // Look for same entry type, same direction, same amount within 60 seconds
  for (let i = 0; i < transactions.length; i++) {
    for (let j = i + 1; j < transactions.length; j++) {
      const t1 = transactions[i];
      const t2 = transactions[j];

      const timeDiff = Math.abs(new Date(t1.created_at).getTime() - new Date(t2.created_at).getTime());

      if (
        t1.entry_type === t2.entry_type &&
        t1.direction === t2.direction &&
        t1.amount_cents === t2.amount_cents &&
        timeDiff < 60000 && // within 60 seconds
        t1.reference_id !== t2.reference_id // but different reference IDs
      ) {
        suspected.add(t1.id);
        suspected.add(t2.id);
      }
    }
  }

  return suspected;
}

// Helper to format cents as USD
function formatUSD(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// Helper to format date only
function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString();
}

// Helper to format time only
function formatTime(dateString: string): string {
  return new Date(dateString).toLocaleTimeString();
}

export default function UserWalletLedger() {
  const [expandedUserId, setExpandedUserId] = useState<string>('');
  const [searchInput, setSearchInput] = useState<string>('');

  // Fetch all users
  const { data: users = [], isLoading: usersLoading } = useQuery({
    queryKey: ['adminUsers'],
    queryFn: () => getUsers()
  });

  // Fetch wallet ledger for expanded user
  const { data: walletLedger, isLoading: ledgerLoading, error: ledgerError } = useQuery({
    queryKey: ['userWalletLedger', expandedUserId],
    queryFn: () => getUserWalletLedger(expandedUserId),
    enabled: !!expandedUserId
  });

  // Filter users based on search input
  const filteredUsers = users.filter(user => {
    if (!searchInput) return true;
    const lowerInput = searchInput.toLowerCase();
    return (
      user.email?.toLowerCase().includes(lowerInput) ||
      user.id.toLowerCase().includes(lowerInput) ||
      user.name?.toLowerCase().includes(lowerInput)
    );
  });

  const handleToggleExpanded = (userId: string) => {
    setExpandedUserId(expandedUserId === userId ? '' : userId);
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <div className="border-b border-gray-200 pb-6">
          <h1 className="text-4xl font-bold text-gray-900">User Wallet Ledger</h1>
          <p className="text-gray-600 mt-3">Click any user row to expand and view wallet balance and transaction history</p>
        </div>

        {/* Search Filter */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="p-6">
            <label className="block text-sm font-semibold text-gray-900 mb-3">
              Search Users
            </label>
            <div className="relative">
              <svg className="absolute left-3 top-3 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="Search by name, email, or ID..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
              />
            </div>
            {searchInput && (
              <p className="mt-2 text-sm text-gray-600">
                Found {filteredUsers.length} {filteredUsers.length === 1 ? 'user' : 'users'}
              </p>
            )}
          </div>
        </div>

        {/* Users List Table */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          {usersLoading ? (
            <div className="p-12 text-center">
              <div className="text-gray-500">Loading users...</div>
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="p-12 text-center">
              <div className="text-gray-500">
                {searchInput ? `No users found matching "${searchInput}"` : 'No users found'}
              </div>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
                <tr>
                  <th className="w-12 text-center text-gray-600"></th>
                  <th className="px-6 py-4 text-left font-semibold text-gray-900">Name</th>
                  <th className="px-6 py-4 text-left font-semibold text-gray-900">Email</th>
                  <th className="px-6 py-4 text-left font-semibold text-gray-900">User ID</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filteredUsers.map((user, idx) => (
                  <>
                    <tr
                      key={user.id}
                      onClick={() => handleToggleExpanded(user.id)}
                      className={`cursor-pointer transition-all ${
                        expandedUserId === user.id
                          ? 'bg-indigo-50 hover:bg-indigo-100'
                          : idx % 2 === 0 ? 'hover:bg-gray-50' : 'bg-gray-50 hover:bg-gray-100'
                      }`}
                    >
                      <td className="pl-6 py-4 text-center">
                        <span className={`inline-flex text-gray-400 transition-transform duration-200 ${expandedUserId === user.id ? 'rotate-90' : ''}`}>
                          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                          </svg>
                        </span>
                      </td>
                      <td className="px-6 py-4 text-gray-900 font-semibold">{user.name || <span className="text-gray-400 italic">No name</span>}</td>
                      <td className="px-6 py-4 text-gray-600">{user.email || <span className="text-gray-400">-</span>}</td>
                      <td className="px-6 py-4 text-gray-500 font-mono text-xs bg-gray-50 rounded px-2 py-1 w-fit">{user.id.slice(0, 12)}...</td>
                    </tr>

                    {/* Expanded Row */}
                    {expandedUserId === user.id && (
                      <tr className="bg-indigo-50 border-t-2 border-indigo-200">
                        <td colSpan={4} className="px-6 py-8">
                          {ledgerLoading ? (
                            <div className="text-center py-8">
                              <div className="inline-flex items-center gap-2 text-gray-600">
                                <svg className="w-5 h-5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                </svg>
                                Loading wallet data...
                              </div>
                            </div>
                          ) : ledgerError ? (
                            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                              <div className="flex items-start gap-3">
                                <svg className="w-5 h-5 text-red-600 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                                </svg>
                                <div>
                                  <div className="font-semibold text-red-900">Error loading wallet ledger</div>
                                  <div className="text-sm text-red-700 mt-1">
                                    {ledgerError instanceof Error ? ledgerError.message : 'Unknown error'}
                                  </div>
                                </div>
                              </div>
                            </div>
                          ) : walletLedger ? (
                            <div className="space-y-8">
                              {/* Duplicate Warning */}
                              {(() => {
                                const suspected = findSuspectedDuplicates(walletLedger.transactions);
                                return suspected.size > 0 ? (
                                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                                    <div className="flex items-start gap-3">
                                      <span className="text-2xl">⚠️</span>
                                      <div className="flex-1">
                                        <h3 className="font-semibold text-yellow-900">Suspected Duplicate Refunds Detected</h3>
                                        <p className="text-sm text-yellow-800 mt-1">
                                          Found {suspected.size} transaction(s) with same type, direction, and amount within 60 seconds but different reference IDs.
                                        </p>
                                        <p className="text-xs text-yellow-700 mt-2">
                                          <strong>How to verify:</strong> Check if duplicate refunds have <strong>same reference ID</strong> (same contest, legitimate single refund) or <strong>different reference IDs</strong> (different contests, or possible duplicate bug).
                                        </p>
                                      </div>
                                    </div>
                                  </div>
                                ) : null;
                              })()}

                              {/* Wallet Summary */}
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div className="bg-white rounded-lg p-4 border border-indigo-100">
                                  <div className="text-xs font-semibold text-gray-600 uppercase tracking-wider">
                                    💰 Current Balance
                                  </div>
                                  <div className="text-3xl font-bold text-gray-900 mt-2">
                                    {formatUSD(walletLedger.current_balance_cents)}
                                  </div>
                                </div>
                                <div className="bg-white rounded-lg p-4 border border-indigo-100">
                                  <div className="text-xs font-semibold text-gray-600 uppercase tracking-wider">
                                    📊 Transactions
                                  </div>
                                  <div className="text-3xl font-bold text-gray-900 mt-2">
                                    {walletLedger.transactions.length}
                                  </div>
                                </div>
                                <div className="bg-white rounded-lg p-4 border border-indigo-100">
                                  <div className="text-xs font-semibold text-gray-600 uppercase tracking-wider">
                                    🆔 User ID
                                  </div>
                                  <div className="text-sm font-mono text-gray-600 mt-2 break-all">
                                    {walletLedger.user_id}
                                  </div>
                                </div>
                              </div>

                              {/* Transaction History */}
                              {walletLedger.transactions.length > 0 ? (
                                <div>
                                  <h3 className="text-sm font-semibold text-gray-900 mb-4">Transaction History (Most Recent First)</h3>
                                  <div className="overflow-x-auto border border-gray-200 rounded-lg">
                                    <table className="w-full text-xs bg-white">
                                      <thead>
                                        <tr className="bg-gray-50 border-b border-gray-200">
                                          <th className="px-4 py-3 text-left font-semibold text-gray-700">Date & Time</th>
                                          <th className="px-4 py-3 text-left font-semibold text-gray-700">Type</th>
                                          <th className="px-4 py-3 text-center font-semibold text-gray-700">Dir</th>
                                          <th className="px-4 py-3 text-right font-semibold text-gray-700">Amount</th>
                                          <th className="px-4 py-3 text-left font-semibold text-gray-700">Reference ID</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-gray-100">
                                        {(() => {
                                          const suspected = findSuspectedDuplicates(walletLedger.transactions);
                                          return walletLedger.transactions.map((txn: WalletTransaction, txnIdx) => {
                                            const isSuspected = suspected.has(txn.id);
                                            return (
                                              <tr
                                                key={txn.id}
                                                className={`${
                                                  isSuspected
                                                    ? 'bg-yellow-50 border-l-4 border-yellow-400 hover:bg-yellow-100'
                                                    : txnIdx % 2 === 0
                                                      ? 'hover:bg-gray-50'
                                                      : 'bg-gray-50 hover:bg-gray-100'
                                                }`}
                                              >
                                                <td className="px-4 py-3 text-gray-600">
                                                  {formatDate(txn.created_at)} {formatTime(txn.created_at)}
                                                  {isSuspected && <div className="text-yellow-700 text-xs font-semibold mt-0.5">🚨 Suspected Duplicate</div>}
                                                </td>
                                                <td className="px-4 py-3 text-gray-700 font-medium">{txn.entry_type}</td>
                                                <td className="px-4 py-3 text-center">
                                                  <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full font-bold ${txn.direction === 'CREDIT' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                                    {txn.direction === 'CREDIT' ? '+' : '−'}
                                                  </span>
                                                </td>
                                                <td className="px-4 py-3 text-right font-semibold">
                                                  <span className={txn.direction === 'CREDIT' ? 'text-green-600' : 'text-red-600'}>
                                                    {formatUSD(txn.amount_cents)}
                                                  </span>
                                                </td>
                                                <td className="px-4 py-3 text-gray-500 font-mono text-xs break-all" title={txn.reference_id}>
                                                  {txn.reference_id}
                                                </td>
                                              </tr>
                                            );
                                          });
                                        })()}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              ) : (
                                <div className="bg-white rounded-lg p-8 text-center border border-gray-200">
                                  <div className="text-gray-500">
                                    <svg className="w-12 h-12 mx-auto mb-2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    No transactions found for this user
                                  </div>
                                </div>
                              )}
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
