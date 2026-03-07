import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getUsers, getUserWalletLedger } from '../api/users';
import type { UserWalletLedger, WalletTransaction } from '../api/users';

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
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-gray-900">User Wallet Ledger</h1>
          <p className="text-gray-600 mt-2">Click any user row to view their wallet balance and transaction history</p>
        </div>

        {/* Search Filter */}
        <div className="bg-white rounded-lg shadow p-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Filter Users by Email, ID, or Name
          </label>
          <input
            type="text"
            placeholder="Search..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          />
        </div>

        {/* Users List Table */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          {usersLoading ? (
            <div className="p-6 text-center text-gray-500">Loading users...</div>
          ) : filteredUsers.length === 0 ? (
            <div className="p-6 text-center text-gray-500">
              {searchInput ? `No users found matching "${searchInput}"` : 'No users found'}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
                <tr>
                  <th className="w-8"></th>
                  <th className="px-6 py-3 text-left font-semibold text-gray-900">Name</th>
                  <th className="px-6 py-3 text-left font-semibold text-gray-900">Email</th>
                  <th className="px-6 py-3 text-left font-semibold text-gray-900">ID</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filteredUsers.map(user => (
                  <>
                    <tr
                      key={user.id}
                      onClick={() => handleToggleExpanded(user.id)}
                      className="cursor-pointer hover:bg-gray-50 transition-colors"
                    >
                      <td className="px-3 py-3 text-center">
                        <span className={`inline-block transition-transform ${expandedUserId === user.id ? 'rotate-90' : ''}`}>
                          ▶
                        </span>
                      </td>
                      <td className="px-6 py-3 text-gray-900 font-medium">{user.name || 'Unnamed'}</td>
                      <td className="px-6 py-3 text-gray-600">{user.email || '-'}</td>
                      <td className="px-6 py-3 text-gray-500 font-mono text-xs">{user.id.slice(0, 8)}...</td>
                    </tr>

                    {/* Expanded Row */}
                    {expandedUserId === user.id && (
                      <tr className="bg-indigo-50 border-b-2 border-indigo-200">
                        <td colSpan={4} className="px-6 py-6">
                          {ledgerLoading ? (
                            <div className="text-center text-gray-500">Loading wallet data...</div>
                          ) : ledgerError ? (
                            <div className="bg-red-50 border border-red-200 rounded p-4">
                              <div className="text-red-700 font-medium">Error loading wallet ledger</div>
                              <div className="text-sm text-red-600 mt-1">
                                {ledgerError instanceof Error ? ledgerError.message : 'Unknown error'}
                              </div>
                            </div>
                          ) : walletLedger ? (
                            <div className="space-y-6">
                              {/* Wallet Summary */}
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div>
                                  <div className="text-xs font-medium text-gray-600 uppercase tracking-wider">
                                    Current Balance
                                  </div>
                                  <div className="text-2xl font-bold text-gray-900 mt-1">
                                    {formatUSD(walletLedger.current_balance_cents)}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-xs font-medium text-gray-600 uppercase tracking-wider">
                                    Total Transactions
                                  </div>
                                  <div className="text-2xl font-bold text-gray-900 mt-1">
                                    {walletLedger.transactions.length}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-xs font-medium text-gray-600 uppercase tracking-wider">
                                    User ID
                                  </div>
                                  <div className="text-sm font-mono text-gray-600 mt-1">
                                    {walletLedger.user_id}
                                  </div>
                                </div>
                              </div>

                              {/* Transaction History */}
                              {walletLedger.transactions.length > 0 ? (
                                <div className="overflow-x-auto">
                                  <table className="w-full text-xs">
                                    <thead>
                                      <tr className="bg-white border-b border-gray-300">
                                        <th className="px-4 py-2 text-left font-semibold text-gray-700">Date</th>
                                        <th className="px-4 py-2 text-left font-semibold text-gray-700">Time</th>
                                        <th className="px-4 py-2 text-left font-semibold text-gray-700">Type</th>
                                        <th className="px-4 py-2 text-left font-semibold text-gray-700">Dir</th>
                                        <th className="px-4 py-2 text-right font-semibold text-gray-700">Amount</th>
                                        <th className="px-4 py-2 text-left font-semibold text-gray-700">Ref ID</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                      {walletLedger.transactions.map((txn: WalletTransaction) => (
                                        <tr key={txn.id} className="hover:bg-white transition-colors">
                                          <td className="px-4 py-2 text-gray-600">{formatDate(txn.created_at)}</td>
                                          <td className="px-4 py-2 text-gray-600">{formatTime(txn.created_at)}</td>
                                          <td className="px-4 py-2 text-gray-700">{txn.entry_type}</td>
                                          <td className="px-4 py-2">
                                            <span className={txn.direction === 'CREDIT' ? 'text-green-600 font-semibold' : 'text-red-600 font-semibold'}>
                                              {txn.direction === 'CREDIT' ? '+' : '-'}
                                            </span>
                                          </td>
                                          <td className="px-4 py-2 text-right font-semibold">
                                            <span className={txn.direction === 'CREDIT' ? 'text-green-600' : 'text-red-600'}>
                                              {formatUSD(txn.amount_cents)}
                                            </span>
                                          </td>
                                          <td className="px-4 py-2 text-gray-500 font-mono">
                                            {txn.reference_id.slice(0, 8)}...
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              ) : (
                                <div className="text-center text-gray-500 py-4">
                                  No transactions found for this user
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
