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

export async function processWeekTransition(): Promise<WeekTransitionResponse> {
  return apiRequest<WeekTransitionResponse>('/api/admin/process-week-transition', {
    method: 'POST',
  });
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
