/**
 * System Invariants API Client
 *
 * Provides methods to fetch system invariant monitoring data
 */

import type {
  SystemInvariantsResponse,
  HistoryResponse,
  HistoryRecord
} from '../types/SystemInvariants';

const API_BASE = import.meta.env.VITE_REACT_APP_API_URL || import.meta.env.REACT_APP_API_URL || 'http://localhost:3000';

/**
 * Helper: Build headers with optional authorization
 */
function buildHeaders(): Record<string, string> {
  const token = localStorage.getItem('adminToken');
  return {
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    'Content-Type': 'application/json'
  };
}

export const systemInvariantsApi = {
  /**
   * Execute full invariant check and get aggregated results
   */
  async getCurrentStatus(): Promise<SystemInvariantsResponse> {
    const response = await fetch(`${API_BASE}/api/admin/system-invariants`, {
      method: 'GET',
      headers: buildHeaders()
    });
    if (!response.ok) {
      throw new Error(`System invariants API failed: ${response.statusText}`);
    }
    return response.json();
  },

  /**
   * Retrieve historical invariant check results
   */
  async getHistory(limit: number = 100, offset: number = 0): Promise<HistoryResponse> {
    const params = new URLSearchParams({
      limit: limit.toString(),
      offset: offset.toString()
    });
    const response = await fetch(
      `${API_BASE}/api/admin/system-invariants/history?${params}`,
      {
        method: 'GET',
        headers: buildHeaders()
      }
    );
    if (!response.ok) {
      throw new Error(`History API failed: ${response.statusText}`);
    }
    return response.json();
  },

  /**
   * Get the latest invariant check from history
   */
  async getLatest(): Promise<HistoryRecord> {
    const response = await fetch(`${API_BASE}/api/admin/system-invariants/latest`, {
      method: 'GET',
      headers: buildHeaders()
    });
    if (!response.ok) {
      throw new Error(`Latest check API failed: ${response.statusText}`);
    }
    return response.json();
  }
};
