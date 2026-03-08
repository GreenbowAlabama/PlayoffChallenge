/**
 * System Invariant Monitor Page
 *
 * Dashboard for monitoring platform critical invariants
 */

import React, { useState, useEffect } from 'react';
import { InvariantCard } from '../components/InvariantCard';
import { AnomalyList } from '../components/AnomalyList';
import { systemInvariantsApi } from '../api/system-invariants';
import type {
  SystemInvariantsResponse,
  HistoryRecord,
  FinancialInvariant,
  LifecycleInvariant,
  SettlementInvariant,
  PipelineInvariant,
  LedgerInvariant
} from '../types/SystemInvariants';
import '../styles/SystemInvariantMonitor.css';

export const SystemInvariantMonitor: React.FC = () => {
  const [data, setData] = useState<SystemInvariantsResponse | null>(null);
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [expandedAnomalies, setExpandedAnomalies] = useState<Record<string, boolean>>({});
  const [historyPage, setHistoryPage] = useState(0);
  const [historyTotal, setHistoryTotal] = useState(0);

  const HISTORY_PAGE_SIZE = 20;

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await systemInvariantsApi.getCurrentStatus();
      setData(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const fetchHistory = async (page: number) => {
    try {
      const response = await systemInvariantsApi.getHistory(HISTORY_PAGE_SIZE, page * HISTORY_PAGE_SIZE);
      setHistory(response.records);
      setHistoryTotal(response.total_count);
      setHistoryPage(page);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch history');
    }
  };

  useEffect(() => {
    fetchData();
    fetchHistory(0);
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      fetchData();
    }, 10000); // Refresh every 10 seconds

    return () => clearInterval(interval);
  }, [autoRefresh]);

  const toggleAnomalyExpanded = (key: string) => {
    setExpandedAnomalies(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  const renderFinancialDetails = (financial: FinancialInvariant) => (
    <div className="financial-details">
      <div className="value-row">
        <span>Wallet Liability:</span>
        <strong>${(financial.values.wallet_liability_cents / 100).toFixed(2)}</strong>
      </div>
      <div className="value-row">
        <span>Contest Pools:</span>
        <strong>${(financial.values.contest_pools_cents / 100).toFixed(2)}</strong>
      </div>
      <div className="value-row">
        <span>Deposits:</span>
        <strong>${(financial.values.deposits_cents / 100).toFixed(2)}</strong>
      </div>
      <div className="value-row">
        <span>Withdrawals:</span>
        <strong>${(financial.values.withdrawals_cents / 100).toFixed(2)}</strong>
      </div>
      <div className="equation">
        {financial.values.wallet_liability_cents + financial.values.contest_pools_cents} = {financial.values.deposits_cents - financial.values.withdrawals_cents}
        {financial.values.difference_cents > 0 && (
          <span className="diff"> (diff: {financial.values.difference_cents} cents)</span>
        )}
      </div>
    </div>
  );

  const renderLifecycleDetails = (lifecycle: LifecycleInvariant) => (
    <div className="lifecycle-details">
      <div className="value-row">
        <span>LOCKED contests:</span>
        <strong>{lifecycle.details.total_locked_contests}</strong>
        {lifecycle.details.stuck_locked_count > 0 && (
          <span className="stuck">({lifecycle.details.stuck_locked_count} stuck)</span>
        )}
      </div>
      <div className="value-row">
        <span>LIVE contests:</span>
        <strong>{lifecycle.details.total_live_contests}</strong>
        {lifecycle.details.stuck_live_count > 0 && (
          <span className="stuck">({lifecycle.details.stuck_live_count} stuck)</span>
        )}
      </div>
    </div>
  );

  const renderSettlementDetails = (settlement: SettlementInvariant) => (
    <div className="settlement-details">
      <div className="value-row">
        <span>COMPLETE contests:</span>
        <strong>{settlement.details.total_complete_contests}</strong>
      </div>
      <div className="value-row">
        <span>Settled:</span>
        <strong>{settlement.details.total_settled_contests}</strong>
      </div>
      {settlement.details.settlement_lag_minutes > 0 && (
        <div className="value-row warning">
          <span>Max lag:</span>
          <strong>{settlement.details.settlement_lag_minutes} minutes</strong>
        </div>
      )}
    </div>
  );

  const renderPipelineDetails = (pipeline: PipelineInvariant) => (
    <div className="pipeline-details">
      <div className="worker-status">
        <div className="worker">
          <strong>Discovery Worker:</strong> {pipeline.pipeline_status.discovery_worker.status}
          {pipeline.pipeline_status.discovery_worker.last_run && (
            <small>{new Date(pipeline.pipeline_status.discovery_worker.last_run).toLocaleString()}</small>
          )}
          {pipeline.pipeline_status.discovery_worker.error_count_1h > 0 && (
            <span className="error-count">{pipeline.pipeline_status.discovery_worker.error_count_1h} errors</span>
          )}
        </div>
        <div className="worker">
          <strong>Lifecycle Reconciler:</strong> {pipeline.pipeline_status.lifecycle_reconciler.status}
          {pipeline.pipeline_status.lifecycle_reconciler.last_run && (
            <small>{new Date(pipeline.pipeline_status.lifecycle_reconciler.last_run).toLocaleString()}</small>
          )}
        </div>
        <div className="worker">
          <strong>Ingestion Worker:</strong> {pipeline.pipeline_status.ingestion_worker.status}
          {pipeline.pipeline_status.ingestion_worker.error_count_1h > 0 && (
            <span className="error-count">{pipeline.pipeline_status.ingestion_worker.error_count_1h} stuck units</span>
          )}
        </div>
      </div>
    </div>
  );

  const renderLedgerDetails = (ledger: LedgerInvariant) => (
    <div className="ledger-details">
      <div className="value-row">
        <span>Total entries:</span>
        <strong>{ledger.details.total_entries}</strong>
      </div>
      <div className="value-row">
        <span>Constraint violations:</span>
        <strong>{ledger.details.constraint_violations}</strong>
      </div>
      <div className="value-row">
        <span>Balance status:</span>
        <strong>{ledger.details.balance_status}</strong>
      </div>
    </div>
  );

  return (
    <div className="system-invariant-monitor">
      <header className="monitor-header">
        <h1>System Invariant Monitor</h1>
        <div className="header-controls">
          <button
            onClick={fetchData}
            disabled={loading}
            className="btn-refresh"
          >
            {loading ? 'Loading...' : '🔄 Refresh Now'}
          </button>
          <label className="auto-refresh-toggle">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            Auto-refresh (every 10s)
          </label>
        </div>
      </header>

      {error && (
        <div className="error-banner">
          <strong>Error:</strong> {error}
        </div>
      )}

      {data && (
        <>
          <div className="overall-status">
            <div className={`status-box ${data.overall_status.toLowerCase()}`}>
              <h2>Overall Status: {data.overall_status}</h2>
              <p>Last check: {new Date(data.last_check_timestamp).toLocaleString()}</p>
              <p>Execution time: {data.execution_time_ms}ms</p>
            </div>
          </div>

          <div className="invariants-grid">
            <div>
              <InvariantCard
                title="Financial Integrity"
                status={data.invariants.financial.status}
                executionTime={data.execution_time_ms}
                details={renderFinancialDetails(data.invariants.financial)}
                anomalyCount={data.invariants.financial.details.anomalies.length}
              />
              <AnomalyList
                title="Financial Anomalies"
                anomalies={data.invariants.financial.details.anomalies}
                isExpanded={expandedAnomalies['financial']}
                onToggle={() => toggleAnomalyExpanded('financial')}
              />
            </div>

            <div>
              <InvariantCard
                title="Lifecycle Correctness"
                status={data.invariants.lifecycle.status}
                details={renderLifecycleDetails(data.invariants.lifecycle)}
                anomalyCount={data.invariants.lifecycle.anomalies.length}
              />
              <AnomalyList
                title="Lifecycle Anomalies"
                anomalies={data.invariants.lifecycle.anomalies}
                isExpanded={expandedAnomalies['lifecycle']}
                onToggle={() => toggleAnomalyExpanded('lifecycle')}
              />
            </div>

            <div>
              <InvariantCard
                title="Settlement Integrity"
                status={data.invariants.settlement.status}
                details={renderSettlementDetails(data.invariants.settlement)}
                anomalyCount={data.invariants.settlement.anomalies.length}
              />
              <AnomalyList
                title="Settlement Anomalies"
                anomalies={data.invariants.settlement.anomalies}
                isExpanded={expandedAnomalies['settlement']}
                onToggle={() => toggleAnomalyExpanded('settlement')}
              />
            </div>

            <div>
              <InvariantCard
                title="Pipeline Health"
                status={data.invariants.pipeline.status}
                details={renderPipelineDetails(data.invariants.pipeline)}
                anomalyCount={data.invariants.pipeline.anomalies.length}
              />
              <AnomalyList
                title="Pipeline Anomalies"
                anomalies={data.invariants.pipeline.anomalies}
                isExpanded={expandedAnomalies['pipeline']}
                onToggle={() => toggleAnomalyExpanded('pipeline')}
              />
            </div>

            <div>
              <InvariantCard
                title="Ledger Integrity"
                status={data.invariants.ledger.status}
                details={renderLedgerDetails(data.invariants.ledger)}
                anomalyCount={data.invariants.ledger.anomalies.length}
              />
              <AnomalyList
                title="Ledger Anomalies"
                anomalies={data.invariants.ledger.anomalies}
                isExpanded={expandedAnomalies['ledger']}
                onToggle={() => toggleAnomalyExpanded('ledger')}
              />
            </div>
          </div>

          <section className="history-section">
            <h2>Check History</h2>
            <div className="history-table">
              <table>
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Overall Status</th>
                    <th>Financial</th>
                    <th>Lifecycle</th>
                    <th>Settlement</th>
                    <th>Pipeline</th>
                    <th>Ledger</th>
                    <th>Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((record) => (
                    <tr key={record.id}>
                      <td>{new Date(record.created_at).toLocaleString()}</td>
                      <td className={`status-${record.overall_status.toLowerCase()}`}>
                        {record.overall_status}
                      </td>
                      <td>{record.summary.financial_status}</td>
                      <td>{record.summary.lifecycle_status}</td>
                      <td>{record.summary.settlement_status}</td>
                      <td>{record.summary.pipeline_status}</td>
                      <td>{record.summary.ledger_status}</td>
                      <td>{record.execution_time_ms}ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {historyTotal > HISTORY_PAGE_SIZE && (
              <div className="pagination">
                <button
                  onClick={() => fetchHistory(historyPage - 1)}
                  disabled={historyPage === 0}
                >
                  ← Previous
                </button>
                <span>
                  Page {historyPage + 1} of {Math.ceil(historyTotal / HISTORY_PAGE_SIZE)}
                </span>
                <button
                  onClick={() => fetchHistory(historyPage + 1)}
                  disabled={(historyPage + 1) * HISTORY_PAGE_SIZE >= historyTotal}
                >
                  Next →
                </button>
              </div>
            )}
          </section>
        </>
      )}

      {loading && !data && (
        <div className="loading">
          <p>Loading invariant check...</p>
        </div>
      )}
    </div>
  );
};
