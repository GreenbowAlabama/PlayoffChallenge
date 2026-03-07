import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  getRecentCycles,
  getSystemTemplates,
  getSystemInstances,
  getIngestionEvents,
} from '../api/discovery';

export function ViewDiscovered() {
  const [activeTab, setActiveTab] = useState<'cycles' | 'templates' | 'instances' | 'events'>('cycles');
  const [statusFilter, setStatusFilter] = useState<string>('');

  // Fetch discovery cycles
  const { data: cycles, isLoading: cyclesLoading } = useQuery({
    queryKey: ['discovery', 'cycles'],
    queryFn: () => getRecentCycles(20),
    refetchInterval: 60000, // Refresh every 60 seconds
  });

  // Fetch system templates
  const { data: templates, isLoading: templatesLoading } = useQuery({
    queryKey: ['discovery', 'templates', statusFilter],
    queryFn: () => getSystemTemplates(statusFilter || undefined),
    refetchInterval: 60000,
  });

  // Fetch system instances
  const { data: instances, isLoading: instancesLoading } = useQuery({
    queryKey: ['discovery', 'instances', statusFilter],
    queryFn: () => getSystemInstances(undefined, statusFilter || undefined),
    refetchInterval: 60000,
  });

  // Fetch ingestion events
  const { data: events, isLoading: eventsLoading } = useQuery({
    queryKey: ['discovery', 'events'],
    queryFn: () => getIngestionEvents(50),
    refetchInterval: 60000,
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Discovery Status</h1>
        <p className="mt-1 text-sm text-gray-600">
          View what the discovery worker has found and created
        </p>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-8" aria-label="Tabs">
          {[
            { id: 'cycles', label: 'Recent Cycles' },
            { id: 'templates', label: 'System Templates' },
            { id: 'instances', label: 'System Instances' },
            { id: 'events', label: 'Ingestion Events' }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === tab.id
                  ? 'border-indigo-500 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Recent Cycles Tab */}
      {activeTab === 'cycles' && (
        <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
            <h2 className="text-lg font-medium text-gray-900">Recent Discovery Cycles</h2>
            <p className="text-sm text-gray-500">Tournaments discovered and templates auto-created</p>
          </div>
          {cyclesLoading ? (
            <div className="animate-pulse space-y-4 p-4">{[1, 2, 3].map(i => (
              <div key={i} className="h-12 bg-gray-200 rounded"></div>
            ))}</div>
          ) : cycles && cycles.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-3 px-4 font-medium text-gray-600">Tournament</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-600">Provider ID</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-600">Season</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-600">Status</th>
                    <th className="text-right py-3 px-4 font-medium text-gray-600">Instances</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-600">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {cycles.map((cycle, idx) => (
                    <tr key={idx} className="border-b border-gray-100">
                      <td className="py-2 px-4 font-medium text-gray-900">{cycle.template_name}</td>
                      <td className="py-2 px-4 text-gray-600">{cycle.provider_tournament_id}</td>
                      <td className="py-2 px-4 text-gray-600">{cycle.season_year}</td>
                      <td className="py-2 px-4">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          cycle.template_status === 'SCHEDULED'
                            ? 'bg-blue-100 text-blue-800'
                            : cycle.template_status === 'COMPLETE'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-red-100 text-red-800'
                        }`}>
                          {cycle.template_status}
                        </span>
                      </td>
                      <td className="py-2 px-4 text-right text-gray-900 font-medium">
                        {cycle.instance_count}
                      </td>
                      <td className="py-2 px-4 text-gray-500">
                        {new Date(cycle.template_created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-4 text-center text-sm text-gray-500">No discovery cycles yet</div>
          )}
        </div>
      )}

      {/* System Templates Tab */}
      {activeTab === 'templates' && (
        <div className="space-y-4">
          {/* Filter */}
          <div className="flex gap-2">
            {['', 'SCHEDULED', 'COMPLETE', 'CANCELLED'].map(status => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium ${
                  statusFilter === status
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {status || 'All'}
              </button>
            ))}
          </div>

          <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
              <h2 className="text-lg font-medium text-gray-900">System-Generated Templates</h2>
              <p className="text-sm text-gray-500">Auto-created by discovery worker from ESPN data</p>
            </div>
            {templatesLoading ? (
              <div className="animate-pulse space-y-4 p-4">{[1, 2, 3].map(i => (
                <div key={i} className="h-12 bg-gray-200 rounded"></div>
              ))}</div>
            ) : templates && templates.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-3 px-4 font-medium text-gray-600">Name</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-600">Sport</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-600">Type</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-600">Status</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-600">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {templates.map((template, idx) => (
                      <tr key={idx} className="border-b border-gray-100">
                        <td className="py-2 px-4 font-medium text-gray-900">{template.name}</td>
                        <td className="py-2 px-4 text-gray-600">{template.sport}</td>
                        <td className="py-2 px-4 text-gray-600">{template.template_type}</td>
                        <td className="py-2 px-4">
                          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            template.status === 'SCHEDULED'
                              ? 'bg-blue-100 text-blue-800'
                              : template.status === 'COMPLETE'
                              ? 'bg-green-100 text-green-800'
                              : 'bg-red-100 text-red-800'
                          }`}>
                            {template.status}
                          </span>
                        </td>
                        <td className="py-2 px-4 text-gray-500">
                          {new Date(template.created_at).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-4 text-center text-sm text-gray-500">No system templates found</div>
            )}
          </div>
        </div>
      )}

      {/* System Instances Tab */}
      {activeTab === 'instances' && (
        <div className="space-y-4">
          {/* Filter */}
          <div className="flex gap-2 flex-wrap">
            {['', 'SCHEDULED', 'LOCKED', 'LIVE', 'COMPLETE', 'CANCELLED'].map(status => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium ${
                  statusFilter === status
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {status || 'All'}
              </button>
            ))}
          </div>

          <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
              <h2 className="text-lg font-medium text-gray-900">System-Generated Instances</h2>
              <p className="text-sm text-gray-500">Auto-created contests from discovered tournaments</p>
            </div>
            {instancesLoading ? (
              <div className="animate-pulse space-y-4 p-4">{[1, 2, 3].map(i => (
                <div key={i} className="h-12 bg-gray-200 rounded"></div>
              ))}</div>
            ) : instances && instances.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-3 px-4 font-medium text-gray-600">Contest Name</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-600">Template</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-600">Status</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-600">Entries</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-600">Lock Time</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-600">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {instances.map((instance, idx) => (
                      <tr key={idx} className="border-b border-gray-100">
                        <td className="py-2 px-4 font-medium text-gray-900">{instance.contest_name}</td>
                        <td className="py-2 px-4 text-gray-600">{instance.template_name}</td>
                        <td className="py-2 px-4">
                          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            instance.status === 'SCHEDULED'
                              ? 'bg-blue-100 text-blue-800'
                              : instance.status === 'LOCKED'
                              ? 'bg-yellow-100 text-yellow-800'
                              : instance.status === 'LIVE'
                              ? 'bg-green-100 text-green-800'
                              : 'bg-gray-100 text-gray-800'
                          }`}>
                            {instance.status}
                          </span>
                        </td>
                        <td className="py-2 px-4 text-gray-600">
                          {instance.current_entries}/{instance.max_entries}
                        </td>
                        <td className="py-2 px-4 text-gray-500">
                          {instance.lock_time ? new Date(instance.lock_time).toLocaleString() : '—'}
                        </td>
                        <td className="py-2 px-4 text-gray-500">
                          {new Date(instance.created_at).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-4 text-center text-sm text-gray-500">No system instances found</div>
            )}
          </div>
        </div>
      )}

      {/* Ingestion Events Tab */}
      {activeTab === 'events' && (
        <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
            <h2 className="text-lg font-medium text-gray-900">Recent Ingestion Events</h2>
            <p className="text-sm text-gray-500">Data fetched from ESPN and Sleeper</p>
          </div>
          {eventsLoading ? (
            <div className="animate-pulse space-y-4 p-4">{[1, 2, 3].map(i => (
              <div key={i} className="h-12 bg-gray-200 rounded"></div>
            ))}</div>
          ) : events && events.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-3 px-4 font-medium text-gray-600">Event Type</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-600">Provider</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-600">Contest</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-600">Status</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-600">Received</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((event, idx) => (
                    <tr key={idx} className="border-b border-gray-100">
                      <td className="py-2 px-4 font-medium text-gray-900">{event.event_type}</td>
                      <td className="py-2 px-4 text-gray-600">{event.provider}</td>
                      <td className="py-2 px-4 text-gray-600">{event.contest_name || '—'}</td>
                      <td className="py-2 px-4">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          event.validation_status === 'VALID'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-red-100 text-red-800'
                        }`}>
                          {event.validation_status}
                        </span>
                      </td>
                      <td className="py-2 px-4 text-gray-500">
                        {new Date(event.received_at).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-4 text-center text-sm text-gray-500">No ingestion events yet</div>
          )}
        </div>
      )}
    </div>
  );
}
