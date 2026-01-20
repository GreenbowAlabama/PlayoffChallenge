import { apiRequest } from './client';

// Types for admin API responses
export interface GameState {
  currentWeek: number;
  season: number;
  isWeekActive: boolean;
  userCount: number;
  cacheStatus: 'healthy' | 'stale';
}

export interface CacheStatus {
  activeGames: unknown[];
  cachedPlayerCount: number;
  lastScoreboardUpdate: string | null;
}

export interface CleanupResponse {
  success: boolean;
  deletedCount: number;
  message: string;
}

export interface WeekTransitionResponse {
  success: boolean;
  message?: string;
  error?: string;
  // Transition details
  fromPlayoffWeek?: number;
  toPlayoffWeek?: number;
  fromWeek?: number;  // NFL week
  toWeek?: number;    // NFL week
  advancedCount?: number;
  eliminatedCount?: number;
  activeTeams?: string[];
  eliminated?: Array<{
    userId: string;
    playerId: string;
    playerName: string;
    position: string;
    team: string;
  }>;
  // New state after transition
  newState?: {
    current_playoff_week: number;
    effective_nfl_week: number;
  };
}

// Pre-flight and verification types
export interface WeekPreflightStatus {
  pickCountForNextWeek: number;
  scoreCountForNextWeek: number;
  multiplierDistribution: Record<string, number>; // e.g., {"1x": 5, "2x": 3}
}

export interface VerificationStatus {
  pickCount: number;
  scoreCount: number;
  multiplierDistribution: Record<string, number>;
  anomalies: string[];
}

export interface WeekTransitionParams {
  userId: string;
  // NOTE: fromWeek and toWeek are now derived server-side from game_settings
  // These fields are ignored by the backend but kept for type compatibility
  fromWeek?: number;
  toWeek?: number;
}

export interface GameConfig {
  id: string;
  playoff_start_week: number;
  current_playoff_week: number;
  is_week_active: boolean;
  season_year: string;
}

// ============================================
// LOCK VERIFICATION TYPES
// ============================================

export interface LockVerification {
  isLocked: boolean;
  isWeekActive: boolean;
  currentPlayoffWeek: number;
  effectiveNflWeek: number | null;
  lastUpdated: string;
  message: string;
}

export interface LockVerificationResponse {
  success: boolean;
  verification: LockVerification;
}

// ============================================
// INCOMPLETE LINEUPS TYPES
// ============================================

export interface IncompleteLineupUser {
  userId: string;
  email: string;
  username: string | null;
  isAdmin: boolean;
  totalPicks: number;
  missingPositions: string[];
  positionCounts: {
    QB: number;
    RB: number;
    WR: number;
    TE: number;
    K: number;
    DEF: number;
  };
}

export interface IncompletLineupsResponse {
  success: boolean;
  weekNumber: number | null;
  playoffWeek: number;
  isWeekActive: boolean;
  totalRequired: number;
  requiredByPosition: {
    QB: number;
    RB: number;
    WR: number;
    TE: number;
    K: number;
    DEF: number;
  };
  incompleteCount: number;
  totalPaidUsers: number;
  users: IncompleteLineupUser[];
  message?: string;
}

// ============================================
// READ-ONLY TREND ANALYTICS TYPES
// ============================================
// These types are for informational display only.
// They must NOT influence admin actions or mutate state.

export interface PlayerPickTrend {
  playerId: string;
  playerName: string;
  position: string;
  team: string;
  pickCount: number;
}

export interface TeamPickTrend {
  teamAbbr: string;
  pickCount: number;
}

export interface ConferencePickTrend {
  conference: 'AFC' | 'NFC';
  pickCount: number;
}

export type TrendWeekRange = 'current' | 'all';

// ============================================
// UI-EXPOSED ENDPOINTS ONLY
// ============================================

// Capability 4: Read-Only Game State Inspection
export async function getUsers(): Promise<{ count: number }> {
  const users = await apiRequest<unknown[]>('/api/admin/users');
  return { count: users.length };
}

export async function getCacheStatus(): Promise<CacheStatus> {
  return apiRequest<CacheStatus>('/api/admin/cache-status');
}

// Capability 1: Week Management
export async function setActiveWeek(weekNumber: number): Promise<WeekTransitionResponse> {
  return apiRequest<WeekTransitionResponse>('/api/admin/set-active-week', {
    method: 'POST',
    body: JSON.stringify({ weekNumber }),
  });
}

