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
  message: string;
  newWeek?: number;
  // Extended fields returned by process-week-transition
  advancedCount?: number;
  eliminatedCount?: number;
  activeTeams?: Array<{ userId: string; username: string | null }>;
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
  fromWeek: number;
  toWeek: number;
}

export interface GameConfig {
  id: string;
  playoff_start_week: number;
  current_playoff_week: number;
  is_week_active: boolean;
  season_year: string;
}

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
// DEPENDENCY: These require backend endpoints to be implemented.
// Expected endpoints:
//   GET /api/admin/picks/count?week={weekNumber}
//   GET /api/admin/scores/count?week={weekNumber}
//   GET /api/admin/picks/multiplier-distribution?week={weekNumber}

export async function getPickCountForWeek(weekNumber: number): Promise<number> {
  // STUB: Replace with actual endpoint when available
  // Expected: GET /api/admin/picks/count?week={weekNumber}
  try {
    const result = await apiRequest<{ count: number }>(`/api/admin/picks/count?week=${weekNumber}`);
    return result.count;
  } catch {
    // Return -1 to indicate endpoint not available
    return -1;
  }
}

export async function getScoreCountForWeek(weekNumber: number): Promise<number> {
  // STUB: Replace with actual endpoint when available
  // Expected: GET /api/admin/scores/count?week={weekNumber}
  try {
    const result = await apiRequest<{ count: number }>(`/api/admin/scores/count?week=${weekNumber}`);
    return result.count;
  } catch {
    // Return -1 to indicate endpoint not available
    return -1;
  }
}

export async function getMultiplierDistribution(weekNumber: number): Promise<Record<string, number>> {
  // STUB: Replace with actual endpoint when available
  // Expected: GET /api/admin/picks/multiplier-distribution?week={weekNumber}
  try {
    return await apiRequest<Record<string, number>>(`/api/admin/picks/multiplier-distribution?week=${weekNumber}`);
  } catch {
    // Return empty object to indicate endpoint not available
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
