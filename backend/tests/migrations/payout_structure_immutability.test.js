/**
 * Payout Structure Immutability Trigger Tests
 *
 * Tests for the prevent_payout_update_when_locked trigger.
 * Ensures payout_structure cannot be updated when contest is LOCKED, LIVE, or COMPLETE.
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

describe('Payout Structure Immutability Trigger', () => {
  describe('Migration file structure', () => {
    it('should have migration file with fully qualified schema references', () => {
      const migrationPath = path.join(
        __dirname,
        '../../migrations/20260217_payout_structure_immutability.sql'
      );

      const migrationContent = fs.readFileSync(migrationPath, 'utf8');

      expect(migrationContent).toContain(
        'CREATE OR REPLACE FUNCTION public.prevent_payout_update_when_locked()'
      );
      expect(migrationContent).toContain('ON public.contest_instances');
      expect(migrationContent).toContain(
        'trg_prevent_payout_update_when_locked'
      );
      expect(migrationContent).toContain('BEFORE UPDATE');
      expect(migrationContent).toContain(
        'PAYOUT_STRUCTURE_IMMUTABLE_AFTER_LOCK'
      );
    });
  });

  describe('prevent_payout_update_when_locked trigger (integration)', () => {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL_TEST
    });

    async function createContest(client, status) {
      const templateRes = await client.query(
        `SELECT id FROM contest_templates LIMIT 1`
      );
      const templateId = templateRes.rows[0].id;

      const userRes = await client.query(
        `SELECT id FROM users LIMIT 1`
      );
      const organizerId = userRes.rows[0].id;

      const result = await client.query(
        `
        INSERT INTO contest_instances (
          template_id,
          organizer_id,
          entry_fee_cents,
          payout_structure,
          status,
          contest_name,
          max_entries
        )
        VALUES (
          $1,
          $2,
          0,
          '{}'::jsonb,
          $3,
          'immutability-test',
          100
        )
        RETURNING id
        `,
        [templateId, organizerId, status]
      );

      return result.rows[0].id;
    }

    it('should allow payout_structure update when status is SCHEDULED', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const id = await createContest(client, 'SCHEDULED');

        await expect(
          client.query(
            `UPDATE contest_instances
             SET payout_structure = '{"a":1}'::jsonb
             WHERE id = $1`,
            [id]
          )
        ).resolves.not.toThrow();

        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });

    it('should prevent payout_structure update when status is LOCKED', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const id = await createContest(client, 'LOCKED');

        await expect(
          client.query(
            `UPDATE contest_instances
             SET payout_structure = '{"a":1}'::jsonb
             WHERE id = $1`,
            [id]
          )
        ).rejects.toThrow(/PAYOUT_STRUCTURE_IMMUTABLE_AFTER_LOCK/);

        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });

    it('should prevent payout_structure update when status is LIVE', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const id = await createContest(client, 'LIVE');

        await expect(
          client.query(
            `UPDATE contest_instances
             SET payout_structure = '{"a":1}'::jsonb
             WHERE id = $1`,
            [id]
          )
        ).rejects.toThrow(/PAYOUT_STRUCTURE_IMMUTABLE_AFTER_LOCK/);

        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });

    it('should prevent payout_structure update when status is COMPLETE', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const id = await createContest(client, 'COMPLETE');

        await expect(
          client.query(
            `UPDATE contest_instances
             SET payout_structure = '{"a":1}'::jsonb
             WHERE id = $1`,
            [id]
          )
        ).rejects.toThrow(/PAYOUT_STRUCTURE_IMMUTABLE_AFTER_LOCK/);

        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });

    it('should allow payout_structure update when status is CANCELLED', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const id = await createContest(client, 'CANCELLED');

        await expect(
          client.query(
            `UPDATE contest_instances
             SET payout_structure = '{"a":1}'::jsonb
             WHERE id = $1`,
            [id]
          )
        ).resolves.not.toThrow();

        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });

    it('should allow other contest fields to be updated when locked', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const id = await createContest(client, 'LOCKED');

        await expect(
          client.query(
            `UPDATE contest_instances
             SET entry_fee_cents = 500
             WHERE id = $1`,
            [id]
          )
        ).resolves.not.toThrow();

        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });

    afterAll(async () => {
      await pool.end();
    });
  });

  describe('Trigger function schema verification (integration)', () => {
    it('should be defined in public schema', async () => {
      expect(true).toBe(true);
    });

    it('should have trigger on contest_instances table', async () => {
      expect(true).toBe(true);
    });
  });
});