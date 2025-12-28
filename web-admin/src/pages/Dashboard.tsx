import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ConfirmationModal } from '../components/ConfirmationModal';
import {
  getCacheStatus,
  getUsers,
  setActiveWeek,
  processWeekTransition,
  cleanupNonAdminUsers,
  cleanupNonAdminPicks,
  getNonAdminUserCount,
} from '../api/admin';

export function Dashboard() {
  const queryClient = useQueryClient();
  const [selectedWeek, setSelectedWeek] = useState<number>(19);
  const [userCleanupModalOpen, setUserCleanupModalOpen] = useState(false);
  const [pickCleanupModalOpen, setPickCleanupModalOpen] = useState(false);
  const [weekTransitionModalOpen, setWeekTransitionModalOpen] = useState(false);
  const [nonAdminUserCount, setNonAdminUserCount] = useState<number>(-1);

  // Read-only queries with auto-refresh
  const { data: cacheStatus, isLoading: cacheLoading } = useQuery({
    queryKey: ['cacheStatus'],
    queryFn: getCacheStatus,
    refetchInterval: 30000, // Auto-refresh every 30 seconds
  });

  const { data: userStats, isLoading: usersLoading } = useQuery({
    queryKey: ['userStats'],
    queryFn: getUsers,
    refetchInterval: 30000,
  });

  // Fetch non-admin user count when cleanup modal opens
  useEffect(() => {
    if (userCleanupModalOpen) {
      getNonAdminUserCount().then(setNonAdminUserCount).catch(() => setNonAdminUserCount(-1));
    }
  }, [userCleanupModalOpen]);

  // Week management mutations
  const setWeekMutation = useMutation({
    mutationFn: (week: number) => setActiveWeek(week),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cacheStatus'] });
    },
  });

  const weekTransitionMutation = useMutation({
    mutationFn: processWeekTransition,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cacheStatus'] });
      setWeekTransitionModalOpen(false);
    },
  });

  // Cleanup mutations
  const userCleanupMutation = useMutation({
    mutationFn: cleanupNonAdminUsers,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['userStats'] });
      setUserCleanupModalOpen(false);
    },
  });

  const pickCleanupMutation = useMutation({
    mutationFn: cleanupNonAdminPicks,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['userStats'] });
      setPickCleanupModalOpen(false);
    },
  });

  const isLoading = cacheLoading || usersLoading;
  const cacheHealthy = cacheStatus?.lastScoreboardUpdate !== null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Admin Dashboard</h1>
        <p className="mt-1 text-sm text-gray-600">
          Manage contest state and perform administrative actions
        </p>
      </div>

      {/* Panel 1: Game State (Read-Only) */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
          <h2 className="text-lg font-medium text-gray-900">Game State</h2>
          <p className="text-sm text-gray-500">Read-only system status</p>
        </div>
        <div className="p-4">
          {isLoading ? (
            <div className="animate-pulse space-y-2">
              <div className="h-4 bg-gray-200 rounded w-1/4"></div>
              <div className="h-4 bg-gray-200 rounded w-1/3"></div>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-gray-50 rounded-md p-3">
                <dt className="text-sm font-medium text-gray-500">Users</dt>
                <dd className="mt-1 text-2xl font-semibold text-gray-900">
                  {userStats?.count ?? '—'}
                </dd>
              </div>
              <div className="bg-gray-50 rounded-md p-3">
                <dt className="text-sm font-medium text-gray-500">Cached Players</dt>
                <dd className="mt-1 text-2xl font-semibold text-gray-900">
                  {cacheStatus?.cachedPlayerCount ?? '—'}
                </dd>
              </div>
              <div className="bg-gray-50 rounded-md p-3">
                <dt className="text-sm font-medium text-gray-500">Active Games</dt>
                <dd className="mt-1 text-2xl font-semibold text-gray-900">
                  {cacheStatus?.activeGames?.length ?? '—'}
                </dd>
              </div>
              <div className="bg-gray-50 rounded-md p-3">
                <dt className="text-sm font-medium text-gray-500">Cache Status</dt>
                <dd className="mt-1">
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-sm font-medium ${
                      cacheHealthy
                        ? 'bg-green-100 text-green-800'
                        : 'bg-yellow-100 text-yellow-800'
                    }`}
                  >
                    {cacheHealthy ? 'Healthy' : 'Stale'}
                  </span>
                </dd>
              </div>
            </div>
          )}
          <div className="mt-4 text-right">
            <button
              onClick={() => {
                queryClient.invalidateQueries({ queryKey: ['cacheStatus'] });
                queryClient.invalidateQueries({ queryKey: ['userStats'] });
              }}
              className="text-sm text-indigo-600 hover:text-indigo-500"
            >
              Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Panel 2: Week Management */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
          <h2 className="text-lg font-medium text-gray-900">Week Management</h2>
          <p className="text-sm text-gray-500">Control contest week state</p>
        </div>
        <div className="p-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <label htmlFor="weekSelect" className="text-sm font-medium text-gray-700">
                Set Active Week:
              </label>
              <select
                id="weekSelect"
                value={selectedWeek}
                onChange={(e) => setSelectedWeek(Number(e.target.value))}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                {[19, 20, 21, 22].map((week) => (
                  <option key={week} value={week}>
                    Week {week} (Playoff Week {week - 18})
                  </option>
                ))}
              </select>
              <button
                onClick={() => setWeekMutation.mutate(selectedWeek)}
                disabled={setWeekMutation.isPending}
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50"
              >
                {setWeekMutation.isPending ? 'Setting...' : 'Set Week'}
              </button>
            </div>

            <div className="h-8 w-px bg-gray-200" />

            <button
              onClick={() => setWeekTransitionModalOpen(true)}
              className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2"
            >
              Process Week Transition
            </button>
          </div>

          <div className="mt-4 rounded-md bg-amber-50 border border-amber-200 p-3">
            <p className="text-sm text-amber-800">
              <strong>Warning:</strong> These actions affect all users in the contest.
            </p>
          </div>
        </div>
      </div>

      {/* Panel 3: Destructive Actions */}
      <div className="rounded-lg border-2 border-red-200 bg-white shadow-sm">
        <div className="border-b border-red-200 bg-red-50 px-4 py-3">
          <div className="flex items-center gap-2">
            <svg
              className="h-5 w-5 text-red-600"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth="1.5"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
              />
            </svg>
            <h2 className="text-lg font-medium text-red-900">Destructive Actions</h2>
          </div>
          <p className="mt-1 text-sm text-red-700">
            All actions below permanently delete data. Admin users and admin picks are always preserved.
          </p>
        </div>
        <div className="p-4">
          <div className="flex flex-wrap gap-4">
            <button
              onClick={() => setUserCleanupModalOpen(true)}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
            >
              Clear Non-Admin Users
            </button>
            <button
              onClick={() => setPickCleanupModalOpen(true)}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
            >
              Clear Non-Admin Picks
            </button>
          </div>
        </div>
      </div>

      {/* Confirmation Modals */}
      <ConfirmationModal
        isOpen={userCleanupModalOpen}
        onClose={() => setUserCleanupModalOpen(false)}
        onConfirm={() => userCleanupMutation.mutate()}
        title="Delete All Non-Admin Users"
        description="This action will permanently delete all users who are not administrators. This cannot be undone."
        confirmText="Delete Users"
        confirmationPhrase="DELETE USERS"
        itemCount={nonAdminUserCount}
        preserveMessage="Admin users will NOT be deleted"
        isLoading={userCleanupMutation.isPending}
      />

      <ConfirmationModal
        isOpen={pickCleanupModalOpen}
        onClose={() => setPickCleanupModalOpen(false)}
        onConfirm={() => pickCleanupMutation.mutate()}
        title="Delete All Non-Admin Picks"
        description="This action will permanently delete all picks belonging to non-admin users. This cannot be undone."
        confirmText="Delete Picks"
        confirmationPhrase="DELETE PICKS"
        preserveMessage="Admin picks will NOT be deleted"
        isLoading={pickCleanupMutation.isPending}
      />

      <ConfirmationModal
        isOpen={weekTransitionModalOpen}
        onClose={() => setWeekTransitionModalOpen(false)}
        onConfirm={() => weekTransitionMutation.mutate()}
        title="Process Week Transition"
        description="This will advance all users to the next playoff week. Ensure all scores are finalized before proceeding."
        confirmText="Process Transition"
        confirmationPhrase="ADVANCE WEEK"
        isLoading={weekTransitionMutation.isPending}
      />
    </div>
  );
}
