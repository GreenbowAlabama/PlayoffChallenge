import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ConfirmationModal } from '../components/ConfirmationModal';
import { SystemHealthPanel } from '../components/SystemHealthPanel';
// Planned Admin Panels (read-only, coming next)
// import { ComplianceOverviewPanel } from '../components/ComplianceOverviewPanel';
// import { WeekVerificationPanel } from '../components/WeekVerificationPanel';
import {
  previewWeekTransition,
  processWeekTransition,
  getGameConfig,
  getAdminUserId,
  updateWeekStatus,
  getPickCountForWeek,
  getWeekVerificationStatus,
  verifyLockStatus,
  type WeekTransitionParams,
  type WeekTransitionResponse,
  type WeekTransitionPreview,
  type VerificationStatus,
  type LockVerificationResponse,
} from '../api/admin';

// Admin Edit Mode: confirmation phrase must be typed exactly to enable edit mode.
const ADMIN_EDIT_MODE_PHRASE = 'ENABLE ADMIN EDIT MODE';

export function Admin() {
  const queryClient = useQueryClient();
  const [weekTransitionModalOpen, setWeekTransitionModalOpen] = useState(false);

  // Admin Edit Mode state: intentionally in-memory only.
  // This state resets on page refresh by design - no persistence to localStorage,
  // sessionStorage, cookies, or URL params.
  const [editModeEnabled, setEditModeEnabled] = useState(false);
  const [editModeInput, setEditModeInput] = useState('');

  // Week transition state
  const [transitionResult, setTransitionResult] = useState<WeekTransitionResponse | null>(null);
  const [transitionTimestamp, setTransitionTimestamp] = useState<string | null>(null);
  const [transitionAdminId, setTransitionAdminId] = useState<string | null>(null);
  const [verificationStatus, setVerificationStatus] = useState<VerificationStatus | null>(null);
  const [activeTeamsExpanded, setActiveTeamsExpanded] = useState(false);

  // Preview state for week transition (two-step confirmation)
  const [previewData, setPreviewData] = useState<WeekTransitionPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewTeamsConfirmed, setPreviewTeamsConfirmed] = useState(false);

  // Lock/Unlock modal state
  const [lockModalOpen, setLockModalOpen] = useState(false);
  const [unlockModalOpen, setUnlockModalOpen] = useState(false);

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

  // Lock verification state (manual verification only)
  const [lockVerification, setLockVerification] = useState<LockVerificationResponse | null>(null);
  const [lockVerificationLoading, setLockVerificationLoading] = useState(false);

  const handleVerifyLock = async () => {
    setLockVerificationLoading(true);
    try {
      const result = await verifyLockStatus();
      setLockVerification(result);
    } catch (err) {
      console.error('Error verifying lock status:', err);
    } finally {
      setLockVerificationLoading(false);
    }
  };

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
  // is_week_active = false means LOCKED (users cannot modify picks)
  // is_week_active = true means UNLOCKED (users can modify picks)
  const lockWeekMutation = useMutation({
    mutationFn: () => updateWeekStatus(false),  // Lock = is_week_active: false
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gameConfig'] });
      setLockModalOpen(false);
    },
  });

  const unlockWeekMutation = useMutation({
    mutationFn: () => updateWeekStatus(true),  // Unlock = is_week_active: true
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gameConfig'] });
      setUnlockModalOpen(false);
    },
  });

  // Button disable logic with reasons
  const getTransitionDisableReason = (): string | null => {
    if (!currentNflWeek || !nextNflWeek) return 'Week configuration not loaded';
    if (!isWeekLocked) return 'Week must be locked before advancing (is_week_active = true)';
    if (nextWeekPickCount !== undefined && nextWeekPickCount > 0) {
      return `${nextWeekPickCount} picks already exist for Week ${nextNflWeek}`;
    }
    return null;
  };

  const transitionDisableReason = getTransitionDisableReason();
  const isTransitionDisabled = transitionDisableReason !== null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Admin Controls</h1>
        <p className="mt-1 text-sm text-gray-600">
          Privileged actions that modify contest state
        </p>
      </div>

      {/* Warning Banner */}
      <div className="rounded-md bg-red-50 border border-red-200 p-4">
        <div className="flex">
          <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          <div className="ml-3">
            <h3 className="text-sm font-medium text-red-800">Administrative Control Panel</h3>
            <p className="mt-1 text-sm text-red-700">
              Actions on this page affect all users in production. Proceed with caution.
            </p>
          </div>
        </div>
      </div>

      {/* Current Week Status - Context for actions */}
      <div className={`rounded-lg border-2 p-4 ${
        isWeekLocked
          ? 'border-red-300 bg-red-50'
          : 'border-green-300 bg-green-50'
      }`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-6">
            {/* Lock Status Icon */}
            <div className="flex-shrink-0">
              {isWeekLocked ? (
                <div className="flex items-center justify-center h-12 w-12 rounded-full bg-red-100">
                  <svg className="h-6 w-6 text-red-600" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                  </svg>
                </div>
              ) : (
                <div className="flex items-center justify-center h-12 w-12 rounded-full bg-green-100">
                  <svg className="h-6 w-6 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M10 2a5 5 0 00-5 5v2a2 2 0 00-2 2v5a2 2 0 002 2h10a2 2 0 002-2v-5a2 2 0 00-2-2H7V7a3 3 0 015.905-.75 1 1 0 001.937-.5A5.002 5.002 0 0010 2z" />
                  </svg>
                </div>
              )}
            </div>

            {/* Week Info */}
            <div>
              <div className="flex items-center gap-3">
                <span className="text-lg font-semibold text-gray-900">
                  Playoff Week {currentPlayoffWeek ?? '—'}
                </span>
                <span className="text-gray-400">|</span>
                <span className="text-lg text-gray-700">
                  NFL Week {currentNflWeek ?? '—'}
                </span>
              </div>
              <div className={`text-sm font-medium ${isWeekLocked ? 'text-red-700' : 'text-green-700'}`}>
                {isWeekLocked
                  ? 'Week is LOCKED — Users cannot modify picks'
                  : 'Week is UNLOCKED — Users can modify picks'}
              </div>
            </div>
          </div>

          {/* Next Week Info */}
          <div className="text-right">
            <div className="text-sm text-gray-500">Next Week</div>
            <div className="text-sm font-medium text-gray-700">
              Playoff Week {currentPlayoffWeek !== null ? currentPlayoffWeek + 1 : '—'} / NFL Week {nextNflWeek ?? '—'}
            </div>
          </div>
        </div>
      </div>

      {/* Admin Edit Mode Control */}
      <div className={`rounded-lg border p-4 ${
        editModeEnabled
          ? 'border-red-300 bg-red-50'
          : 'border-amber-200 bg-amber-50'
      }`}>
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
              Admin Edit Mode
              {editModeEnabled && (
                <span className="inline-flex items-center rounded-full bg-red-600 px-2.5 py-0.5 text-xs font-medium text-white">
                  ACTIVE
                </span>
              )}
            </h2>

            {editModeEnabled ? (
              <p className="mt-1 text-sm text-red-800">
                Edit mode is active. Administrative controls are enabled.
              </p>
            ) : (
              <div className="mt-1 space-y-2">
                <p className="text-sm text-amber-800">
                  <strong>Warning:</strong> Administrative actions affect all users in production.
                  Edit mode resets on page refresh.
                </p>
                <p className="text-xs text-amber-700">
                  Type <code className="bg-amber-100 px-1 py-0.5 rounded font-mono">ENABLE ADMIN EDIT MODE</code> to enable.
                </p>
              </div>
            )}
          </div>

          {editModeEnabled && (
            <button
              onClick={() => {
                setEditModeEnabled(false);
                setEditModeInput('');
              }}
              className="rounded-md bg-gray-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700"
            >
              Disable Edit Mode
            </button>
          )}
        </div>

        {!editModeEnabled && (
          <div className="mt-3 flex items-center gap-2">
            <input
              type="text"
              value={editModeInput}
              onChange={(e) => setEditModeInput(e.target.value)}
              placeholder="Type confirmation phrase"
              className="flex-1 rounded-md border border-amber-300 px-3 py-1.5 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
            />
            <button
              onClick={() => setEditModeEnabled(true)}
              disabled={editModeInput !== ADMIN_EDIT_MODE_PHRASE}
              className="rounded-md bg-amber-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Enable
            </button>
          </div>
        )}
      </div>

      {/* System Health Panel - Read-only operational monitoring */}
      <SystemHealthPanel />

      {/* Planned Admin Panels (read-only, coming next) */}
      {/* <ComplianceOverviewPanel /> */}
      {/* <WeekVerificationPanel /> */}

      {/* Week Management Panel */}
      <div className={`rounded-lg border bg-white shadow-sm ${!editModeEnabled ? 'border-gray-100 opacity-60' : 'border-gray-200'}`}>
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
          <h2 className="text-lg font-medium text-gray-900">Week Management</h2>
          <p className="text-sm text-gray-500">
            {!editModeEnabled
              ? 'Enable Admin Edit Mode to access controls'
              : 'Control contest week state'}
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
                  disabled={!editModeEnabled || isWeekLocked}
                  className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Lock Week
                </button>
                <button
                  onClick={() => setUnlockModalOpen(true)}
                  disabled={!editModeEnabled || !isWeekLocked}
                  className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Unlock Week
                </button>
              </div>
            </div>
            <p className="mt-2 text-xs text-gray-500">
              {isWeekLocked
                ? 'Week is locked. Users cannot modify picks. Ready to advance.'
                : 'Week is unlocked. Users can modify picks. Lock week before advancing.'}
            </p>
            {/* Inline disable reason for Lock/Unlock buttons */}
            {!editModeEnabled && (
              <div className="mt-2 flex items-center gap-2 text-xs text-red-600">
                <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                <span>Admin Edit Mode is OFF</span>
              </div>
            )}
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

          {/* Lock Verification Panel - Admin verification step */}
          <div className={`rounded-md border p-3 ${
            lockVerification?.verification?.isLocked
              ? 'border-green-200 bg-green-50'
              : lockVerification?.verification?.isLocked === false
              ? 'border-yellow-200 bg-yellow-50'
              : 'border-gray-200 bg-gray-50'
          }`}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-gray-900">Lock Verification</h3>
              <button
                onClick={handleVerifyLock}
                disabled={lockVerificationLoading}
                className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {lockVerificationLoading ? 'Verifying...' : 'Verify Lock Status'}
              </button>
            </div>
            <p className="text-xs text-gray-600 mb-2">
              Click "Verify Lock Status" to confirm the lock is truly active at the API layer.
            </p>
            {lockVerification && (
              <div className="mt-2 space-y-1">
                <div className={`flex items-center gap-2 text-sm font-medium ${
                  lockVerification.verification.isLocked ? 'text-green-700' : 'text-yellow-700'
                }`}>
                  {lockVerification.verification.isLocked ? (
                    <svg className="h-5 w-5 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                  ) : (
                    <svg className="h-5 w-5 text-yellow-600" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                  )}
                  {lockVerification.verification.message}
                </div>
                <div className="text-xs text-gray-500">
                  Last verified: {lockVerification.verification.lastUpdated
                    ? new Date(lockVerification.verification.lastUpdated).toLocaleString()
                    : '—'}
                </div>
              </div>
            )}
          </div>

          {/* Advance to Next Week */}
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <button
                onClick={async () => {
                  // Step 1: Fetch preview data before showing confirmation modal
                  setPreviewLoading(true);
                  setPreviewError(null);
                  setPreviewData(null);
                  setPreviewTeamsConfirmed(false);
                  try {
                    const response = await previewWeekTransition();
                    if (response.success && response.preview) {
                      setPreviewData(response.preview);
                      setWeekTransitionModalOpen(true);
                    } else {
                      setPreviewError('Preview failed: unexpected response');
                    }
                  } catch (err) {
                    setPreviewError(err instanceof Error ? err.message : 'Failed to fetch preview');
                  } finally {
                    setPreviewLoading(false);
                  }
                }}
                disabled={!editModeEnabled || isTransitionDisabled || previewLoading}
                className="rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {previewLoading ? 'Loading Preview...' : 'Advance to Next Week'}
              </button>
              <span className="text-sm text-gray-500">
                {currentNflWeek && nextNflWeek
                  ? `NFL Week ${currentNflWeek} → Week ${nextNflWeek}`
                  : 'Progress the contest to the next NFL week'}
              </span>
            </div>
            {/* Inline disable reason */}
            {(!editModeEnabled || transitionDisableReason) && (
              <div className="flex items-center gap-2 text-sm text-red-600">
                <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                <span>{!editModeEnabled ? 'Admin Edit Mode is OFF' : transitionDisableReason}</span>
              </div>
            )}
            {/* Preview error */}
            {previewError && (
              <div className="flex items-center gap-2 text-sm text-red-600">
                <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                <span>Preview failed: {previewError}</span>
              </div>
            )}
          </div>
        </div>
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
                    <li key={team} className="py-0.5">
                      {team}
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


      {/* Confirmation Modals */}
      <ConfirmationModal
        isOpen={weekTransitionModalOpen}
        onClose={() => {
          setWeekTransitionModalOpen(false);
          setPreviewData(null);
          setPreviewTeamsConfirmed(false);
        }}
        onConfirm={() => {
          const adminUserId = getAdminUserId();
          if (!adminUserId) {
            console.error('Missing admin user ID for week transition');
            return;
          }
          // Backend requires previewConfirmed: true
          weekTransitionMutation.mutate({
            userId: adminUserId,
            previewConfirmed: true,
          });
        }}
        title="Advance to Next Week"
        description={previewData
          ? `ESPN returned ${previewData.teamCount} teams for NFL Week ${previewData.nflWeek} (Playoff Week ${previewData.toPlayoffWeek}). Review the teams below and confirm they are correct.`
          : "This will advance the contest to the next playoff week."}
        confirmText="Advance Week"
        confirmationPhrase="ADVANCE WEEK"
        isLoading={weekTransitionMutation.isPending}
        extraConfirmCheck={previewTeamsConfirmed}
      >
        {previewData && (
          <div className="space-y-3">
            {/* ESPN Teams List */}
            <div className="rounded-md bg-blue-50 border border-blue-200 p-3">
              <p className="text-sm font-medium text-blue-800 mb-2">
                Active Teams from ESPN ({previewData.teamCount} teams, {previewData.eventCount} games):
              </p>
              <div className="flex flex-wrap gap-2">
                {previewData.activeTeams.map((team) => (
                  <span
                    key={team}
                    className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800"
                  >
                    {team}
                  </span>
                ))}
              </div>
            </div>

            {/* Confirmation Checkbox */}
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={previewTeamsConfirmed}
                onChange={(e) => setPreviewTeamsConfirmed(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
              />
              <span className="text-sm text-gray-700">
                I confirm these teams are correct for NFL Week {previewData.nflWeek}
              </span>
            </label>
          </div>
        )}
      </ConfirmationModal>

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
