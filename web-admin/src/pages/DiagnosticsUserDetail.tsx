/**
 * Diagnostics User Detail
 *
 * Read-only user detail view with event timeline.
 * Shows user entitlement info and reconstructed activity history.
 *
 * No auto-refresh. No actions.
 */

import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { getUserDiagnostics, getUserTimeline } from '../api/diagnostics';

function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleString();
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString();
}

function AuthBadge({ provider }: { provider: string }) {
  const colors: Record<string, string> = {
    apple: 'bg-gray-900 text-white',
    email: 'bg-blue-100 text-blue-800',
    unknown: 'bg-gray-100 text-gray-600',
  };

  return (
    <span className={`inline-flex items-center rounded px-2 py-1 text-sm font-medium ${colors[provider] || colors.unknown}`}>
      {provider === 'apple' ? 'Apple Sign In' : provider === 'email' ? 'Email/Password' : 'Unknown'}
    </span>
  );
}

function StatusRow({ label, value, type = 'text' }: { label: string; value: string | boolean | null | undefined; type?: 'text' | 'boolean' | 'date' }) {
  let displayValue: React.ReactNode = '—';

  if (value !== null && value !== undefined) {
    if (type === 'boolean') {
      displayValue = value ? (
        <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-sm font-medium text-green-800">Yes</span>
      ) : (
        <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-sm font-medium text-gray-600">No</span>
      );
    } else if (type === 'date' && typeof value === 'string') {
      displayValue = formatDateTime(value);
    } else {
      displayValue = String(value);
    }
  }

  return (
    <div className="py-3 sm:grid sm:grid-cols-3 sm:gap-4">
      <dt className="text-sm font-medium text-gray-500">{label}</dt>
      <dd className="mt-1 text-sm text-gray-900 sm:col-span-2 sm:mt-0">{displayValue}</dd>
    </div>
  );
}

function TimelineEventIcon({ eventType }: { eventType: string }) {
  const icons: Record<string, { bg: string; icon: string }> = {
    account_created: { bg: 'bg-green-500', icon: '👤' },
    tos_accepted: { bg: 'bg-blue-500', icon: '📋' },
    eligibility_confirmed: { bg: 'bg-indigo-500', icon: '✓' },
    state_certified: { bg: 'bg-purple-500', icon: '🏛' },
    payment_completed: { bg: 'bg-green-600', icon: '💰' },
    first_pick_submitted: { bg: 'bg-amber-500', icon: '🏈' },
    picks_submitted: { bg: 'bg-amber-400', icon: '📝' },
    player_swap: { bg: 'bg-orange-500', icon: '🔄' },
    last_score_update: { bg: 'bg-gray-500', icon: '📊' },
  };

  const config = icons[eventType] || { bg: 'bg-gray-400', icon: '•' };

  return (
    <span className={`flex h-8 w-8 items-center justify-center rounded-full ${config.bg} text-white text-sm`}>
      {config.icon}
    </span>
  );
}

