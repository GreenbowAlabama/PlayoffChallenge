import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getUsers, getUserDetail } from '../api/users';
import type { User, UserDetail, LedgerEntry, UserContest } from '../types';

// Helper to format cents as USD
function formatUSD(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// Helper to format date
function formatDate(dateString: string | null): string {
  if (!dateString) return 'N/A';
  return new Date(dateString).toLocaleDateString();
}

// Helper to format datetime
function formatDateTime(dateString: string | null): string {
  if (!dateString) return 'N/A';
  return new Date(dateString).toLocaleString();
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
        <tr className="bg-gray-50">
          <td colSpan={8} className="px-6 py-4">
            {isLoading ? (
              <div className="text-sm text-gray-500">Loading...</div>
            ) : error ? (
              <div className="text-sm text-red-600">Error: {error}</div>
            ) : detail ? (
              <div className="space-y-4">
                {/* Recent Ledger Entries */}
                {detail.recent_ledger_entries && detail.recent_ledger_entries.length > 0 && (
                  <section>
                    <h4 className="text-sm font-semibold text-gray-900 mb-2">Recent Wallet Activity</h4>
                    <ul className="space-y-1 text-xs">
                      {detail.recent_ledger_entries.map((entry: LedgerEntry) => (
                        <li key={entry.id} className="flex gap-2 text-gray-600">
                          <span className="w-12">{formatDate(entry.created_at)}</span>
                          <span className="w-20">{entry.entry_type}</span>
                          <span className={entry.direction === 'CREDIT' ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>
                            {entry.direction === 'CREDIT' ? '+' : '-'}{formatUSD(entry.amount_cents)}
                          </span>
                          {entry.contest_status && (
                            <span className="text-gray-500">{entry.contest_status}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {/* Active Contests */}
                {detail.contests && detail.contests.length > 0 && (
                  <section>
                    <h4 className="text-sm font-semibold text-gray-900 mb-2">Contests</h4>
                    <ul className="space-y-1 text-xs">
                      {detail.contests.map((contest: UserContest) => (
                        <li key={contest.id} className="flex gap-2 text-gray-600">
                          <span className="font-medium">{contest.contest_name || 'Unknown Contest'}</span>
                          <span className={`px-2 py-0.5 rounded text-white text-xs ${
                            contest.status === 'SCHEDULED' ? 'bg-blue-500' :
                            contest.status === 'LOCKED' ? 'bg-yellow-500' :
                            contest.status === 'LIVE' ? 'bg-green-500' :
                            contest.status === 'COMPLETE' ? 'bg-gray-500' :
                            'bg-gray-400'
                          }`}>
                            {contest.status}
                          </span>
                          <span className="text-gray-500">Entry: {formatUSD(contest.entry_fee_cents)}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {(!detail.recent_ledger_entries || detail.recent_ledger_entries.length === 0) &&
                 (!detail.contests || detail.contests.length === 0) && (
                  <div className="text-sm text-gray-500">No activity</div>
                )}
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
        <div className="mt-4 sm:mt-0">
          <input
            type="text"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="Filter by username, email, or name..."
            className="w-80 px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
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
              <thead>
                <tr>
                  <th className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-900 sm:pl-0">
                    User
                  </th>
                  <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
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
                  <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                    Wallet Balance
                  </th>
                  <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                    Lifetime Deposits
                  </th>
                  <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                    Lifetime Withdrawals
                  </th>
                  <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                    Active Contests
                  </th>
                  <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                    Last Wallet Activity
                  </th>
                  <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {displayedUsers?.map((user) => (
                  <>
                    <tr key={user.id}>
                      <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-gray-900 sm:pl-0">
                        {user.username || 'N/A'}
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
                      <td className="whitespace-nowrap px-3 py-4 text-sm">
                        <span className={user.wallet_balance_cents >= 0 ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>
                          {formatUSD(user.wallet_balance_cents)}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-green-600 font-medium">
                        {formatUSD(user.lifetime_deposits_cents)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-red-600 font-medium">
                        {formatUSD(user.lifetime_withdrawals_cents)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-900 font-medium">
                        {user.active_contests_count}
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                        {formatDateTime(user.last_wallet_activity_at)}
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
