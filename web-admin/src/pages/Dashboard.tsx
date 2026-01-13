import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
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
  getGameConfig,
  getAdminUserId,
  updateWeekStatus,
  getPickCountForWeek,
  getWeekVerificationStatus,
  type WeekTransitionParams,
  type WeekTransitionResponse,
  type VerificationStatus,
} from '../api/admin';

// Production safety: Disable destructive dashboard actions to prevent accidental
// clicks on production-impacting controls. Informational panels remain visible.
// This only affects the Dashboard page; other admin pages (Users, Picks, etc.) are unchanged.
const IS_PROD_DASHBOARD_READONLY = import.meta.env.PROD;

export function Dashboard() {
  const queryClient = useQueryClient();
  const [startingWeekInput, setStartingWeekInput] = useState<string>('');
  const [userCleanupModalOpen, setUserCleanupModalOpen] = useState(false);
  const [pickCleanupModalOpen, setPickCleanupModalOpen] = useState(false);
  const [weekTransitionModalOpen, setWeekTransitionModalOpen] = useState(false);
  const [setWeekModalOpen, setSetWeekModalOpen] = useState(false);
  const [nonAdminUserCount, setNonAdminUserCount] = useState<number>(-1);

  // Week transition state
  const [transitionResult, setTransitionResult] = useState<WeekTransitionResponse | null>(null);
  const [transitionTimestamp, setTransitionTimestamp] = useState<string | null>(null);
  const [transitionAdminId, setTransitionAdminId] = useState<string | null>(null);
  const [verificationStatus, setVerificationStatus] = useState<VerificationStatus | null>(null);
  const [activeTeamsExpanded, setActiveTeamsExpanded] = useState(false);

  // Lock/Unlock modal state
  const [lockModalOpen, setLockModalOpen] = useState(false);
  const [unlockModalOpen, setUnlockModalOpen] = useState(false);

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

  // Fetch game config for week transition
  const { data: gameConfig } = useQuery({
    queryKey: ['gameConfig'],
    queryFn: getGameConfig,
    refetchInterval: 30000,
  });

  // Calculate current NFL week from game settings
  const currentNflWeek = gameConfig
    ? gameConfig.playoff_start_week + gameConfig.current_playoff_week - 1
    : null;
  const nextNflWeek = currentNflWeek ? currentNflWeek + 1 : null;
  const currentPlayoffWeek = gameConfig?.current_playoff_week ?? null;
  const isWeekLocked = gameConfig?.is_week_active ?? false;

  // Pre-flight: fetch pick count for next week
  const { data: nextWeekPickCount } = useQuery({
    queryKey: ['pickCountNextWeek', nextNflWeek],
    queryFn: () => (nextNflWeek ? getPickCountForWeek(nextNflWeek) : Promise.resolve(-1)),
    enabled: !!nextNflWeek,
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
      setSetWeekModalOpen(false);
      setStartingWeekInput('');
    },
  });

  const weekTransitionMutation = useMutation({
    mutationFn: (params: WeekTransitionParams) => processWeekTransition(params),
    onSuccess: async (result) => {
      queryClient.invalidateQueries({ queryKey: ['cacheStatus'] });
      queryClient.invalidateQueries({ queryKey: ['gameConfig'] });
      queryClient.invalidateQueries({ queryKey: ['pickCountNextWeek'] });
      setWeekTransitionModalOpen(false);

      // Capture transition result for display
      setTransitionResult(result);
      setTransitionTimestamp(new Date().toISOString());
      setTransitionAdminId(getAdminUserId());

      // Run post-transition verification
      if (nextNflWeek) {
        const verification = await getWeekVerificationStatus(nextNflWeek);
        setVerificationStatus(verification);
      }
    },
  });

  // Lock/Unlock week mutations
  const lockWeekMutation = useMutation({
    mutationFn: () => updateWeekStatus(true),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gameConfig'] });
      setLockModalOpen(false);
    },
  });

  const unlockWeekMutation = useMutation({
    mutationFn: () => updateWeekStatus(false),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gameConfig'] });
      setUnlockModalOpen(false);
    },
  });

  // Button disable logic with reasons
  const getTransitionDisableReason = (): string | null => {
    if (IS_PROD_DASHBOARD_READONLY) return 'Disabled in production mode';
    if (!currentNflWeek || !nextNflWeek) return 'Week configuration not loaded';
    if (isWeekLocked) return 'Week is currently locked (is_week_active = true)';
    if (nextWeekPickCount !== undefined && nextWeekPickCount > 0) {
      return `${nextWeekPickCount} picks already exist for Week ${nextNflWeek}`;
    }
    return null;
  };

  const transitionDisableReason = getTransitionDisableReason();
  const isTransitionDisabled = transitionDisableReason !== null;

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

      {/* Production read-only banner - Dashboard specific */}
      {IS_PROD_DASHBOARD_READONLY && (
        <div className="rounded-md bg-blue-50 border border-blue-200 p-4">
          <div className="flex">
            <svg className="h-5 w-5 text-blue-400" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-blue-800">Production Mode - Read Only</h3>
              <p className="mt-1 text-sm text-blue-700">
                Destructive actions are disabled on this page to prevent accidental changes.
                Use a non-production environment to access week management and cleanup controls.
              </p>
            </div>
          </div>
        </div>
      )}

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
              <Link to="/users" className="bg-gray-50 rounded-md p-3 block hover:bg-gray-100 transition-colors">
                <dt className="text-sm font-medium text-gray-500">Users</dt>
                <dd className="mt-1 text-2xl font-semibold text-indigo-600">
                  {userStats?.count ?? '—'}
                </dd>
                <span className="text-xs text-indigo-500">View all →</span>
              </Link>
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
      <div className={`rounded-lg border bg-white shadow-sm ${IS_PROD_DASHBOARD_READONLY ? 'border-gray-100 opacity-60' : 'border-gray-200'}`}>
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
          <h2 className="text-lg font-medium text-gray-900">Week Management</h2>
          <p className="text-sm text-gray-500">
            {IS_PROD_DASHBOARD_READONLY ? 'Disabled in production' : 'Control contest week state'}
          </p>
        </div>
        <div className="p-4 space-y-4">
          {/* Set Starting NFL Week */}
          <div className="flex flex-wrap items-center gap-3">
            <label htmlFor="startingWeek" className="text-sm font-medium text-gray-700">
              Set Starting NFL Week:
            </label>
            <input
              id="startingWeek"
              type="number"
              min="1"
              max="22"
              value={startingWeekInput}
              onChange={(e) => setStartingWeekInput(e.target.value)}
              placeholder="e.g. 19"
              disabled={IS_PROD_DASHBOARD_READONLY}
              className="w-24 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
            />
            <button
              onClick={() => setSetWeekModalOpen(true)}
              disabled={IS_PROD_DASHBOARD_READONLY || !startingWeekInput || isNaN(Number(startingWeekInput))}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Set Week
            </button>
          </div>

          <div className="h-px bg-gray-200" />

          {/* Lock/Unlock Week Controls */}
          <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm font-medium text-gray-700">Week Lock State: </span>
                <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  isWeekLocked ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'
                }`}>
                  {isWeekLocked ? 'LOCKED' : 'UNLOCKED'}
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setLockModalOpen(true)}
                  disabled={IS_PROD_DASHBOARD_READONLY || isWeekLocked}
                  className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Lock Week
                </button>
                <button
                  onClick={() => setUnlockModalOpen(true)}
                  disabled={IS_PROD_DASHBOARD_READONLY || !isWeekLocked}
                  className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Unlock Week
                </button>
              </div>
            </div>
            <p className="mt-2 text-xs text-gray-500">
              {isWeekLocked
                ? 'Week is locked. Users cannot modify picks. Unlock before advancing.'
                : 'Week is unlocked. Users can modify picks.'}
            </p>
          </div>

          <div className="h-px bg-gray-200" />

          {/* Pre-flight Status Panel */}
          <div className="rounded-md border border-blue-200 bg-blue-50 p-3">
            <h3 className="text-sm font-medium text-blue-900 mb-2">Pre-flight Status</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div>
                <span className="text-blue-700">Current NFL Week:</span>
                <span className="ml-1 font-medium text-blue-900">{currentNflWeek ?? '—'}</span>
              </div>
              <div>
                <span className="text-blue-700">Playoff Week:</span>
                <span className="ml-1 font-medium text-blue-900">{currentPlayoffWeek ?? '—'}</span>
              </div>
              <div>
                <span className="text-blue-700">Lock State:</span>
                <span className={`ml-1 font-medium ${isWeekLocked ? 'text-red-700' : 'text-green-700'}`}>
                  {isWeekLocked ? 'Locked' : 'Unlocked'}
                </span>
              </div>
              <div>
                <span className="text-blue-700">Picks for Week {nextNflWeek ?? '?'}:</span>
                <span className={`ml-1 font-medium ${
                  nextWeekPickCount === undefined || nextWeekPickCount === -1
                    ? 'text-gray-500'
                    : nextWeekPickCount > 0
                    ? 'text-red-700'
                    : 'text-green-700'
                }`}>
                  {nextWeekPickCount === undefined || nextWeekPickCount === -1 ? '—' : nextWeekPickCount}
                </span>
              </div>
            </div>
          </div>

          {/* Advance to Next Week */}
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setWeekTransitionModalOpen(true)}
                disabled={isTransitionDisabled}
                className="rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Advance to Next Week
              </button>
              <span className="text-sm text-gray-500">
                {currentNflWeek && nextNflWeek
                  ? `NFL Week ${currentNflWeek} → Week ${nextNflWeek}`
                  : 'Progress the contest to the next NFL week'}
              </span>
            </div>
            {/* Inline disable reason */}
            {transitionDisableReason && (
              <div className="flex items-center gap-2 text-sm text-red-600">
                <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                <span>{transitionDisableReason}</span>
              </div>
            )}
          </div>

          <div className="rounded-md bg-amber-50 border border-amber-200 p-3">
            <p className="text-sm text-amber-800">
              <strong>Warning:</strong> These actions affect all users in the contest.
            </p>
          </div>

          {/* Transition Results Panel */}
          {transitionResult && (
            <div className="rounded-md border border-green-200 bg-green-50 p-4">
              <h3 className="text-sm font-medium text-green-900 mb-3 flex items-center gap-2">
                <svg className="h-5 w-5 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                Transition Complete
              </h3>
              <div className="grid grid-cols-2 gap-3 text-sm mb-3">
                <div>
                  <span className="text-green-700">Advanced:</span>
                  <span className="ml-1 font-medium text-green-900">{transitionResult.advancedCount ?? '—'}</span>
                </div>
                <div>
                  <span className="text-green-700">Eliminated:</span>
                  <span className="ml-1 font-medium text-green-900">{transitionResult.eliminatedCount ?? '—'}</span>
                </div>
                <div>
                  <span className="text-green-700">Timestamp:</span>
                  <span className="ml-1 font-medium text-green-900">
                    {transitionTimestamp ? new Date(transitionTimestamp).toLocaleString() : '—'}
                  </span>
                </div>
                <div>
                  <span className="text-green-700">Admin:</span>
                  <span className="ml-1 font-medium text-green-900 text-xs font-mono">
                    {transitionAdminId ? `${transitionAdminId.slice(0, 8)}...` : '—'}
                  </span>
                </div>
              </div>
              {/* Collapsible Active Teams */}
              {transitionResult.activeTeams && transitionResult.activeTeams.length > 0 && (
                <div>
                  <button
                    onClick={() => setActiveTeamsExpanded(!activeTeamsExpanded)}
                    className="flex items-center gap-1 text-sm text-green-700 hover:text-green-800"
                  >
                    <svg
                      className={`h-4 w-4 transform transition-transform ${activeTeamsExpanded ? 'rotate-90' : ''}`}
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                    </svg>
                    Active Teams ({transitionResult.activeTeams.length})
                  </button>
                  {activeTeamsExpanded && (
                    <ul className="mt-2 pl-5 text-xs text-green-800 max-h-32 overflow-y-auto">
                      {transitionResult.activeTeams.map((team) => (
                        <li key={team.userId} className="py-0.5">
                          {team.username || team.userId.slice(0, 8)}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              <button
                onClick={() => {
                  setTransitionResult(null);
                  setVerificationStatus(null);
                }}
                className="mt-3 text-xs text-green-600 hover:text-green-700"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Post-Transition Verification Panel */}
          {verificationStatus && (
            <div className={`rounded-md border p-4 ${
              verificationStatus.anomalies.length > 0
                ? 'border-yellow-200 bg-yellow-50'
                : 'border-gray-200 bg-gray-50'
            }`}>
              <h3 className="text-sm font-medium text-gray-900 mb-3">Post-Transition Verification</h3>
              <div className="grid grid-cols-3 gap-3 text-sm mb-2">
                <div>
                  <span className="text-gray-600">Pick Count:</span>
                  <span className="ml-1 font-medium">{verificationStatus.pickCount === -1 ? '—' : verificationStatus.pickCount}</span>
                </div>
                <div>
                  <span className="text-gray-600">Score Count:</span>
                  <span className={`ml-1 font-medium ${verificationStatus.scoreCount > 0 ? 'text-yellow-700' : ''}`}>
                    {verificationStatus.scoreCount === -1 ? '—' : verificationStatus.scoreCount}
                  </span>
                  {verificationStatus.scoreCount === 0 && <span className="text-green-600 text-xs ml-1">(expected)</span>}
                </div>
                <div>
                  <span className="text-gray-600">Multipliers:</span>
                  <span className="ml-1 font-medium text-xs">
                    {Object.keys(verificationStatus.multiplierDistribution).length === 0
                      ? '—'
                      : Object.entries(verificationStatus.multiplierDistribution)
                          .map(([k, v]) => `${k}:${v}`)
                          .join(', ')}
                  </span>
                </div>
              </div>
              {/* Anomalies only shown if present */}
              {verificationStatus.anomalies.length > 0 && (
                <div className="mt-2 p-2 bg-yellow-100 rounded text-xs text-yellow-800">
                  <strong>Anomalies:</strong>
                  <ul className="mt-1 list-disc list-inside">
                    {verificationStatus.anomalies.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Panel 3: Destructive Actions */}
      <div className={`rounded-lg border-2 bg-white shadow-sm ${IS_PROD_DASHBOARD_READONLY ? 'border-gray-200 opacity-60' : 'border-red-200'}`}>
        <div className={`border-b px-4 py-3 ${IS_PROD_DASHBOARD_READONLY ? 'border-gray-200 bg-gray-50' : 'border-red-200 bg-red-50'}`}>
          <div className="flex items-center gap-2">
            <svg
              className={`h-5 w-5 ${IS_PROD_DASHBOARD_READONLY ? 'text-gray-400' : 'text-red-600'}`}
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
            <h2 className={`text-lg font-medium ${IS_PROD_DASHBOARD_READONLY ? 'text-gray-700' : 'text-red-900'}`}>Destructive Actions</h2>
          </div>
          <p className={`mt-1 text-sm ${IS_PROD_DASHBOARD_READONLY ? 'text-gray-500' : 'text-red-700'}`}>
            {IS_PROD_DASHBOARD_READONLY
              ? 'Disabled in production to prevent accidental data loss.'
              : 'All actions below permanently delete data. Admin users and admin picks are always preserved.'}
          </p>
        </div>
        <div className="p-4">
          <div className="flex flex-wrap gap-4">
            <button
              onClick={() => setUserCleanupModalOpen(true)}
              disabled={IS_PROD_DASHBOARD_READONLY}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Clear Non-Admin Users
            </button>
            <button
              onClick={() => setPickCleanupModalOpen(true)}
              disabled={IS_PROD_DASHBOARD_READONLY}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
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
        onConfirm={() => {
          const adminUserId = getAdminUserId();
          if (!adminUserId || !currentNflWeek || !nextNflWeek) {
            console.error('Missing required data for week transition');
            return;
          }
          weekTransitionMutation.mutate({
            userId: adminUserId,
            fromWeek: currentNflWeek,
            toWeek: nextNflWeek,
          });
        }}
        title="Advance to Next Week"
        description={currentNflWeek && nextNflWeek
          ? `This will advance the contest from NFL Week ${currentNflWeek} to Week ${nextNflWeek}. Ensure all scores are finalized before proceeding. This action affects all users.`
          : "This will advance the contest to the next NFL week. Ensure all scores are finalized before proceeding. This action affects all users."}
        confirmText="Advance Week"
        confirmationPhrase="ADVANCE WEEK"
        isLoading={weekTransitionMutation.isPending}
      />

      <ConfirmationModal
        isOpen={setWeekModalOpen}
        onClose={() => setSetWeekModalOpen(false)}
        onConfirm={() => setWeekMutation.mutate(Number(startingWeekInput))}
        title="Set Starting NFL Week"
        description={`This will set the active NFL week to Week ${startingWeekInput}. The API will fetch stats for this week. This action affects all users.`}
        confirmText="Set Week"
        confirmationPhrase="SET WEEK"
        isLoading={setWeekMutation.isPending}
      />

      <ConfirmationModal
        isOpen={lockModalOpen}
        onClose={() => setLockModalOpen(false)}
        onConfirm={() => lockWeekMutation.mutate()}
        title="Lock Week"
        description="This will lock the current week. Users will NOT be able to modify their picks while locked. Lock the week before games start."
        confirmText="Lock Week"
        confirmationPhrase="LOCK WEEK"
        isLoading={lockWeekMutation.isPending}
      />

      <ConfirmationModal
        isOpen={unlockModalOpen}
        onClose={() => setUnlockModalOpen(false)}
        onConfirm={() => unlockWeekMutation.mutate()}
        title="Unlock Week"
        description="This will unlock the current week. Users WILL be able to modify their picks. Only unlock if you need to allow pick changes before advancing."
        confirmText="Unlock Week"
        confirmationPhrase="UNLOCK WEEK"
        isLoading={unlockWeekMutation.isPending}
      />
    </div>
  );
}
