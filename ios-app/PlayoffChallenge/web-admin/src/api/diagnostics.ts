/**
 * Diagnostics API Module
 *
 * Read-only API calls for admin diagnostics endpoints.
 * No mutations - visibility only.
 */

import { apiRequest } from './client';
import type {
  HealthCheckResponse,
  UserDiagnosticsResponse,
  UserDiagnostic,
  UserStatsResponse,
  UserTimelineResponse,
  JobsStatusResponse,
  CacheStatusResponse,
} from '../types';

// ============================================
// HEALTH CHECKS
// ============================================

export async function getHealthCheck(): Promise<HealthCheckResponse> {
  return apiRequest<HealthCheckResponse>('/api/admin/diagnostics/health');
}

// ============================================
// USER DIAGNOSTICS
// ============================================

export async function getAllUserDiagnostics(): Promise<UserDiagnosticsResponse> {
  return apiRequest<UserDiagnosticsResponse>('/api/admin/diagnostics/users');
}

export async function getUserDiagnostics(userId: string): Promise<{ timestamp: string; user: UserDiagnostic }> {
  return apiRequest<{ timestamp: string; user: UserDiagnostic }>(`/api/admin/diagnostics/users/${userId}`);
}

export async function getUserStats(): Promise<UserStatsResponse> {
  return apiRequest<UserStatsResponse>('/api/admin/diagnostics/users-stats');
}

// ============================================
// USER TIMELINE
// ============================================

export async function getUserTimeline(userId: string): Promise<UserTimelineResponse> {
  return apiRequest<UserTimelineResponse>(`/api/admin/diagnostics/timeline/${userId}`);
}

// ============================================
// BACKGROUND JOBS
// ============================================

export async function getJobsStatus(): Promise<JobsStatusResponse> {
  return apiRequest<JobsStatusResponse>('/api/admin/diagnostics/jobs');
}

// ============================================
// CACHE STATUS
// ============================================

export async function getCacheStatus(): Promise<CacheStatusResponse> {
  return apiRequest<CacheStatusResponse>('/api/admin/cache-status');
}
