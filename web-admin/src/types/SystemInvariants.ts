/**
 * System Invariants Type Definitions
 *
 * TypeScript interfaces for system invariant monitoring dashboard
 */

export type InvariantStatus = 'HEALTHY' | 'WARNING' | 'CRITICAL';
export type FinancialStatus = 'BALANCED' | 'DRIFT' | 'CRITICAL_IMBALANCE';
export type LifecycleStatus = 'HEALTHY' | 'STUCK_TRANSITIONS' | 'ERROR';
export type SettlementStatus = 'HEALTHY' | 'INCOMPLETE' | 'ERROR';
export type PipelineStatus = 'HEALTHY' | 'DEGRADED' | 'FAILED';
export type LedgerStatus = 'CONSISTENT' | 'VIOLATIONS' | 'ERROR';

export interface Anomaly {
  type: string;
  contest_id?: string;
  contest_name?: string;
  problem?: string;
  time_overdue_minutes?: number;
  details?: Record<string, any>;
  count?: number;
  sample_ids?: string[];
  message?: string;
}

export interface FinancialInvariant {
  status: FinancialStatus;
  timestamp: string;
  invariant_equation: string;
  values: {
    wallet_liability_cents: number;
    contest_pools_cents: number;
    deposits_cents: number;
    withdrawals_cents: number;
    left_side_cents: number;
    right_side_cents: number;
    difference_cents: number;
  };
  details: {
    entry_count_by_type?: Record<string, any>;
    anomalies: Anomaly[];
  };
}

export interface LifecycleInvariant {
  status: LifecycleStatus;
  timestamp: string;
  anomalies: Anomaly[];
  details: {
    total_locked_contests: number;
    total_live_contests: number;
    stuck_locked_count: number;
    stuck_live_count: number;
  };
}

export interface SettlementInvariant {
  status: SettlementStatus;
  timestamp: string;
  anomalies: Anomaly[];
  details: {
    total_complete_contests: number;
    total_settled_contests: number;
    settlement_lag_minutes: number;
  };
}

export interface PipelineWorkerStatus {
  status: 'HEALTHY' | 'DEGRADED' | 'UNKNOWN';
  last_run: string | null;
  error_count_1h: number;
  details: string;
}

export interface PipelineInvariant {
  status: PipelineStatus;
  timestamp: string;
  pipeline_status: {
    discovery_worker: PipelineWorkerStatus;
    lifecycle_reconciler: PipelineWorkerStatus;
    ingestion_worker: PipelineWorkerStatus;
  };
  anomalies: Anomaly[];
}

export interface LedgerInvariant {
  status: LedgerStatus;
  timestamp: string;
  anomalies: Anomaly[];
  details: {
    total_entries: number;
    constraint_violations: number;
    balance_status: 'VERIFIED' | 'DRIFT' | 'ERROR';
  };
}

export interface SystemInvariantsResponse {
  overall_status: InvariantStatus;
  last_check_timestamp: string;
  execution_time_ms: number;
  invariants: {
    financial: FinancialInvariant;
    lifecycle: LifecycleInvariant;
    settlement: SettlementInvariant;
    pipeline: PipelineInvariant;
    ledger: LedgerInvariant;
  };
}

export interface HistoryRecord {
  id: string;
  overall_status: InvariantStatus;
  execution_time_ms: number;
  created_at: string;
  summary: {
    financial_status: FinancialStatus;
    lifecycle_status: LifecycleStatus;
    settlement_status: SettlementStatus;
    pipeline_status: PipelineStatus;
    ledger_status: LedgerStatus;
  };
}

export interface HistoryResponse {
  records: HistoryRecord[];
  total_count: number;
  limit: number;
  offset: number;
}
