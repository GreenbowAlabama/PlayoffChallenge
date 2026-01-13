import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ConfirmationModal } from '../components/ConfirmationModal';
import {
  getCacheStatus,
  getUsers,
  processWeekTransition,
  getGameConfig,
  getAdminUserId,
  updateWeekStatus,
  getPickCountForWeek,
  getWeekVerificationStatus,
  getPlayerPickTrends,
  getTeamPickTrends,
  getConferencePickTrends,
  type WeekTransitionParams,
  type WeekTransitionResponse,
  type VerificationStatus,
  type TrendWeekRange,
} from '../api/admin';

// Production safety: Disable week management controls to prevent accidental
// clicks on production-impacting controls. Informational panels remain visible.
// This only affects the Dashboard page; other admin pages (Users, Picks, etc.) are unchanged.
const IS_PROD_DASHBOARD_READONLY = import.meta.env.PROD;

export function Dashboard() {
  const queryClient = useQueryClient();
  const [weekTransitionModalOpen, setWeekTransitionModalOpen] = useState(false);

  // Week transition state
  const [transitionResult, setTransitionResult] = useState<WeekTransitionResponse | null>(null);
  const [transitionTimestamp, setTransitionTimestamp] = useState<string | null>(null);
  const [transitionAdminId, setTransitionAdminId] = useState<string | null>(null);
  const [verificationStatus, setVerificationStatus] = useState<VerificationStatus | null>(null);
  const [activeTeamsExpanded, setActiveTeamsExpanded] = useState(false);

  // Lock/Unlock modal state
  const [lockModalOpen, setLockModalOpen] = useState(false);
  const [unlockModalOpen, setUnlockModalOpen] = useState(false);

  // Read-only trend analytics state
  const [trendWeekRange, setTrendWeekRange] = useState<TrendWeekRange>('current');
  const [playerTrendLimit, setPlayerTrendLimit] = useState<10 | 25 | 'all'>(10);

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
  const isWeekLocked = gameConfig ? !gameConfig.is_week_active : false;

  // Pre-flight: fetch pick count for next week
  const { data: nextWeekPickCount } = useQuery({
    queryKey: ['pickCountNextWeek', nextNflWeek],
    queryFn: () => (nextNflWeek ? getPickCountForWeek(nextNflWeek) : Promise.resolve(-1)),
    enabled: !!nextNflWeek,
    refetchInterval: 30000,
  });

  // Read-only trend analytics queries (informational only)
  // Minimum 60s refetch interval per safety guardrails
  const { data: playerTrends, isLoading: playerTrendsLoading } = useQuery({
    queryKey: ['playerPickTrends', trendWeekRange],
    queryFn: () => getPlayerPickTrends(trendWeekRange),
    refetchInterval: 60000,
  });

  const { data: teamTrends, isLoading: teamTrendsLoading } = useQuery({
    queryKey: ['teamPickTrends', trendWeekRange],
    queryFn: () => getTeamPickTrends(trendWeekRange),
    refetchInterval: 60000,
  });

  const { data: conferenceTrends, isLoading: conferenceTrendsLoading } = useQuery({
    queryKey: ['conferencePickTrends', trendWeekRange],
    queryFn: () => getConferencePickTrends(trendWeekRange),
    refetchInterval: 60000,
  });

  // Week management mutations
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
    if (!isWeekLocked) return 'Week must be locked before advancing (is_week_active = true)';
    if (nextWeekPickCount !== undefined && nextWeekPickCount > 0) {
      return `${nextWeekPickCount} picks already exist for Week ${nextNflWeek}`;
    }
    return null;
  };

  const transitionDisableReason = getTransitionDisableReason();
  const isTransitionDisabled = transitionDisableReason !== null;

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
                Week management controls are disabled on this page to prevent accidental changes.
                Use a non-production environment to access week management controls.
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

      {/* Panel 3: Read-only Analytics */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-medium text-gray-900">Pick Trends</h2>
              <p className="text-sm text-gray-500">Informational only - does not influence admin actions</p>
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="trendScope" className="text-sm text-gray-600">Scope:</label>
              <select
                id="trendScope"
                value={trendWeekRange}
                onChange={(e) => setTrendWeekRange(e.target.value as TrendWeekRange)}
                className="rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="current">Current Week</option>
                <option value="all">Entire Contest</option>
              </select>
            </div>
          </div>
        </div>
        <div className="p-4 space-y-6">
          {/* Disclaimer banner */}
          <div className="rounded-md bg-blue-50 border border-blue-200 p-3">
            <p className="text-xs text-blue-700">
              <strong>Informational only:</strong> These analytics are for observation purposes.
              They do not enable, disable, or influence any admin controls.
            </p>
          </div>

          {/* AFC vs NFC Distribution */}
          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-2">Conference Distribution</h3>
            {conferenceTrendsLoading ? (
              <div className="animate-pulse h-8 bg-gray-200 rounded"></div>
            ) : !conferenceTrends || conferenceTrends.length === 0 ? (
              <div className="text-sm text-gray-500 italic">No conference data available</div>
            ) : (
              (() => {
                const afcData = conferenceTrends.find(c => c.conference === 'AFC');
                const nfcData = conferenceTrends.find(c => c.conference === 'NFC');
                const afcCount = afcData?.pickCount ?? 0;
                const nfcCount = nfcData?.pickCount ?? 0;
                const total = afcCount + nfcCount;
                const afcPct = total > 0 ? Math.round((afcCount / total) * 100) : 0;
                const nfcPct = total > 0 ? 100 - afcPct : 0;

                return (
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs text-gray-600 mb-1">
                      <span>AFC: {afcCount} picks ({afcPct}%)</span>
                      <span>NFC: {nfcCount} picks ({nfcPct}%)</span>
                    </div>
                    <div className="h-4 rounded-full overflow-hidden flex bg-gray-200">
                      {total > 0 ? (
                        <>
                          <div
                            className="bg-blue-500 h-full transition-all"
                            style={{ width: `${afcPct}%` }}
                            title={`AFC: ${afcPct}%`}
                          />
                          <div
                            className="bg-red-500 h-full transition-all"
                            style={{ width: `${nfcPct}%` }}
                            title={`NFC: ${nfcPct}%`}
                          />
                        </>
                      ) : null}
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="flex items-center gap-1">
                        <span className="w-3 h-3 bg-blue-500 rounded"></span>
                        AFC
                      </span>
                      <span className="text-gray-500">Total: {total} picks</span>
                      <span className="flex items-center gap-1">
                        NFC
                        <span className="w-3 h-3 bg-red-500 rounded"></span>
                      </span>
                    </div>
                  </div>
                );
              })()
            )}
          </div>

          {/* Team Pick Trends */}
          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-2">Team Pick Trends</h3>
            {teamTrendsLoading ? (
              <div className="animate-pulse space-y-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-6 bg-gray-200 rounded"></div>
                ))}
              </div>
            ) : !teamTrends || teamTrends.length === 0 ? (
              <div className="text-sm text-gray-500 italic">No team pick data available</div>
            ) : (
              <div className="space-y-1">
                {teamTrends
                  .slice()
                  .sort((a, b) => b.pickCount - a.pickCount)
                  .map((team) => {
                    const maxPicks = Math.max(...teamTrends.map(t => t.pickCount));
                    const widthPct = maxPicks > 0 ? (team.pickCount / maxPicks) * 100 : 0;
                    return (
                      <div key={team.teamAbbr} className="flex items-center gap-2">
                        <span className="w-10 text-xs font-medium text-gray-700">{team.teamAbbr}</span>
                        <div className="flex-1 h-5 bg-gray-100 rounded overflow-hidden">
                          <div
                            className="h-full bg-indigo-400 transition-all"
                            style={{ width: `${widthPct}%` }}
                          />
                        </div>
                        <span className="w-8 text-xs text-gray-600 text-right">{team.pickCount}</span>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>

          {/* Player Pick Trends */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-gray-700">Player Pick Trends</h3>
              <div className="flex gap-1">
                {([10, 25, 'all'] as const).map((limit) => (
                  <button
                    key={limit}
                    onClick={() => setPlayerTrendLimit(limit)}
                    className={`px-2 py-0.5 text-xs rounded ${
                      playerTrendLimit === limit
                        ? 'bg-indigo-600 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {limit === 'all' ? 'All' : `Top ${limit}`}
                  </button>
                ))}
              </div>
            </div>
            {playerTrendsLoading ? (
              <div className="animate-pulse space-y-2">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="h-8 bg-gray-200 rounded"></div>
                ))}
              </div>
            ) : !playerTrends || playerTrends.length === 0 ? (
              <div className="text-sm text-gray-500 italic">No player pick data available</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-2 pr-4 font-medium text-gray-600">Player</th>
                      <th className="text-left py-2 px-2 font-medium text-gray-600">Pos</th>
                      <th className="text-left py-2 px-2 font-medium text-gray-600">Team</th>
                      <th className="text-right py-2 pl-2 font-medium text-gray-600">Picks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {playerTrends
                      .slice()
                      .sort((a, b) => b.pickCount - a.pickCount)
                      .slice(0, playerTrendLimit === 'all' ? undefined : playerTrendLimit)
                      .map((player) => (
                        <tr key={player.playerId} className="border-b border-gray-100">
                          <td className="py-1.5 pr-4 text-gray-900">{player.playerName}</td>
                          <td className="py-1.5 px-2 text-gray-600">{player.position}</td>
                          <td className="py-1.5 px-2 text-gray-600">{player.team}</td>
                          <td className="py-1.5 pl-2 text-right font-medium text-indigo-600">{player.pickCount}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Confirmation Modals */}
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
