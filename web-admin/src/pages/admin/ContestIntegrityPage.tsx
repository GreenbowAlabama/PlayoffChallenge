/**
 * Contest Integrity Tower
 *
 * Operational diagnostics for contest integrity.
 * Verifies: tier counts, capacity, player pools, duplicates, lifecycle timing.
 */

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getContestIntegrity } from '../../api/contest-integrity';
import { AdminPanel } from '../../components/admin/AdminPanel';
import { RefreshIndicator } from '../../components/admin/RefreshIndicator';
import type {
  TierIntegrityRecord,
  CapacitySummaryRecord,
  PlayerPoolStatusRecord,
  DuplicateContestRecord,
  TournamentTimelineRecord
} from '../../types/ContestIntegrity';

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

function StatusBadge({ isHealthy }: { isHealthy: boolean }) {
  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${
      isHealthy
        ? 'bg-green-100 text-green-800 border border-green-300'
        : 'bg-red-100 text-red-800 border border-red-300'
    }`}>
      {isHealthy ? 'OK' : 'ERROR'}
    </span>
  );
}

function TierIntegrityPanel({ data }: { data: TierIntegrityRecord[] }) {
  if (data.length === 0) {
    return (
      <AdminPanel
        title="Contest Tier Integrity"
        tooltip="Each platform event should have exactly one contest per entry fee tier. Multiple contests indicate duplication."
      >
        <div className="text-center py-6 text-gray-500">No scheduled platform contests</div>
      </AdminPanel>
    );
  }

  return (
    <AdminPanel
      title="Contest Tier Integrity"
      tooltip="Each platform event should have exactly one contest per entry fee tier. Multiple contests indicate duplication."
    >
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="px-4 py-3 text-left font-semibold text-gray-900">Event</th>
              <th className="px-4 py-3 text-right font-semibold text-gray-900">Entry Fee</th>
              <th className="px-4 py-3 text-right font-semibold text-gray-900">Contests</th>
              <th className="px-4 py-3 text-center font-semibold text-gray-900">Status</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row, idx) => (
              <tr key={`${row.provider_event_id}-${row.entry_fee_cents}-${idx}`} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-3 text-gray-900 font-mono">{row.provider_event_id}</td>
                <td className="px-4 py-3 text-right text-gray-900">{formatCurrency(row.entry_fee_cents)}</td>
                <td className="px-4 py-3 text-right font-semibold text-gray-900">{row.contests}</td>
                <td className="px-4 py-3 text-center">
                  <StatusBadge isHealthy={row.contests === 1} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminPanel>
  );
}

function CapacityPanel({ data }: { data: CapacitySummaryRecord[] }) {
  if (data.length === 0) {
    return (
      <AdminPanel
        title="Event Capacity Summary"
        tooltip="Confirms contests exist and capacity is correctly configured."
      >
        <div className="text-center py-6 text-gray-500">No events with capacity data</div>
      </AdminPanel>
    );
  }

  return (
    <AdminPanel
      title="Event Capacity Summary"
      tooltip="Confirms contests exist and capacity is correctly configured."
    >
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="px-4 py-3 text-left font-semibold text-gray-900">Event</th>
              <th className="px-4 py-3 text-right font-semibold text-gray-900">Contests</th>
              <th className="px-4 py-3 text-right font-semibold text-gray-900">Total Capacity</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row, idx) => (
              <tr key={`${row.provider_event_id}-${idx}`} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-3 text-gray-900 font-mono">{row.provider_event_id}</td>
                <td className="px-4 py-3 text-right text-gray-900">{row.contests}</td>
                <td className="px-4 py-3 text-right font-semibold text-gray-900">{row.total_capacity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminPanel>
  );
}

function PlayerPoolPanel({ data }: { data: PlayerPoolStatusRecord[] }) {
  if (data.length === 0) {
    return (
      <AdminPanel
        title="Player Pool Readiness"
        tooltip="Verifies player ingestion succeeded. Green if >50 golfers available."
      >
        <div className="text-center py-6 text-gray-500">No player pools available</div>
      </AdminPanel>
    );
  }

  return (
    <AdminPanel
      title="Player Pool Readiness"
      tooltip="Verifies player ingestion succeeded. Green if >50 golfers available."
    >
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="px-4 py-3 text-left font-semibold text-gray-900">Event</th>
              <th className="px-4 py-3 text-right font-semibold text-gray-900">Entry Fee</th>
              <th className="px-4 py-3 text-right font-semibold text-gray-900">Golfers</th>
              <th className="px-4 py-3 text-center font-semibold text-gray-900">Status</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row, idx) => (
              <tr key={`${row.provider_event_id}-${row.entry_fee_cents}-${idx}`} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-3 text-gray-900 font-mono">{row.provider_event_id}</td>
                <td className="px-4 py-3 text-right text-gray-900">{formatCurrency(row.entry_fee_cents)}</td>
                <td className="px-4 py-3 text-right font-semibold text-gray-900">{row.golfers}</td>
                <td className="px-4 py-3 text-center">
                  <StatusBadge isHealthy={row.golfers > 50} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminPanel>
  );
}

function DuplicatePanel({ data }: { data: DuplicateContestRecord[] }) {
  if (data.length === 0) {
    return (
      <AdminPanel
        title="Duplicate Contest Detection"
        tooltip="Detects when an event has multiple contests for the same entry fee tier."
      >
        <div className="text-center py-4 text-green-700 bg-green-50 rounded">
          ✓ No duplicate contests detected
        </div>
      </AdminPanel>
    );
  }

  return (
    <AdminPanel
      title="Duplicate Contest Detection"
      tooltip="Detects when an event has multiple contests for the same entry fee tier."
      alert={{
        type: 'error',
        message: `DUPLICATE PLATFORM CONTESTS DETECTED (${data.length} tier(s) affected)`
      }}
    >
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="px-4 py-3 text-left font-semibold text-gray-900">Event</th>
              <th className="px-4 py-3 text-right font-semibold text-gray-900">Entry Fee</th>
              <th className="px-4 py-3 text-right font-semibold text-gray-900">Duplicates</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row, idx) => (
              <tr key={`${row.provider_event_id}-${row.entry_fee_cents}-${idx}`} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-3 text-gray-900 font-mono">{row.provider_event_id}</td>
                <td className="px-4 py-3 text-right text-gray-900">{formatCurrency(row.entry_fee_cents)}</td>
                <td className="px-4 py-3 text-right font-semibold text-red-900">{row.duplicates}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminPanel>
  );
}

function TimelinePanel({ data }: { data: TournamentTimelineRecord[] }) {
  if (data.length === 0) {
    return (
      <AdminPanel
        title="Tournament Timeline"
        tooltip="Verifies contest lifecycle timing is correct."
      >
        <div className="text-center py-6 text-gray-500">No scheduled contests</div>
      </AdminPanel>
    );
  }

  return (
    <AdminPanel
      title="Tournament Timeline"
      tooltip="Verifies contest lifecycle timing is correct."
    >
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="px-4 py-3 text-left font-semibold text-gray-900">Contest</th>
              <th className="px-4 py-3 text-right font-semibold text-gray-900">Fee</th>
              <th className="px-4 py-3 text-right font-semibold text-gray-900">Capacity</th>
              <th className="px-4 py-3 text-center font-semibold text-gray-900">Lock Time</th>
              <th className="px-4 py-3 text-center font-semibold text-gray-900">Start Time</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row, idx) => (
              <tr key={`${row.contest_name}-${idx}`} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-3 text-gray-900">{row.contest_name}</td>
                <td className="px-4 py-3 text-right text-gray-900">{formatCurrency(row.entry_fee_cents)}</td>
                <td className="px-4 py-3 text-right text-gray-900">{row.max_entries}</td>
                <td className="px-4 py-3 text-center text-xs text-gray-600">{formatTimestamp(row.lock_time)}</td>
                <td className="px-4 py-3 text-center text-xs text-gray-600">{formatTimestamp(row.tournament_start_time)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminPanel>
  );
}

export function ContestIntegrityPage() {
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['contest-integrity'],
    queryFn: getContestIntegrity,
    refetchInterval: 10000
  });

  useEffect(() => {
    if (data) {
      setLastUpdated(new Date().toLocaleString());
    }
  }, [data]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Contest Integrity</h1>
          <p className="mt-1 text-sm text-gray-600">Operational diagnostics for contest health</p>
        </div>
        <RefreshIndicator lastUpdated={lastUpdated} refreshInterval={10000} />
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="rounded-lg bg-blue-50 border border-blue-200 p-4">
          <p className="text-blue-700">Loading contest integrity data...</p>
        </div>
      )}

      {/* Panels */}
      {data && (
        <div className="space-y-4">
          <TierIntegrityPanel data={data.tier_integrity} />
          <CapacityPanel data={data.capacity_summary} />
          <PlayerPoolPanel data={data.player_pool_status} />
          <DuplicatePanel data={data.duplicate_contests} />
          <TimelinePanel data={data.tournament_timeline} />
        </div>
      )}

      {/* Footer info */}
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
        <p className="text-sm text-gray-600">
          <strong>Tip:</strong> This page refreshes every 10 seconds. Use these diagnostics to verify contest setup during tournament initialization.
        </p>
      </div>
    </div>
  );
}
