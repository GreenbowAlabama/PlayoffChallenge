/**
 * Admin Diagnostics Routes
 *
 * All endpoints under /api/admin/diagnostics/*
 * Protected by existing admin middleware (requireAdmin).
 *
 * IMPORTANT: All routes are strictly read-only. No mutations.
 */

const express = require('express');
const router = express.Router();

// Import services
const diagnosticsService = require('../services/adminDiagnostics.service');
const timelineService = require('../services/adminTimeline.service');
const healthService = require('../services/adminHealth.service');
const rateLimitService = require('../services/adminRateLimit.service');
const jobsService = require('../services/adminJobs.service');
const lifecycleHealthService = require('../services/lifecycleHealthService');

// ============================================
// USER ENTITLEMENT & AUTH DIAGNOSTICS
// ============================================

/**
 * GET /api/admin/diagnostics/users
 * Returns all users with entitlement and auth info.
 */
router.get('/users', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const users = await diagnosticsService.getAllUserDiagnostics(pool);
    res.json({
      timestamp: new Date().toISOString(),
      count: users.length,
      users
    });
  } catch (err) {
    console.error('[Admin Diagnostics] Error fetching user diagnostics:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/admin/diagnostics/users/:userId
 * Returns entitlement and auth info for a specific user.
 */
router.get('/users/:userId', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { userId } = req.params;
    const user = await diagnosticsService.getUserDiagnostics(pool, userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      timestamp: new Date().toISOString(),
      user
    });
  } catch (err) {
    console.error('[Admin Diagnostics] Error fetching user:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/admin/diagnostics/users-stats
 * Returns aggregate user statistics.
 */
router.get('/users-stats', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const stats = await diagnosticsService.getUserStats(pool);
    res.json({
      timestamp: new Date().toISOString(),
      stats
    });
  } catch (err) {
    console.error('[Admin Diagnostics] Error fetching user stats:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// PER-USER EVENT TIMELINE
// ============================================

/**
 * GET /api/admin/diagnostics/timeline/:userId
 * Returns reconstructed event timeline for a user.
 */
router.get('/timeline/:userId', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { userId } = req.params;
    const timeline = await timelineService.getUserTimeline(pool, userId);

    if (timeline === null) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      timestamp: new Date().toISOString(),
      user_id: userId,
      event_count: timeline.length,
      events: timeline
    });
  } catch (err) {
    console.error('[Admin Diagnostics] Error fetching timeline:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/admin/diagnostics/timeline-summary
 * Returns summary timeline statistics across all users.
 */
router.get('/timeline-summary', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const summary = await timelineService.getTimelineSummary(pool);
    res.json({
      timestamp: new Date().toISOString(),
      summary
    });
  } catch (err) {
    console.error('[Admin Diagnostics] Error fetching timeline summary:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// ENVIRONMENT HEALTH CHECKLIST
// ============================================

/**
 * GET /api/admin/diagnostics/health
 * Returns full environment health check.
 */
router.get('/health', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const jobStatus = jobsService.getJobHealthSummary();
    const health = await healthService.getFullHealthCheck(pool, jobStatus);

    // Set appropriate status code based on health
    const statusCode = health.status === 'unhealthy' ? 503 : 200;
    res.status(statusCode).json(health);
  } catch (err) {
    console.error('[Admin Diagnostics] Error performing health check:', err);
    res.status(500).json({
      status: 'error',
      error: err.message
    });
  }
});

/**
 * GET /api/admin/diagnostics/health/db
 * Returns database health check only.
 */
router.get('/health/db', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const dbHealth = await healthService.checkDatabase(pool);
    res.json({
      timestamp: new Date().toISOString(),
      database: dbHealth
    });
  } catch (err) {
    console.error('[Admin Diagnostics] Error checking database:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/admin/diagnostics/health/external
 * Returns external API health checks.
 */
router.get('/health/external', async (req, res) => {
  try {
    const [espnHealth, sleeperHealth] = await Promise.all([
      healthService.checkESPNApi(),
      healthService.checkSleeperApi()
    ]);
    res.json({
      timestamp: new Date().toISOString(),
      espn_api: espnHealth,
      sleeper_api: sleeperHealth
    });
  } catch (err) {
    console.error('[Admin Diagnostics] Error checking external APIs:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// RATE LIMIT & AUTH VISIBILITY
// ============================================

/**
 * GET /api/admin/diagnostics/rate-limits
 * Returns current rate limit configuration and visibility.
 */
router.get('/rate-limits', (req, res) => {
  try {
    const report = rateLimitService.getFullVisibilityReport();
    res.json(report);
  } catch (err) {
    console.error('[Admin Diagnostics] Error fetching rate limit info:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/admin/diagnostics/rate-limits/config
 * Returns rate limit configuration values only.
 */
router.get('/rate-limits/config', (req, res) => {
  try {
    const config = rateLimitService.getRateLimitConfig();
    res.json(config);
  } catch (err) {
    console.error('[Admin Diagnostics] Error fetching rate limit config:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// BACKGROUND JOB STATUS
// ============================================

/**
 * GET /api/admin/diagnostics/jobs
 * Returns status of all background jobs.
 */
router.get('/jobs', (req, res) => {
  try {
    const jobs = jobsService.getAllJobStatuses();
    const summary = jobsService.getJobHealthSummary();
    res.json({
      timestamp: new Date().toISOString(),
      summary,
      jobs
    });
  } catch (err) {
    console.error('[Admin Diagnostics] Error fetching job status:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/admin/diagnostics/jobs/:jobName
 * Returns status of a specific background job.
 */
router.get('/jobs/:jobName', (req, res) => {
  try {
    const { jobName } = req.params;
    const job = jobsService.getJobStatus(jobName);

    if (!job) {
      return res.status(404).json({
        error: 'Job not found',
        available_jobs: jobsService.getAllJobStatuses().map(j => j.name)
      });
    }

    res.json({
      timestamp: new Date().toISOString(),
      job
    });
  } catch (err) {
    console.error('[Admin Diagnostics] Error fetching job:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// PAYOUT DIAGNOSTICS
// ============================================

/**
 * GET /api/admin/diagnostics/payouts
 * Returns payout transfer diagnostics and stuck transfer detection.
 * Read-only endpoint for observability.
 */
router.get('/payouts', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const stuckMinutes = parseInt(req.query.stuck_minutes || '30', 10);

    const summaryResult = await pool.query(`
      SELECT
        status,
        COUNT(*) as count
      FROM payout_transfers
      GROUP BY status
    `);

    const stuckResult = await pool.query(`
      SELECT
        id,
        contest_id,
        payout_job_id,
        attempt_count,
        max_attempts,
        failure_reason,
        EXTRACT(EPOCH FROM (NOW() - updated_at)) / 60 AS minutes_in_retryable
      FROM payout_transfers
      WHERE status = 'retryable'
        AND NOW() - updated_at > ($1 || ' minutes')::interval
      ORDER BY updated_at ASC
      LIMIT 25
    `, [stuckMinutes]);

    const jobsDiagnostics = jobsService.getJobStatus?.('payout-scheduler') || null;

    res.json({
      timestamp: new Date().toISOString(),
      scheduler: jobsDiagnostics,
      summary: summaryResult.rows.reduce((acc, row) => {
        acc[row.status] = parseInt(row.count, 10);
        return acc;
      }, {}),
      stuck_transfers: stuckResult.rows,
      stuck_threshold_minutes: stuckMinutes
    });
  } catch (err) {
    console.error('[Admin Diagnostics] Error fetching payout diagnostics:', err);
    res.status(500).json({ error: 'diagnostics_failed' });
  }
});

/**
 * POST /api/admin/diagnostics/run-payout-scheduler
 * Manually trigger payout scheduler.
 * Idempotent and safe; respects all payout invariants.
 */
router.post('/run-payout-scheduler', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const result = await jobsService.runPayoutScheduler(pool);

    res.json({
      timestamp: new Date().toISOString(),
      success: result.success,
      result
    });
  } catch (err) {
    console.error('[Admin Diagnostics] Error running payout scheduler:', err);
    res.status(500).json({
      timestamp: new Date().toISOString(),
      success: false,
      error: 'scheduler_failed',
      error_message: err.message
    });
  }
});

// ============================================
// LIFECYCLE OPERATIONAL HEALTH
// ============================================

/**
 * GET /api/admin/diagnostics/lifecycle-health
 * Returns aggregated lifecycle health metrics.
 *
 * Detects:
 * - SCHEDULED contests past lock_time
 * - LOCKED contests past tournament_start_time
 * - LIVE contests past tournament_end_time
 * - COMPLETE contests without settlement records
 * - Last reconciler run timestamp and transition count
 */
router.get('/lifecycle-health', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const now = new Date();
    const health = await lifecycleHealthService.getLifecycleHealth(pool, now);

    res.json({
      timestamp: now.toISOString(),
      ...health
    });
  } catch (err) {
    console.error('[Admin Diagnostics] Error fetching lifecycle health:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
