import { apiRequest } from './client';

// ============================================
// TYPE DEFINITIONS
// ============================================

export interface DiscoveryCycle {
  template_id: string;
  template_name: string;
  provider_tournament_id: string;
  season_year: number;
  template_status: string;
  template_created_at: string;
  instance_count: number;
  latest_instance_created_at: string | null;
}

export interface SystemTemplate {
  id: string;
  name: string;
  sport: string;
  template_type: string;
  provider_tournament_id: string;
  season_year: number;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface SystemInstance {
  id: string;
  contest_name: string;
  status: string;
  template_name: string;
  provider_tournament_id: string;
  provider_event_id: string;
  entry_fee_cents: number;
  max_entries: number;
  current_entries: number;
  start_time: string;
  lock_time: string;
  tournament_start_time: string;
  created_at: string;
}

export interface IngestionEvent {
  id: string;
  contest_instance_id: string;
  event_type: string;
  provider: string;
  validation_status: 'VALID' | 'INVALID';
  received_at: string;
  created_at: string;
  contest_name: string | null;
  template_name: string | null;
}

// ============================================
// API FUNCTIONS
// ============================================

export async function getRecentCycles(limit?: number): Promise<DiscoveryCycle[]> {
  const url = `/api/admin/discovery/recent-cycles${limit ? `?limit=${limit}` : ''}`;
  return apiRequest<{ timestamp: string; count: number; cycles: DiscoveryCycle[] }>(url)
    .then(r => r.cycles);
}

export async function getSystemTemplates(status?: string): Promise<SystemTemplate[]> {
  const url = `/api/admin/discovery/system-templates${status ? `?status=${status}` : ''}`;
  return apiRequest<{ timestamp: string; count: number; templates: SystemTemplate[] }>(url)
    .then(r => r.templates);
}

export async function getSystemInstances(
  templateId?: string,
  status?: string
): Promise<SystemInstance[]> {
  const params = new URLSearchParams();
  if (templateId) params.append('template_id', templateId);
  if (status) params.append('status', status);
  const query = params.toString();
  const url = `/api/admin/discovery/system-instances${query ? `?${query}` : ''}`;
  return apiRequest<{ timestamp: string; count: number; instances: SystemInstance[] }>(url)
    .then(r => r.instances);
}

export async function getIngestionEvents(limit?: number): Promise<IngestionEvent[]> {
  const url = `/api/admin/discovery/ingestion-events${limit ? `?limit=${limit}` : ''}`;
  return apiRequest<{ timestamp: string; count: number; events: IngestionEvent[] }>(url)
    .then(r => r.events);
}
