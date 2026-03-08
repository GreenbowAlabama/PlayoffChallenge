import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getUsers, getUserDetail } from '../api/users';
import type { User, UserDetail, LedgerEntry, UserContest } from '../types';

// Helper to format cents as USD
function formatUSD(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// Helper to format date only (e.g., "Mar 8")
function formatDateShort(dateString: string | null): string {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Helper to format time only (e.g., "12:15 PM")
function formatTimeShort(dateString: string | null): string {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// Helper to check if user is a system user
function isSystemUser(username: string): boolean {
  return username.startsWith('platform_') ||
         username.startsWith('staging_') ||
         username.includes('system@');
}

// Helper to calculate entry velocity (entries in last 60 minutes)
function calculateEntryVelocity(entries: LedgerEntry[]): number {
  const oneHourAgo = Date.now() - (60 * 60 * 1000);
  return entries.filter(entry =>
    entry.entry_type === 'ENTRY_FEE' &&
    new Date(entry.created_at).getTime() > oneHourAgo
  ).length;
}

// Expandable detail panel for user wallet activity
function UserDetailPanel({ user }: { user: User }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleExpand = async () => {
    if (isExpanded) {
      setIsExpanded(false);
      return;
    }

    if (!detail) {
      setIsLoading(true);
      setError(null);
      try {
        const data = await getUserDetail(user.id);
        setDetail(data);
      } catch (err) {
        console.error('Failed to load user detail:', err);
        setError(err instanceof Error ? err.message : 'Failed to load details');
      } finally {
        setIsLoading(false);
      }
    }

    setIsExpanded(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={handleExpand}
        className="inline-flex items-center gap-1 px-3 py-2 text-xs font-semibold text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 rounded focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-indigo-500"
        title="Click to expand user details"
      >
        {isExpanded ? '▼ Hide' : '▶ Show'} Details
      </button>

      {isExpanded && (
        <tr className="bg-gray-50 border-t-2 border-gray-200">
          <td colSpan={6} className="px-6 py-6">
            {isLoading ? (
              <div className="text-sm text-gray-500">Loading...</div>
            ) : error ? (
              <div className="text-sm text-red-600">Error: {error}</div>
            ) : detail ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Wallet Activity Panel */}
                <section>
                  <div className="flex items-baseline gap-2 mb-3">
                    <h4 className="text-sm font-semibold text-gray-900">Wallet Activity</h4>
                    {detail.recent_ledger_entries && detail.recent_ledger_entries.length > 0 && (
                      (() => {
                        const velocity = calculateEntryVelocity(detail.recent_ledger_entries);
                        return (
                          <div className="flex items-center gap-1">
                            <span className={`text-xs ${velocity >= 3 ? 'text-green-600 font-medium' : 'text-gray-500'}`}>
                              ⚡ {velocity} entries/hr
                            </span>
                            {velocity >= 5 && (
                              <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded font-medium">
                                HOT
                              </span>
                            )}
                          </div>
                        );
                      })()
                    )}
                  </div>
                  {detail.recent_ledger_entries && detail.recent_ledger_entries.length > 0 ? (
                    <ul className="space-y-2">
                      {detail.recent_ledger_entries.slice(0, 5).map((entry: LedgerEntry) => (
                        <li key={entry.id} className="grid grid-cols-3 gap-2 text-xs">
                          <span className="text-gray-500">{formatDateShort(entry.created_at)}</span>
                          <span className="text-gray-600 col-span-1">{entry.entry_type}</span>
                          <span className={`text-right font-medium ${entry.direction === 'CREDIT' ? 'text-green-600' : 'text-red-600'}`}>
                            {entry.direction === 'CREDIT' ? '+' : '-'}{formatUSD(entry.amount_cents)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-gray-400 text-sm">No wallet activity</p>
                  )}
                </section>

                {/* Contest Entries Panel */}
                <section>
                  <h4 className="text-sm font-semibold text-gray-900 mb-3">Contest Entries</h4>
                  {detail.contests && detail.contests.length > 0 ? (
                    <div className="space-y-2">
                      {detail.contests.map((contest: UserContest) => (
                        <div key={contest.id} className="border border-gray-200 rounded p-3 text-xs">
                          <div className="font-medium text-gray-900 mb-1">{contest.contest_name || 'Unknown Contest'}</div>
                          <div className="flex items-center justify-between">
                            <span className={`px-2 py-0.5 rounded text-white text-xs font-medium ${
                              contest.status === 'SCHEDULED' ? 'bg-blue-500' :
                              contest.status === 'LOCKED' ? 'bg-yellow-500' :
                              contest.status === 'LIVE' ? 'bg-green-500' :
                              contest.status === 'COMPLETE' ? 'bg-gray-500' :
                              contest.status === 'CANCELLED' ? 'bg-red-500' :
                              'bg-gray-400'
                            }`}>
                              {contest.status}
                            </span>
                            <span className="text-gray-600">Entry {formatUSD(contest.entry_fee_cents)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-gray-400 text-sm">No contest entries</p>
                  )}
                </section>
              </div>
            ) : (
              <div className="text-sm text-gray-500">No data available</div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

export function Users() {
  const [copiedEmailId, setCopiedEmailId] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);
  const [filterText, setFilterText] = useState('');
  const [sortColumn, setSortColumn] = useState<'balance' | 'deposits' | 'activity' | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  const copyEmailToClipboard = useCallback(async (email: string, userId: string) => {
    try {
      await navigator.clipboard.writeText(email);
      setCopiedEmailId(userId);
      setTimeout(() => setCopiedEmailId(null), 1500);
    } catch (err) {
      console.error('Failed to copy email:', err);
    }
  }, []);

  const copyAllEmails = useCallback(async (userList: User[]) => {
    const emails = userList
      .map((user) => user.email)
      .filter((email): email is string => Boolean(email));

    if (emails.length === 0) return;

    try {
      await navigator.clipboard.writeText(emails.join(', '));
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 1500);
    } catch (err) {
      console.error('Failed to copy emails:', err);
    }
  }, []);

  const handleSort = (column: 'balance' | 'deposits' | 'activity') => {
    if (sortColumn === column) {
      // Toggle direction if clicking same column
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      // New column, default to desc
      setSortColumn(column);
      setSortDirection('desc');
    }
  };

  const { data: users, isLoading, error } = useQuery({
    queryKey: ['users'],
    queryFn: getUsers,
  });

  const displayedUsers = users?.filter(u => {
    if (filterText) {
      const searchTerm = filterText.toLowerCase();
      const matchesUsername = u.username?.toLowerCase().includes(searchTerm);
      const matchesEmail = u.email?.toLowerCase().includes(searchTerm);
      const matchesName = u.name?.toLowerCase().includes(searchTerm);
      if (!matchesUsername && !matchesEmail && !matchesName) return false;
    }
    return true;
  }).sort((a, b) => {
    if (!sortColumn) return 0;

    let aVal: number;
    let bVal: number;

    switch (sortColumn) {
      case 'balance':
        aVal = a.wallet_balance_cents;
        bVal = b.wallet_balance_cents;
        break;
      case 'deposits':
        aVal = a.lifetime_deposits_cents;
        bVal = b.lifetime_deposits_cents;
        break;
      case 'activity':
        aVal = a.last_wallet_activity_at ? new Date(a.last_wallet_activity_at).getTime() : 0;
        bVal = b.last_wallet_activity_at ? new Date(b.last_wallet_activity_at).getTime() : 0;
        break;
      default:
        return 0;
    }

    if (sortDirection === 'asc') {
      return aVal - bVal;
    } else {
      return bVal - aVal;
    }
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-600">Loading users...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md bg-red-50 p-4">
        <p className="text-sm text-red-800">
          Failed to load users: {error instanceof Error ? error.message : 'Unknown error'}
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="sm:flex sm:items-center sm:justify-between">
        <div className="sm:flex-auto">
          <h1 className="text-2xl font-semibold text-gray-900">Platform Users</h1>
          <p className="mt-2 text-sm text-gray-700">
            Operational dashboard for wallet visibility and contest participation
          </p>
        </div>
        <div className="mt-4 sm:mt-0 relative">
          <svg className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="Filter by username, email, or name..."
            className="w-80 pl-9 pr-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
        </div>
      </div>

      <div className="mt-8 flow-root">
        <div className="relative">
          {/* Scroll hint gradient - mobile only */}
          <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-white to-transparent pointer-events-none z-10 sm:hidden" aria-hidden="true" />
          <div className="-mx-4 -my-2 overflow-x-auto sm:-mx-6 lg:-mx-8">
            <div className="inline-block min-w-full py-2 align-middle sm:px-6 lg:px-8">
            <table className="min-w-full divide-y divide-gray-300">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-gray-300">
                  <th className="py-4 pl-4 pr-3 text-left text-sm font-semibold text-gray-900 sm:pl-0">
                    User
                  </th>
                  <th className="px-3 py-4 text-left text-sm font-semibold text-gray-900">
                    <div className="flex items-center gap-2">
                      Email
                      <button
                        type="button"
                        onClick={() => displayedUsers && copyAllEmails(displayedUsers)}
                        className="inline-flex items-center gap-1 text-xs font-normal text-gray-500 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-indigo-500 rounded px-1.5 py-0.5 transition-colors"
                        title="Copy all emails"
                      >
                        {copiedAll ? (
                          <>
                            <svg className="h-3.5 w-3.5 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                            <span className="text-green-600">Copied</span>
                          </>
                        ) : (
                          <>
                            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                            <span>Copy all</span>
                          </>
                        )}
                      </button>
                    </div>
                  </th>
                  <th className="px-3 py-4 text-left text-sm font-semibold text-gray-900">
                    <button
                      type="button"
                      onClick={() => handleSort('balance')}
                      className="inline-flex items-center gap-1 hover:text-indigo-600 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-indigo-500 rounded px-1 -mx-1"
                      title="Click to sort by wallet balance"
                    >
                      Wallet
                      {sortColumn === 'balance' && (
                        <span className={`inline-block transform transition-transform ${sortDirection === 'desc' ? '' : 'rotate-180'}`}>
                          ↓
                        </span>
                      )}
                    </button>
                  </th>
                  <th className="px-3 py-4 text-left text-sm font-semibold text-gray-900">
                    <button
                      type="button"
                      onClick={() => handleSort('deposits')}
                      className="inline-flex items-center gap-1 hover:text-indigo-600 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-indigo-500 rounded px-1 -mx-1"
                      title="Click to sort by lifetime deposits"
                    >
                      Deposits
                      {sortColumn === 'deposits' && (
                        <span className={`inline-block transform transition-transform ${sortDirection === 'desc' ? '' : 'rotate-180'}`}>
                          ↓
                        </span>
                      )}
                    </button>
                  </th>
                  <th className="px-3 py-4 text-left text-sm font-semibold text-gray-900">
                    Contests
                  </th>
                  <th className="px-3 py-4 text-left text-sm font-semibold text-gray-900">
                    <button
                      type="button"
                      onClick={() => handleSort('activity')}
                      className="inline-flex items-center gap-1 hover:text-indigo-600 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-indigo-500 rounded px-1 -mx-1"
                      title="Click to sort by last activity"
                    >
                      Last Activity
                      {sortColumn === 'activity' && (
                        <span className={`inline-block transform transition-transform ${sortDirection === 'desc' ? '' : 'rotate-180'}`}>
                          ↓
                        </span>
                      )}
                    </button>
                  </th>
                  <th className="px-3 py-4 text-left text-sm font-semibold text-gray-900">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {displayedUsers?.map((user) => (
                  <>
                    <tr key={user.id}>
                      <td className="py-4 pl-4 pr-3 text-sm font-medium text-gray-900 sm:pl-0">
                        <div className="flex items-center gap-2">
                          <span>{user.username || 'N/A'}</span>
                          {user.username && isSystemUser(user.username) && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-200 text-gray-700">
                              SYSTEM
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-4 text-sm text-gray-500">
                        <div className="flex items-center gap-1.5">
                          <span>{user.email || 'N/A'}</span>
                          {user.email && (
                            <button
                              type="button"
                              onClick={() => copyEmailToClipboard(user.email!, user.id)}
                              className="p-0.5 rounded hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-indigo-500 transition-colors"
                              title="Copy email"
                              aria-label={`Copy ${user.email}`}
                            >
                              {copiedEmailId === user.id ? (
                                <svg className="h-4 w-4 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                </svg>
                              ) : (
                                <svg className="h-4 w-4 text-gray-300 hover:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                </svg>
                              )}
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-4 text-sm">
                        <div>
                          <span className={user.wallet_balance_cents >= 0 ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>
                            {formatUSD(user.wallet_balance_cents)}
                          </span>
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          Withdrawals {formatUSD(user.lifetime_withdrawals_cents)}
                        </div>
                      </td>
                      <td className="px-3 py-4 text-sm text-green-600 font-medium">
                        {formatUSD(user.lifetime_deposits_cents)}
                      </td>
                      <td className="px-3 py-4 text-sm">
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
                          {user.active_contests_count} Active
                        </span>
                      </td>
                      <td className="px-3 py-4 text-sm text-gray-500">
                        {user.last_wallet_activity_at ? (
                          <div>
                            <div>{formatDateShort(user.last_wallet_activity_at)}</div>
                            <div className="text-xs text-gray-400">{formatTimeShort(user.last_wallet_activity_at)}</div>
                          </div>
                        ) : (
                          'N/A'
                        )}
                      </td>
                      <td className="px-3 py-4 text-sm font-medium">
                        <UserDetailPanel user={user} />
                      </td>
                    </tr>
                  </>
                ))}
              </tbody>
            </table>

            {displayedUsers?.length === 0 && (
              <div className="text-center py-12">
                <p className="text-sm text-gray-500">No users found</p>
              </div>
            )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
