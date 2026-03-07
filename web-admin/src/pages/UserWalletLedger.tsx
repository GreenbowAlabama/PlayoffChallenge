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
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [searchInput, setSearchInput] = useState<string>('');

  // Fetch all users for search dropdown
  const { data: users = [] } = useQuery({
    queryKey: ['adminUsers'],
    queryFn: () => getUsers()
  });

  // Fetch wallet ledger for selected user
  const { data: walletLedger, isLoading: ledgerLoading, error: ledgerError } = useQuery({
    queryKey: ['userWalletLedger', selectedUserId],
    queryFn: () => getUserWalletLedger(selectedUserId),
    enabled: !!selectedUserId
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

  const selectedUser = users.find(u => u.id === selectedUserId);

  const handleUserSelect = (userId: string) => {
    setSelectedUserId(userId);
  };

  const handleClearSelection = () => {
    setSelectedUserId('');
    setSearchInput('');
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-gray-900">User Wallet Ledger</h1>
          <p className="text-gray-600 mt-2">Search and verify individual user transactions</p>
        </div>

        {/* User Search Section */}
        <div className="bg-white rounded-lg shadow">
          <div className="p-6">
            <div className="space-y-4">
              {/* Search Input */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Search User by Email or ID
                </label>
                <input
                  type="text"
                  placeholder="Enter email, user ID, or name..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>

              {/* User Dropdown */}
              {searchInput && (
                <div className="max-h-48 overflow-y-auto border border-gray-300 rounded-lg bg-white">
                  {filteredUsers.length === 0 ? (
                    <div className="px-4 py-3 text-sm text-gray-500">
                      No users found matching "{searchInput}"
                    </div>
                  ) : (
                    <ul className="divide-y divide-gray-200">
                      {filteredUsers.map(user => (
                        <li key={user.id}>
                          <button
                            type="button"
                            onClick={() => handleUserSelect(user.id)}
                            className="w-full text-left px-4 py-2 hover:bg-indigo-50 text-sm transition-colors"
                          >
                            <div className="font-medium text-gray-900">{user.name || 'Unnamed'}</div>
                            <div className="text-xs text-gray-500">{user.email}</div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {/* Selected User Info */}
              {selectedUser && (
                <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="text-sm font-semibold text-gray-900">Selected User</div>
                      <div className="text-sm text-gray-600">{selectedUser.name || 'Unnamed'}</div>
                      <div className="text-xs text-gray-500 mt-1">{selectedUser.email}</div>
                      <div className="text-xs text-gray-500 font-mono mt-1">{selectedUser.id}</div>
                    </div>
                    <button
                      type="button"
                      onClick={handleClearSelection}
                      className="px-3 py-1 text-sm text-indigo-600 hover:text-indigo-700 hover:bg-indigo-100 rounded transition-colors"
                    >
                      Clear
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Wallet Summary */}
        {selectedUserId && walletLedger && (
          <div className="bg-white rounded-lg shadow">
            <div className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Current Balance
                  </div>
                  <div className="text-2xl font-bold text-gray-900 mt-1">
                    {formatUSD(walletLedger.current_balance_cents)}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Total Transactions
                  </div>
                  <div className="text-2xl font-bold text-gray-900 mt-1">
                    {walletLedger.transactions.length}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                    User ID
                  </div>
                  <div className="text-sm font-mono text-gray-600 mt-1">
                    {walletLedger.user_id.slice(0, 8)}...
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Loading State */}
        {selectedUserId && ledgerLoading && (
          <div className="bg-white rounded-lg shadow p-6 text-center">
            <div className="text-gray-500">Loading wallet transactions...</div>
          </div>
        )}

        {/* Error State */}
        {selectedUserId && ledgerError && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-6">
            <div className="text-red-700 font-medium">Error loading wallet ledger</div>
            <div className="text-sm text-red-600 mt-1">
              {ledgerError instanceof Error ? ledgerError.message : 'Unknown error'}
            </div>
          </div>
        )}

        {/* Transaction History Table */}
        {selectedUserId && walletLedger && walletLedger.transactions.length > 0 && (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Transaction History</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-3 text-left font-semibold text-gray-900">Date</th>
                    <th className="px-6 py-3 text-left font-semibold text-gray-900">Time</th>
                    <th className="px-6 py-3 text-left font-semibold text-gray-900">Type</th>
                    <th className="px-6 py-3 text-left font-semibold text-gray-900">Direction</th>
                    <th className="px-6 py-3 text-right font-semibold text-gray-900">Amount</th>
                    <th className="px-6 py-3 text-left font-semibold text-gray-900">Reference ID</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {walletLedger.transactions.map((txn: WalletTransaction) => (
                    <tr key={txn.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-3 text-gray-600">{formatDate(txn.created_at)}</td>
                      <td className="px-6 py-3 text-gray-600">{formatTime(txn.created_at)}</td>
                      <td className="px-6 py-3">
                        <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-gray-100 text-gray-800">
                          {txn.entry_type}
                        </span>
                      </td>
                      <td className="px-6 py-3">
                        <span
                          className={`inline-flex items-center px-2 py-1 rounded text-xs font-semibold ${
                            txn.direction === 'CREDIT'
                              ? 'bg-green-100 text-green-800'
                              : 'bg-red-100 text-red-800'
                          }`}
                        >
                          {txn.direction === 'CREDIT' ? '+' : '-'}
                        </span>
                      </td>
                      <td className="px-6 py-3 text-right font-semibold">
                        <span
                          className={
                            txn.direction === 'CREDIT'
                              ? 'text-green-600'
                              : 'text-red-600'
                          }
                        >
                          {txn.direction === 'CREDIT' ? '+' : '-'}{formatUSD(txn.amount_cents)}
                        </span>
                      </td>
                      <td className="px-6 py-3 text-gray-500 font-mono text-xs">
                        {txn.reference_id.slice(0, 8)}...
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Empty State */}
        {selectedUserId && walletLedger && walletLedger.transactions.length === 0 && (
          <div className="bg-white rounded-lg shadow p-6 text-center">
            <div className="text-gray-500">No transactions found for this user</div>
          </div>
        )}
      </div>
    </div>
  );
}
