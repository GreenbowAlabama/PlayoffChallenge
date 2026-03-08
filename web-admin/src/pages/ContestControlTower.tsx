/**
 * Contest Control Tower
 *
 * Operational visibility into contests, entries, picks, and scoring during live tournaments.
 * Read-only dashboard for real-time contest monitoring.
 *
 * STATUS:
 * - Live Contest Status ✓ Real
 * - Contest Lifecycle ✓ Real
 * - Player Pool Integrity ✓ Real (ingestion events)
 * - Entry Health ⏳ Coming Soon
 * - Lineups & Picks ⏳ Coming Soon
 * - Scoring Pipeline ⏳ Coming Soon
 * - Leaderboard Snapshot ⏳ Coming Soon
 */

import React, { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getSystemInstances,
  getIngestionEvents,
} from '../api/discovery';
import type { SystemInstance, IngestionEvent } from '../api/discovery';
import '../styles/ContestControlTower.css';

// Status badge colors
function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    LIVE: 'bg-red-100 text-red-800',
    LOCKED: 'bg-amber-100 text-amber-800',
    COMPLETE: 'bg-green-100 text-green-800',
    SCHEDULED: 'bg-blue-100 text-blue-800',
    unknown: 'bg-gray-100 text-gray-800',
  };

  return (
    <span className={`status-badge ${colors[status] || colors.unknown}`}>
      {status}
    </span>
  );
}

// Format currency
function formatCurrency(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// Safe timestamp formatting
function formatTimestamp(timestamp: string | null | undefined): string {
  if (!timestamp) return '—';
  try {
    return new Date(timestamp).toLocaleString();
  } catch {
    return '—';
  }
}

// Format timestamp to relative time
function formatRelativeTime(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSeconds < 60) return `${diffSeconds}s ago`;
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  } catch {
    return '—';
  }
}

