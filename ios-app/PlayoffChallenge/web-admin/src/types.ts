export interface User {
  id: string;
  username: string | null;
  email: string | null;
  name: string | null;
  phone: string | null;
  paid: boolean;
  is_admin: boolean;
  apple_id: string | null;
  created_at: string | null;
  admin_notes: string | null;
}

export interface AuthResponse {
  token: string;
}

export interface AppleAuthRequest {
  id_token: string;
}

// ============================================
// DIAGNOSTICS TYPES (Read-Only)
// ============================================

export interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  latency_ms?: number;
  error?: string;
  http_status?: number;
}

export interface ApiProcessHealth {
  status: 'healthy';
  uptime_seconds: number;
  memory_usage_mb: number;
  node_version: string;
  environment: string;
}

export interface JobHealthSummary {
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  job_count: number;
  healthy?: number;
  error?: number;
  running?: number;
  message?: string;
  jobs?: Array<{
    name: string;
    status: string;
    last_run_at: string | null;
    last_error_message: string | null;
  }>;
}

export interface HealthCheckResponse {
  status: 'healthy' | 'degraded' | 'unhealthy' | 'error';
  timestamp: string;
  checks: {
    api_process: ApiProcessHealth;
    database: HealthCheckResult;
    espn_api: HealthCheckResult;
    sleeper_api: HealthCheckResult;
    background_jobs: JobHealthSummary;
  };
}

export interface UserDiagnostic {
  user_id: string;
  username: string | null;
  email: string | null;
  paid: boolean;
  is_admin: boolean;
  auth_provider: 'apple' | 'email' | 'unknown';
  account_created_at: string | null;
  last_activity_at: string | null;
  state: string | null;
  age_verified: boolean;
  tos_version: string | null;
  tos_accepted_at: string | null;
  payment_method?: string | null;
  payment_date?: string | null;
  eligibility_confirmed_at?: string | null;
}

export interface UserDiagnosticsResponse {
  timestamp: string;
  count: number;
  users: UserDiagnostic[];
}

export interface UserStatsResponse {
  timestamp: string;
  stats: {
    total_users: string;
    paid_users: string;
    admin_users: string;
    apple_auth_users: string;
    email_auth_users: string;
    age_verified_users: string;
    tos_accepted_users: string;
  };
}

export interface TimelineEvent {
  event_type: string;
  description: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface UserTimelineResponse {
  timestamp: string;
  user_id: string;
  event_count: number;
  events: TimelineEvent[];
}

export interface JobStatus {
  name: string;
  registered_at: string;
  last_run_at: string | null;
  last_success_at: string | null;
  last_error_at: string | null;
  last_error_message: string | null;
  run_count: number;
  success_count: number;
  failure_count: number;
  status: 'registered' | 'running' | 'healthy' | 'error';
  interval_ms: number | null;
  description?: string;
}

export interface JobsStatusResponse {
  timestamp: string;
  summary: JobHealthSummary;
  jobs: JobStatus[];
}

export interface GameUpdateTime {
  gameId: string;
  lastUpdate: string;
}

export interface CacheStatusResponse {
  activeGames: unknown[];
  cachedPlayerCount: number;
  lastScoreboardUpdate: string | null;
  gameUpdateTimes: GameUpdateTime[];
}

// ============================================
// PICKS EXPLORER TYPES
// ============================================

export interface Pick {
  id: string;
  user_id: string;
  player_id: string;
  week_number: number;
  position: string | null;
  is_playoff: boolean;
  playoff_week: number | null;
  display_week: string;
  // Player fields (flat, joined from players table)
  full_name: string | null;
  team: string | null;
  sleeper_id: string | null;
  image_url: string | null;
  player_position?: string | null; // alternative field name from some endpoints
}

export interface UserWithPicks {
  user: User;
  picks: Pick[];
  loading: boolean;
  error: string | null;
}
