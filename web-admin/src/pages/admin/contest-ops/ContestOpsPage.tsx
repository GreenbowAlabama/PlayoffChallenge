/**
 * Contest Ops Tower
 *
 * Displays contest lifecycle monitoring and operational health.
 * Shows all contests with key metrics and links to detail views.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getSystemInstances } from '../../../api/discovery';
import { InfoTooltip } from '../../../components/InfoTooltip';
import { RefreshIndicator } from '../../../components/admin/RefreshIndicator';
import type { SystemInstance } from '../../../api/discovery';

function formatCurrency(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatTimestamp(timestamp: string | null | undefined): string {
  if (!timestamp) return '—';
  try {
    return new Date(timestamp).toLocaleString();
  } catch {
    return '—';
  }
}

function StatusBadge({ status }: { status: string }) {
  const statusColors: Record<string, string> = {
    LIVE: 'bg-red-100 text-red-800 border border-red-300',
    LOCKED: 'bg-amber-100 text-amber-800 border border-amber-300',
    COMPLETE: 'bg-green-100 text-green-800 border border-green-300',
    SCHEDULED: 'bg-blue-100 text-blue-800 border border-blue-300',
    unknown: 'bg-gray-100 text-gray-800 border border-gray-300',
  };

  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${statusColors[status] || statusColors.unknown}`}>
      {status}
    </span>
  );
}

function ContestCard({ contest }: { contest: SystemInstance }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-semibold text-gray-900 truncate">{contest.contest_name}</h3>
          <p className="text-xs text-gray-500 font-mono mt-1">{contest.id}</p>
        </div>
        <StatusBadge status={contest.status} />
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div>
          <p className="text-xs text-gray-600">Entries</p>
          <p className="text-lg font-bold text-gray-900">{contest.current_entries}</p>
          {contest.max_entries && (
            <p className="text-xs text-gray-500">
              {contest.current_entries} of {contest.max_entries}
            </p>
          )}
        </div>
        <div>
          <p className="text-xs text-gray-600">Entry Fee</p>
          <p className="text-lg font-bold text-gray-900">{formatCurrency(contest.entry_fee_cents)}</p>
        </div>
      </div>

      <div className="space-y-2 mb-4 border-t pt-3">
        <div className="flex justify-between items-center text-xs">
          <span className="text-gray-600">Lock Time:</span>
          <span className="text-gray-900 font-mono">{formatTimestamp(contest.lock_time)}</span>
        </div>
        <div className="flex justify-between items-center text-xs">
          <span className="text-gray-600">Start Time:</span>
          <span className="text-gray-900 font-mono">{formatTimestamp(contest.start_time)}</span>
        </div>
        {contest.template_name && (
          <div className="flex justify-between items-center text-xs">
            <span className="text-gray-600">Template:</span>
            <span className="text-gray-900 font-mono">{contest.template_name}</span>
          </div>
        )}
      </div>

      {contest.provider_event_id && (
        <div className="mb-4 p-2 bg-blue-50 rounded border border-blue-200">
          <p className="text-xs text-blue-700 font-mono">Event: {contest.provider_event_id}</p>
        </div>
      )}

      <Link
        to={`/contest-ops/${contest.id}`}
        className="inline-flex items-center justify-center w-full rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
      >
        View Details
        <svg className="w-4 h-4 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </Link>
    </div>
  );
}

function ContestSection({ title, status, contests, loading }: { title: React.ReactNode; status: string; contests: SystemInstance[]; loading: boolean }) {
  const [expanded, setExpanded] = useState(status === 'LIVE');

  return (
    <div className="rounded-lg border border-gray-200 bg-white overflow-hidden shadow-sm">
      <div
        className="bg-gray-50 border-b border-gray-200 px-4 py-3 cursor-pointer hover:bg-gray-100 transition-colors flex items-center justify-between"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <svg
            className={`w-5 h-5 text-gray-600 transition-transform ${expanded ? 'rotate-90' : ''}`}
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
          </svg>
          <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
          <span className="ml-2 inline-flex items-center rounded-full px-3 py-1 text-xs font-medium bg-gray-100 text-gray-700">
            {contests.length}
          </span>
        </div>
      </div>

      {expanded && (
        <div className="p-4">
          {loading ? (
            <div className="text-center py-6 text-gray-600">Loading...</div>
          ) : contests.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {contests.map((contest) => (
                <ContestCard key={contest.id} contest={contest} />
              ))}
            </div>
          ) : (
            <div className="text-center py-6 text-gray-500">No contests in this status</div>
          )}
        </div>
      )}
    </div>
  );
}

export function ContestOpsPage() {
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  // Fetch contests by status
  const { data: liveContests = [], isLoading: liveLoading } = useQuery({
    queryKey: ['contests', 'LIVE'],
    queryFn: () => getSystemInstances(undefined, 'LIVE'),
    refetchInterval: 10000,
  });

  const { data: lockedContests = [], isLoading: lockedLoading } = useQuery({
    queryKey: ['contests', 'LOCKED'],
    queryFn: () => getSystemInstances(undefined, 'LOCKED'),
    refetchInterval: 10000,
  });

  const { data: scheduledContests = [], isLoading: scheduledLoading } = useQuery({
    queryKey: ['contests', 'SCHEDULED'],
    queryFn: () => getSystemInstances(undefined, 'SCHEDULED'),
    refetchInterval: 10000,
  });

  const { data: completeContests = [], isLoading: completeLoading } = useQuery({
    queryKey: ['contests', 'COMPLETE'],
    queryFn: () => getSystemInstances(undefined, 'COMPLETE'),
    refetchInterval: 10000,
  });

  useEffect(() => {
    if (liveContests || lockedContests || scheduledContests || completeContests) {
      setLastUpdated(new Date().toLocaleString());
    }
  }, [liveContests, lockedContests, scheduledContests, completeContests]);

  const totalContests = liveContests.length + lockedContests.length + scheduledContests.length + completeContests.length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Contest Ops Tower</h1>
          <p className="mt-1 text-sm text-gray-600">Contest lifecycle monitoring & operational status</p>
        </div>
        <RefreshIndicator lastUpdated={lastUpdated} refreshInterval={10000} />
      </div>

      {/* Quick Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="rounded-lg bg-red-50 border border-red-200 p-4">
          <p className="text-xs font-medium text-red-700 uppercase">Live Contests</p>
          <p className="text-2xl font-bold text-red-900 mt-1">{liveContests.length}</p>
        </div>
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-4">
          <p className="text-xs font-medium text-amber-700 uppercase">Locked</p>
          <p className="text-2xl font-bold text-amber-900 mt-1">{lockedContests.length}</p>
        </div>
        <div className="rounded-lg bg-blue-50 border border-blue-200 p-4">
          <p className="text-xs font-medium text-blue-700 uppercase">Scheduled</p>
          <p className="text-2xl font-bold text-blue-900 mt-1">{scheduledContests.length}</p>
        </div>
        <div className="rounded-lg bg-green-50 border border-green-200 p-4">
          <p className="text-xs font-medium text-green-700 uppercase">Complete</p>
          <p className="text-2xl font-bold text-green-900 mt-1">{completeContests.length}</p>
        </div>
      </div>

      {/* Contest Sections */}
      <div className="space-y-4">
        <ContestSection
          title={<div className="flex items-center gap-2">Live Contests <InfoTooltip text="Contests currently accepting entries or in progress" /></div>}
          status="LIVE"
          contests={liveContests}
          loading={liveLoading}
        />

        <ContestSection
          title={<div className="flex items-center gap-2">Locked Contests <InfoTooltip text="Contests locked but not yet completed" /></div>}
          status="LOCKED"
          contests={lockedContests}
          loading={lockedLoading}
        />

        <ContestSection
          title={<div className="flex items-center gap-2">Scheduled Contests <InfoTooltip text="Contests scheduled for future start" /></div>}
          status="SCHEDULED"
          contests={scheduledContests}
          loading={scheduledLoading}
        />

        <ContestSection
          title={<div className="flex items-center gap-2">Complete Contests <InfoTooltip text="Contests that have finished and been settled" /></div>}
          status="COMPLETE"
          contests={completeContests}
          loading={completeLoading}
        />
      </div>

      {/* Footer info */}
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
        <p className="text-sm text-gray-600">
          <strong>Total Contests:</strong> {totalContests}. Click on any contest to view detailed operational metrics.
        </p>
      </div>
    </div>
  );
}