// Expandable contest row
function ContestRow({ contest }: { contest: SystemInstance }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="contest-row">
      <div className="contest-row-header" onClick={() => setExpanded(!expanded)}>
        <div className="expand-toggle">{expanded ? '▼' : '▶'}</div>
        <div className="contest-name">{contest.contest_name}</div>
        <StatusBadge status={contest.status} />
        <div className="contest-meta">
          <span>{contest.current_entries} entries</span>
          <span>{formatCurrency(contest.entry_fee_cents)}</span>
        </div>
      </div>
      {expanded && (
        <div className="contest-row-details">
          <div className="detail-group">
            <div className="detail-item">
              <span className="label">Contest ID:</span>
              <code>{contest.id}</code>
            </div>
            <div className="detail-item">
              <span className="label">Template:</span>
              <code>{contest.template_name}</code>
            </div>
            {contest.provider_event_id && (
              <div className="detail-item">
                <span className="label">Provider Event ID:</span>
                <code>{contest.provider_event_id}</code>
              </div>
            )}
            <div className="detail-item">
              <span className="label">Max Entries:</span>
              <span>{contest.max_entries || 'Unlimited'}</span>
            </div>
            <div className="detail-item">
              <span className="label">Lock Time:</span>
              <span>{formatTimestamp(contest.lock_time)}</span>
            </div>
            <div className="detail-item">
              <span className="label">Start Time:</span>
              <span>{formatTimestamp(contest.start_time)}</span>
            </div>
            <div className="detail-item">
              <span className="label">Created At:</span>
              <span>{formatTimestamp(contest.created_at)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Coming Soon placeholder
function ComingSoonSection({ title }: { title: string }) {
  return (
    <div className="coming-soon-placeholder">
      <div className="coming-soon-icon">⏳</div>
      <h3>{title}</h3>
      <p>Real-time data integration in progress</p>
    </div>
  );
}

export const ContestControlTower: React.FC = () => {
  const queryClient = useQueryClient();
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    'live-contests': true,
    'lifecycle': true,
    'player-pools': true,
    'entry-health': false,
    'lineups': false,
    'scoring': false,
    'leaderboard': false,
  });

  // Fetch live and recent contests
  const { data: allInstances = [], isLoading: instancesLoading } = useQuery({
    queryKey: ['controlTower', 'instances'],
    queryFn: async () => {
      const live = await getSystemInstances(undefined, 'LIVE');
      const locked = await getSystemInstances(undefined, 'LOCKED');
      return [...live, ...locked].sort((a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    },
    staleTime: 30000,
  });

  // Fetch ingestion events for player pool integrity
  const { data: ingestionEvents = [] } = useQuery({
    queryKey: ['controlTower', 'ingestion'],
    queryFn: () => getIngestionEvents(50),
    staleTime: 30000,
  });

  // Manual refresh
  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['controlTower'] });
  };

  // Auto-refresh logic
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      handleRefresh();
    }, 10000);

    return () => clearInterval(interval);
  }, [autoRefresh]);

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  // Calculate live contest stats
  const liveContests = allInstances.filter(c => c.status === 'LIVE');
  const lockedContests = allInstances.filter(c => c.status === 'LOCKED');
  const totalEntries = allInstances.reduce((sum, c) => sum + c.current_entries, 0);

  // Group ingestion events by contest
  const eventsByContest = new Map<string, IngestionEvent[]>();
  ingestionEvents.forEach(event => {
    const key = event.contest_instance_id;
    if (!eventsByContest.has(key)) {
      eventsByContest.set(key, []);
    }
    eventsByContest.get(key)!.push(event);
  });

  // Get latest ingestion event per contest
  const latestEventPerContest = new Map<string, IngestionEvent>();
  eventsByContest.forEach((events, contestId) => {
    const latest = events.reduce((a, b) =>
      new Date(b.created_at) > new Date(a.created_at) ? b : a
    );
    latestEventPerContest.set(contestId, latest);
  });

  return (
    <div className="contest-control-tower">
      {/* Header */}
      <div className="tower-header">
        <div>
          <h1>Contest Control Tower</h1>
          <p className="subtitle">Operational visibility into contests, entries, picks, and scoring</p>
        </div>
        <div className="header-controls">
          <button
            className="btn-refresh"
            onClick={handleRefresh}
            disabled={instancesLoading}
          >
            {instancesLoading ? 'Refreshing...' : 'Refresh'}
          </button>
          <label className="auto-refresh-toggle">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={e => setAutoRefresh(e.target.checked)}
            />
            Auto-refresh (10s)
          </label>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="quick-stats">
        <div className="stat-card">
          <div className="stat-label">Live Contests</div>
          <div className="stat-value">{liveContests.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Locked Contests</div>
          <div className="stat-value">{lockedContests.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total Entries</div>
          <div className="stat-value">{totalEntries}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Last Update</div>
          <div className="stat-value timestamp">
            {new Date().toLocaleTimeString()}
          </div>
        </div>
      </div>

      {/* Section 1: Live Contest Status */}
      <div className="tower-section">
        <div
          className="section-header"
          onClick={() => toggleSection('live-contests')}
        >
          <span className="expand-icon">
            {expandedSections['live-contests'] ? '▼' : '▶'}
          </span>
          <h2>Live Contest Status ✓</h2>
          <span className="section-count">({allInstances.length})</span>
        </div>
        {expandedSections['live-contests'] && (
          <div className="section-content">
            <div className="contests-list">
              {allInstances.length === 0 ? (
                <div className="empty-state">No live or locked contests</div>
              ) : (
                allInstances.map(contest => (
                  <ContestRow key={contest.id} contest={contest} />
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Section 2: Entry Health (Coming Soon) */}
      <div className="tower-section deferred">
        <div className="section-header" onClick={() => toggleSection('entry-health')}>
          <span className="expand-icon">
            {expandedSections['entry-health'] ? '▼' : '▶'}
          </span>
          <h2>Entry Health ⏳</h2>
        </div>
        {expandedSections['entry-health'] && (
          <div className="section-content">
            <ComingSoonSection title="Entry Health" />
          </div>
        )}
      </div>

      {/* Section 3: Lineups & Picks (Coming Soon) */}
      <div className="tower-section deferred">
        <div className="section-header" onClick={() => toggleSection('lineups')}>
          <span className="expand-icon">
            {expandedSections['lineups'] ? '▼' : '▶'}
          </span>
          <h2>Lineups & Picks ⏳</h2>
        </div>
        {expandedSections['lineups'] && (
          <div className="section-content">
            <ComingSoonSection title="Lineups & Picks Visibility" />
          </div>
        )}
      </div>

      {/* Section 4: Player Pool Integrity */}
      <div className="tower-section">
        <div className="section-header" onClick={() => toggleSection('player-pools')}>
          <span className="expand-icon">
            {expandedSections['player-pools'] ? '▼' : '▶'}
          </span>
          <h2>Player Pool Integrity ✓</h2>
        </div>
        {expandedSections['player-pools'] && (
          <div className="section-content">
            {ingestionEvents.length === 0 ? (
              <div className="empty-state">No ingestion events</div>
            ) : (
              <div className="pools-table">
                <div className="table-header">
                  <div className="col-event">Contest</div>
                  <div className="col-source">Event Type</div>
                  <div className="col-status">Validation</div>
                  <div className="col-update">Last Update</div>
                </div>
                {ingestionEvents.map(event => (
                  <div key={event.id} className="table-row">
                    <div className="col-event">
                      {event.contest_name || event.template_name || '—'}
                    </div>
                    <div className="col-source">{event.event_type}</div>
                    <div className="col-status">
                      <StatusBadge
                        status={event.validation_status === 'VALID' ? 'COMPLETE' : 'LOCKED'}
                      />
                    </div>
                    <div className="col-update">
                      {formatRelativeTime(event.created_at)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Section 5: Scoring Pipeline (Coming Soon) */}
      <div className="tower-section deferred">
        <div className="section-header" onClick={() => toggleSection('scoring')}>
          <span className="expand-icon">
            {expandedSections['scoring'] ? '▼' : '▶'}
          </span>
          <h2>Scoring Pipeline ⏳</h2>
        </div>
        {expandedSections['scoring'] && (
          <div className="section-content">
            <ComingSoonSection title="Scoring Pipeline" />
          </div>
        )}
      </div>

      {/* Section 6: Leaderboard Snapshot (Coming Soon) */}
      <div className="tower-section deferred">
        <div className="section-header" onClick={() => toggleSection('leaderboard')}>
          <span className="expand-icon">
            {expandedSections['leaderboard'] ? '▼' : '▶'}
          </span>
          <h2>Leaderboard Snapshot ⏳</h2>
        </div>
        {expandedSections['leaderboard'] && (
          <div className="section-content">
            <ComingSoonSection title="Leaderboard Snapshot" />
          </div>
        )}
      </div>

      {/* Section 7: Contest Lifecycle */}
      <div className="tower-section">
        <div className="section-header" onClick={() => toggleSection('lifecycle')}>
          <span className="expand-icon">
            {expandedSections['lifecycle'] ? '▼' : '▶'}
          </span>
          <h2>Contest Lifecycle ✓</h2>
        </div>
        {expandedSections['lifecycle'] && (
          <div className="section-content">
            {allInstances.length === 0 ? (
              <div className="empty-state">No contests</div>
            ) : (
              <div className="lifecycle-table">
                <div className="table-header">
                  <div className="col-contest">Contest</div>
                  <div className="col-status">Status</div>
                  <div className="col-remaining">Time Remaining</div>
                </div>
                {allInstances.map(contest => {
                  const lockTime = new Date(contest.lock_time);
                  const now = new Date();
                  const remaining = lockTime.getTime() - now.getTime();
                  const hours = Math.floor(remaining / (1000 * 60 * 60));
                  const days = Math.floor(hours / 24);
                  const remainingHours = hours % 24;

                  return (
                    <div key={contest.id} className="table-row">
                      <div className="col-contest">{contest.contest_name}</div>
                      <StatusBadge status={contest.status} />
                      <div className="col-remaining">
                        {remaining > 0
                          ? `${days}d ${remainingHours}h remaining`
                          : 'Locked'}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