export function DiagnosticsUserDetail() {
  const { userId } = useParams<{ userId: string }>();

  const {
    data: userData,
    isLoading: userLoading,
    error: userError,
    refetch: refetchUser,
    isFetching: userFetching,
  } = useQuery({
    queryKey: ['diagnostics', 'user', userId],
    queryFn: () => getUserDiagnostics(userId!),
    enabled: !!userId,
    staleTime: Infinity,
  });

  const {
    data: timelineData,
    isLoading: timelineLoading,
    refetch: refetchTimeline,
    isFetching: timelineFetching,
  } = useQuery({
    queryKey: ['diagnostics', 'timeline', userId],
    queryFn: () => getUserTimeline(userId!),
    enabled: !!userId,
    staleTime: Infinity,
  });

  const isAnyFetching = userFetching || timelineFetching;

  const handleRefresh = () => {
    refetchUser();
    refetchTimeline();
  };

  if (!userId) {
    return <div className="text-red-600">Invalid user ID</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <Link
              to="/diagnostics/users"
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              ← Users
            </Link>
          </div>
          <h1 className="mt-2 text-2xl font-semibold text-gray-900">User Detail</h1>
          <p className="mt-1 text-sm text-gray-500 font-mono">{userId}</p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={isAnyFetching}
          className="inline-flex items-center rounded-md bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 disabled:opacity-50"
        >
          {isAnyFetching ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {userLoading ? (
        <div className="animate-pulse space-y-4">
          <div className="h-48 bg-gray-200 rounded-lg"></div>
        </div>
      ) : userError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
          Failed to load user data. User may not exist.
        </div>
      ) : userData?.user ? (
        <>
          {/* User Info Panel */}
          <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-medium text-gray-900">User Information</h2>
                <AuthBadge provider={userData.user.auth_provider} />
              </div>
            </div>
            <div className="px-4 py-2">
              <dl className="divide-y divide-gray-200">
                <StatusRow label="Username" value={userData.user.username} />
                <StatusRow label="Email" value={userData.user.email} />
                <StatusRow label="State" value={userData.user.state} />
                <StatusRow label="Account Created" value={userData.user.account_created_at} type="date" />
                <StatusRow label="Last Activity" value={userData.user.last_activity_at} type="date" />
              </dl>
            </div>
          </div>

          {/* Entitlement Panel */}
          <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
              <h2 className="text-lg font-medium text-gray-900">Entitlements</h2>
            </div>
            <div className="px-4 py-2">
              <dl className="divide-y divide-gray-200">
                <StatusRow label="Paid" value={userData.user.paid} type="boolean" />
                <StatusRow label="Admin" value={userData.user.is_admin} type="boolean" />
                <StatusRow label="Age Verified" value={userData.user.age_verified} type="boolean" />
                <StatusRow label="TOS Version" value={userData.user.tos_version} />
                <StatusRow label="TOS Accepted" value={userData.user.tos_accepted_at} type="date" />
                <StatusRow label="Eligibility Confirmed" value={userData.user.eligibility_confirmed_at} type="date" />
                <StatusRow label="Payment Method" value={userData.user.payment_method} />
                <StatusRow label="Payment Date" value={userData.user.payment_date} type="date" />
              </dl>
            </div>
          </div>

          {/* Timeline Panel */}
          <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
              <h2 className="text-lg font-medium text-gray-900">Event Timeline</h2>
              <p className="text-sm text-gray-500">Reconstructed from existing data</p>
            </div>
            <div className="p-4">
              {timelineLoading ? (
                <div className="animate-pulse space-y-4">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="flex gap-3">
                      <div className="h-8 w-8 bg-gray-200 rounded-full"></div>
                      <div className="flex-1 h-8 bg-gray-200 rounded"></div>
                    </div>
                  ))}
                </div>
              ) : timelineData && timelineData.events.length > 0 ? (
                <div className="flow-root">
                  <ul className="-mb-8">
                    {timelineData.events.map((event, idx) => (
                      <li key={`${event.event_type}-${event.timestamp}-${idx}`}>
                        <div className="relative pb-8">
                          {idx !== timelineData.events.length - 1 && (
                            <span
                              className="absolute left-4 top-8 -ml-px h-full w-0.5 bg-gray-200"
                              aria-hidden="true"
                            />
                          )}
                          <div className="relative flex items-start space-x-3">
                            <TimelineEventIcon eventType={event.event_type} />
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-medium text-gray-900">
                                {event.description}
                              </div>
                              <p className="mt-0.5 text-xs text-gray-500">
                                {formatDateTime(event.timestamp)}
                              </p>
                              {event.metadata && Object.keys(event.metadata).length > 0 && (
                                <div className="mt-1 text-xs text-gray-400">
                                  {Object.entries(event.metadata).map(([key, val]) => (
                                    <span key={key} className="mr-2">
                                      {key}: {String(val)}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-sm text-gray-500">No timeline events found</p>
              )}
              {timelineData && (
                <p className="text-xs text-gray-400 mt-4 pt-4 border-t border-gray-100">
                  {timelineData.event_count} events • Data as of {formatDate(timelineData.timestamp)}
                </p>
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
