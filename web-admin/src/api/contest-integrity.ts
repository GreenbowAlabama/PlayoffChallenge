/**
 * Contest Integrity API Client
 *
 * Provides access to contest integrity diagnostics.
 * Single endpoint for all 5 operational diagnostic panels.
 */

import { apiRequest } from './client';
import type { ContestIntegrityResponse } from '../types/ContestIntegrity';

/**
 * Fetch all contest integrity diagnostics.
 *
 * @returns Promise containing tier integrity, capacity, player pool, duplicates, and timeline data
 */
export async function getContestIntegrity(): Promise<ContestIntegrityResponse> {
  return apiRequest<ContestIntegrityResponse>('/api/admin/contest-ops/contest-integrity');
}
