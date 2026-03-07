import { apiRequest } from './client';

// ============================================
// TYPE DEFINITIONS
// ============================================

export interface ContestTemplate {
  id: string;
  name: string;
  sport: string;
  template_type: string;
  scoring_strategy_key: string;
  lock_strategy_key: string;
  settlement_strategy_key: string;
  default_entry_fee_cents: number;
  allowed_entry_fee_min_cents: number;
  allowed_entry_fee_max_cents: number;
  lineup_size: number | null;
  drop_lowest: boolean;
  is_system_generated: boolean;
  is_active: boolean;
  created_at: string;
}

export interface CreateTemplateRequest {
  name: string;
  sport: string;
  template_type: string;
  scoring_strategy_key: string;
  lock_strategy_key: string;
  settlement_strategy_key: string;
  default_entry_fee_cents: number;
  allowed_entry_fee_min_cents: number;
  allowed_entry_fee_max_cents: number;
  allowed_payout_structures: string[];
  lineup_size?: number;
  drop_lowest?: boolean;
  scoring_format?: string;
}

// ============================================
// API FUNCTIONS
// ============================================

export async function listTemplates(systemOnly?: boolean): Promise<ContestTemplate[]> {
  const url = `/api/admin/templates/list${systemOnly ? '?system_only=true' : ''}`;
  return apiRequest<{ timestamp: string; count: number; templates: ContestTemplate[] }>(url)
    .then(r => r.templates);
}

export async function createTemplate(data: CreateTemplateRequest): Promise<{ templateId: string }> {
  return apiRequest<{ success: boolean; templateId: string }>(
    '/api/admin/templates/create',
    {
      method: 'POST',
      body: JSON.stringify(data)
    }
  ).then(r => ({ templateId: r.templateId }));
}
