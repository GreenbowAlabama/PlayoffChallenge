/**
 * Admin Contests Ops Route Tests
 *
 * Integration tests for GET /api/admin/contests/:id/ops endpoint
 * - Authentication/authorization
 * - Valid contest snapshot
 * - 404 for missing contest
 * - Response shape validation
 */

const { describe, it, expect, beforeAll, afterAll, beforeEach } = require('@jest/globals');
const request = require('supertest');
const { Pool } = require('pg');

let app;
let pool;
let adminToken;

describe('GET /api/admin/contests/:id/ops', () => {
  beforeAll(async () => {
    // Create app and pool
    app = require('../../app');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL_TEST,
      ssl: false,
    });

    // Generate admin token for testing
    const jwt = require('jsonwebtoken');
    adminToken = jwt.sign(
      { userId: 'test-admin', role: 'admin' },
      process.env.ADMIN_JWT_SECRET || 'test-admin-jwt-secret',
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  it('should return 401 when not authenticated', async () => {
    const response = await request(app).get(
      '/api/admin/contests/00000000-0000-0000-0000-000000000000/ops',
    );

    expect(response.status).toBe(401);
  });

  it('should return 404 for non-existent contest', async () => {
    const response = await request(app)
      .get('/api/admin/contests/00000000-0000-0000-0000-000000000000/ops')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(404);
    expect(response.body).toHaveProperty('error');
  });

  it('should return 200 with valid contest snapshot', async () => {
    const client = await pool.connect();
    let contestId;

    try {
      await client.query('BEGIN');

      // Create template
      const templateRes = await client.query(
        `INSERT INTO contest_templates (
          name, sport, template_type, scoring_strategy_key, lock_strategy_key,
          settlement_strategy_key, default_entry_fee_cents, allowed_entry_fee_min_cents,
          allowed_entry_fee_max_cents, allowed_payout_structures
        ) VALUES (
          'Route Test Template', 'PGA', 'standard', 'pga-scoring', 'default-lock',
          'pga-settlement', 5000, 0, 50000, '[]'::jsonb
        ) RETURNING id`,
      );
      const templateId = templateRes.rows[0].id;

      // Create contest
      const contestRes = await client.query(
        `INSERT INTO contest_instances (
          template_id, organizer_id, entry_fee_cents, payout_structure,
          status, contest_name, max_entries
        ) VALUES (
          $1, '11111111-1111-1111-1111-111111111111', 5000, '[]'::jsonb,
          'SCHEDULED', 'Route Test Contest', 20
        ) RETURNING id`,
        [templateId],
      );
      contestId = contestRes.rows[0].id;

      await client.query('COMMIT');
    } finally {
      client.release();
    }

    // Make request
    const response = await request(app)
      .get(`/api/admin/contests/${contestId}/ops`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('server_time');
    expect(response.body).toHaveProperty('contest');
    expect(response.body).toHaveProperty('template');
    expect(response.body).toHaveProperty('template_contests');
    expect(response.body).toHaveProperty('contest_tournament_config');
    expect(response.body).toHaveProperty('tournament_configs');
    expect(response.body).toHaveProperty('lifecycle');
    expect(response.body).toHaveProperty('snapshot_health');
  });

  it('should return valid contest data in snapshot', async () => {
    const client = await pool.connect();
    let contestId;

    try {
      await client.query('BEGIN');

      const templateRes = await client.query(
        `INSERT INTO contest_templates (
          name, sport, template_type, scoring_strategy_key, lock_strategy_key,
          settlement_strategy_key, default_entry_fee_cents, allowed_entry_fee_min_cents,
          allowed_entry_fee_max_cents, allowed_payout_structures
        ) VALUES (
          'Route Test Template 2', 'NFL', 'standard', 'nfl-scoring', 'default-lock',
          'nfl-settlement', 10000, 0, 100000, '[]'::jsonb
        ) RETURNING id`,
      );
      const templateId = templateRes.rows[0].id;

      const contestRes = await client.query(
        `INSERT INTO contest_instances (
          template_id, organizer_id, entry_fee_cents, payout_structure,
          status, contest_name, max_entries, current_entries, is_system_generated
        ) VALUES (
          $1, '11111111-1111-1111-1111-111111111111', 10000, '[]'::jsonb,
          'LOCKED', 'Route Test Contest 2', 50, 25, true
        ) RETURNING id`,
        [templateId],
      );
      contestId = contestRes.rows[0].id;

      await client.query('COMMIT');
    } finally {
      client.release();
    }

    const response = await request(app)
      .get(`/api/admin/contests/${contestId}/ops`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);

    const { contest } = response.body;
    expect(contest.id).toBe(contestId);
    expect(contest.contest_name).toBe('Route Test Contest 2');
    expect(contest.status).toBe('LOCKED');
    expect(contest.entry_fee_cents).toBe(10000);
    expect(contest.current_entries).toBe(25);
    expect(contest.max_entries).toBe(50);
    expect(contest.is_system_generated).toBe(true);
    expect(contest).toHaveProperty('updated_at');
  });

  it('should return correct snapshot health stats', async () => {
    const client = await pool.connect();
    let contestId;

    try {
      await client.query('BEGIN');

      const templateRes = await client.query(
        `INSERT INTO contest_templates (
          name, sport, template_type, scoring_strategy_key, lock_strategy_key,
          settlement_strategy_key, default_entry_fee_cents, allowed_entry_fee_min_cents,
          allowed_entry_fee_max_cents, allowed_payout_structures
        ) VALUES (
          'Route Test Template 3', 'PGA', 'standard', 'pga-scoring', 'default-lock',
          'pga-settlement', 5000, 0, 50000, '[]'::jsonb
        ) RETURNING id`,
      );
      const templateId = templateRes.rows[0].id;

      const contestRes = await client.query(
        `INSERT INTO contest_instances (
          template_id, organizer_id, entry_fee_cents, payout_structure,
          status, contest_name, max_entries
        ) VALUES (
          $1, '11111111-1111-1111-1111-111111111111', 5000, '[]'::jsonb,
          'LIVE', 'Route Test Contest 3', 20
        ) RETURNING id`,
        [templateId],
      );
      contestId = contestRes.rows[0].id;

      // Create 3 snapshots
      for (let i = 0; i < 3; i++) {
        await client.query(
          `INSERT INTO event_data_snapshots (
            contest_instance_id, snapshot_hash, provider_event_id,
            provider_final_flag, payload
          ) VALUES ($1, $2, 'espn_event_test', false, '{}')`,
          [contestId, `hash${i}`],
        );
      }

      await client.query('COMMIT');
    } finally {
      client.release();
    }

    const response = await request(app)
      .get(`/api/admin/contests/${contestId}/ops`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);

    const { snapshot_health } = response.body;
    expect(snapshot_health.snapshot_count).toBe(3);
    expect(snapshot_health.latest_snapshot).not.toBeNull();
  });

  it('should return contest_tournament_config as object or null, not array', async () => {
    const client = await pool.connect();
    let contestId;

    try {
      await client.query('BEGIN');

      const templateRes = await client.query(
        `INSERT INTO contest_templates (
          name, sport, template_type, scoring_strategy_key, lock_strategy_key,
          settlement_strategy_key, default_entry_fee_cents, allowed_entry_fee_min_cents,
          allowed_entry_fee_max_cents, allowed_payout_structures
        ) VALUES (
          'Route Test Template 4', 'PGA', 'standard', 'pga-scoring', 'default-lock',
          'pga-settlement', 5000, 0, 50000, '[]'::jsonb
        ) RETURNING id`,
      );
      const templateId = templateRes.rows[0].id;

      const contestRes = await client.query(
        `INSERT INTO contest_instances (
          template_id, organizer_id, entry_fee_cents, payout_structure,
          status, contest_name, max_entries
        ) VALUES (
          $1, '11111111-1111-1111-1111-111111111111', 5000, '[]'::jsonb,
          'SCHEDULED', 'Route Test Contest 4', 20
        ) RETURNING id`,
        [templateId],
      );
      contestId = contestRes.rows[0].id;

      await client.query('COMMIT');
    } finally {
      client.release();
    }

    const response = await request(app)
      .get(`/api/admin/contests/${contestId}/ops`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);

    const { contest_tournament_config } = response.body;
    expect(Array.isArray(contest_tournament_config)).toBe(false);
    expect(contest_tournament_config === null || typeof contest_tournament_config === 'object').toBe(
      true,
    );
  });
});