export async function processWeekTransition(params: WeekTransitionParams): Promise<WeekTransitionResponse> {
  return apiRequest<WeekTransitionResponse>('/api/admin/process-week-transition', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

// Fetch game configuration (public endpoint)
export async function getGameConfig(): Promise<GameConfig> {
  return apiRequest<GameConfig>('/api/game-config');
}

// Extract admin user ID from stored JWT token
export function getAdminUserId(): string | null {
  const token = localStorage.getItem('admin_token');
  if (!token) return null;

  try {
    // Decode JWT payload (base64url encoded, no verification needed - already validated by backend)
    const payloadPart = token.split('.')[1];
    const decoded = JSON.parse(atob(payloadPart.replace(/-/g, '+').replace(/_/g, '/')));
    return decoded.sub || null;
  } catch {
    return null;
  }
}

export async function updateWeekStatus(isActive: boolean): Promise<WeekTransitionResponse> {
  return apiRequest<WeekTransitionResponse>('/api/admin/update-week-status', {
    method: 'POST',
    body: JSON.stringify({ is_week_active: isActive }),
  });
}

// Verify lock status - authoritative confirmation for admin verification
export async function verifyLockStatus(): Promise<LockVerificationResponse> {
  return apiRequest<LockVerificationResponse>('/api/admin/verify-lock-status');
}

// Get users with incomplete lineups for the active week
export async function getIncompleteLineups(): Promise<IncompletLineupsResponse> {
  return apiRequest<IncompletLineupsResponse>('/api/admin/incomplete-lineups');
}

// Capability 2: Non-Admin User Cleanup
export async function cleanupNonAdminUsers(): Promise<CleanupResponse> {
  return apiRequest<CleanupResponse>('/api/admin/users/cleanup', {
    method: 'POST',
  });
}

// Capability 3: Non-Admin Pick Cleanup
export async function cleanupNonAdminPicks(): Promise<CleanupResponse> {
  return apiRequest<CleanupResponse>('/api/admin/picks/cleanup', {
    method: 'POST',
  });
}

// Preview counts for destructive actions
export async function getNonAdminUserCount(): Promise<number> {
  const users = await apiRequest<Array<{ is_admin: boolean }>>('/api/admin/users');
  return users.filter(u => !u.is_admin).length;
}

export async function getNonAdminPickCount(): Promise<number> {
  // This requires reading users first to identify non-admin user IDs
  // For now, we'll return -1 to indicate "unknown" and the cleanup will return actual count
  return -1;
}

// ============================================
// PRE-FLIGHT & VERIFICATION ENDPOINTS
// ============================================
// These endpoints support post-transition verification in web-admin.
// Backend endpoints implemented in server.js lines 1748-1835.

export async function getPickCountForWeek(weekNumber: number): Promise<number> {
  try {
    const result = await apiRequest<{ count: number }>(`/api/admin/picks/count?week=${weekNumber}`);
    return result.count;
  } catch {
    // Return -1 to indicate endpoint error
    return -1;
  }
}

export async function getScoreCountForWeek(weekNumber: number): Promise<number> {
  try {
    const result = await apiRequest<{ count: number }>(`/api/admin/scores/count?week=${weekNumber}`);
    return result.count;
  } catch {
    // Return -1 to indicate endpoint error
    return -1;
  }
}

export async function getMultiplierDistribution(weekNumber: number): Promise<Record<string, number>> {
  try {
    return await apiRequest<Record<string, number>>(`/api/admin/picks/multiplier-distribution?week=${weekNumber}`);
  } catch {
    // Return empty object to indicate endpoint error
    return {};
  }
}

export async function getWeekVerificationStatus(weekNumber: number): Promise<VerificationStatus> {
  // Aggregates multiple checks into a single verification status
  const [pickCount, scoreCount, multiplierDist] = await Promise.all([
    getPickCountForWeek(weekNumber),
    getScoreCountForWeek(weekNumber),
    getMultiplierDistribution(weekNumber),
  ]);

  const anomalies: string[] = [];

  // Anomaly detection
  if (scoreCount > 0) {
    anomalies.push(`Unexpected: ${scoreCount} scores already exist for week ${weekNumber}`);
  }

  return {
    pickCount,
    scoreCount,
    multiplierDistribution: multiplierDist,
    anomalies,
  };
}

// ============================================
// READ-ONLY TREND ANALYTICS ENDPOINTS
// ============================================
// INFORMATIONAL ONLY - These functions provide observational data.
// They must NOT influence admin decisions or trigger any actions.
// No retries, no assumptions. Return empty arrays on failure.
//
// BACKEND DEPENDENCIES:
//   GET /api/admin/trends/players?weekRange={current|all}
//   GET /api/admin/trends/teams?weekRange={current|all}
//   GET /api/admin/trends/conferences?weekRange={current|all}
//
// These endpoints are NOT YET IMPLEMENTED in the backend.
// Functions will return empty arrays until backend support is added.

export async function getPlayerPickTrends(weekRange: TrendWeekRange = 'current'): Promise<PlayerPickTrend[]> {
  // STUB: Backend endpoint not yet implemented
  // Expected: GET /api/admin/trends/players?weekRange={current|all}
  // Returns: Array of { playerId, playerName, position, team, pickCount }
  try {
    return await apiRequest<PlayerPickTrend[]>(`/api/admin/trends/players?weekRange=${weekRange}`);
  } catch {
    // Return empty array on failure - do not retry
    return [];
  }
}

export async function getTeamPickTrends(weekRange: TrendWeekRange = 'current'): Promise<TeamPickTrend[]> {
  // STUB: Backend endpoint not yet implemented
  // Expected: GET /api/admin/trends/teams?weekRange={current|all}
  // Returns: Array of { teamAbbr, pickCount }
  try {
    return await apiRequest<TeamPickTrend[]>(`/api/admin/trends/teams?weekRange=${weekRange}`);
  } catch {
    // Return empty array on failure - do not retry
    return [];
  }
}

export async function getConferencePickTrends(weekRange: TrendWeekRange = 'current'): Promise<ConferencePickTrend[]> {
  // STUB: Backend endpoint not yet implemented
  // Expected: GET /api/admin/trends/conferences?weekRange={current|all}
  // Returns: Array of { conference: 'AFC' | 'NFC', pickCount }
  try {
    return await apiRequest<ConferencePickTrend[]>(`/api/admin/trends/conferences?weekRange=${weekRange}`);
  } catch {
    // Return empty array on failure - do not retry
    return [];
  }
}
