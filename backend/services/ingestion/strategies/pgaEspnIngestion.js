/**
 * PGA ESPN Ingestion Adapter
 *
 * Ingestion implementation for PGA Tour (Masters) via ESPN API.
 * Implements snapshot binding per PGA v1 Section 4.1.
 */

'use strict';

const crypto = require('crypto');

/**
 * Canonicalize JSON for deterministic hashing.
 * Recursively sorts all object keys alphabetically, preserves array order.
 * (Reuse from settlementStrategy or implement minimally here)
 *
 * @param {*} obj - Object to canonicalize
 * @returns {*} Canonicalized object
 */
function canonicalizeJson(obj) {
  if (obj === null || obj === undefined) {
    return obj;
  }
  if (typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(item => canonicalizeJson(item));
  }
  const keys = Object.keys(obj).sort();
  const canonical = {};
  keys.forEach(key => {
    canonical[key] = canonicalizeJson(obj[key]);
  });
  return canonical;
}

/**
 * Validate PGA template configuration
 * Called by contestTemplateService before template persistence.
 * @param {Object} input - Template input
 * @throws {Error} If validation fails
 */
function validateConfig(input) {
  // eventId validation
  if (!input.eventId || typeof input.eventId !== 'string' || input.eventId.trim() === '') {
    throw new Error('INVALID_PGA_TEMPLATE: eventId is required for pga_espn and must be a non-empty string');
  }

  // roster_size validation
  if (!Number.isInteger(input.roster_size) || input.roster_size < 1) {
    throw new Error('INVALID_PGA_TEMPLATE: roster_size is required for pga_espn and must be an integer >= 1');
  }

  // cut_after_round validation
  if (!Number.isInteger(input.cut_after_round) || input.cut_after_round < 1) {
    throw new Error('INVALID_PGA_TEMPLATE: cut_after_round is required for pga_espn and must be an integer >= 1');
  }

  // drop_lowest validation
  if (typeof input.drop_lowest !== 'boolean') {
    throw new Error('INVALID_PGA_TEMPLATE: drop_lowest is required for pga_espn and must be a boolean');
  }

  // payout_structure validation (using allowed_payout_structures field)
  if (!Array.isArray(input.allowed_payout_structures) || input.allowed_payout_structures.length === 0) {
    throw new Error('INVALID_PGA_TEMPLATE: payout_structure is required for pga_espn and must be a non-empty array');
  }
}

async function getWorkUnits(_ctx) {
  throw new Error("Ingestion adapter 'pga_espn' is not yet implemented");
}

function computeIngestionKey(_contestInstanceId, _unit) {
  throw new Error("Ingestion adapter 'pga_espn' is not yet implemented");
}

/**
 * Ingest one work unit: create immutable snapshot of provider data for settlement binding.
 *
 * Per PGA v1 Section 4.1:
 * - Canonicalize provider_data_json
 * - Compute SHA-256 hash (snapshot_hash)
 * - Insert into ingestion_events with payload_hash populated
 * - Return normalized scores for upsertScores
 *
 * @param {Object} ctx - Ingestion context { contestInstanceId, dbClient, ... }
 * @param {Object} unit - Work unit (structure varies by adapter)
 * @returns {Promise<Array>} Normalized score objects for upsertScores
 */
async function ingestWorkUnit(ctx, unit) {
  const { contestInstanceId, dbClient } = ctx;

  if (!unit || !unit.providerData) {
    throw new Error('ingestWorkUnit: unit.providerData is required (ESPN tournament data)');
  }

  const providerData = unit.providerData;

  // Canonicalize and hash for deterministic snapshot binding
  const canonicalized = canonicalizeJson(providerData);
  const payloadHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(canonicalized))
    .digest('hex');

  // Create immutable ingestion_events snapshot (PGA v1 Section 4.1)
  const result = await dbClient.query(`
    INSERT INTO ingestion_events (
      id,
      contest_instance_id,
      provider,
      event_type,
      provider_data_json,
      payload_hash,
      validation_status,
      validated_at
    ) VALUES (
      gen_random_uuid(),
      $1,
      $2,
      $3,
      $4,
      $5,
      $6,
      NOW()
    )
    RETURNING id, payload_hash
  `, [
    contestInstanceId,
    'pga_espn',
    'tournament_data',
    JSON.stringify(providerData),
    payloadHash,
    'VALID'
  ]);

  const ingestionEvent = result.rows[0];
  console.log(`[pgaEspnIngestion] Created snapshot ${ingestionEvent.id} with hash ${ingestionEvent.payload_hash}`);

  // Return placeholder scores (actual scoring implementation out of scope for Batch 2)
  // In production, this would parse providerData and normalize to { user_id, player_id, points, ... }
  return [];
}

async function upsertScores(_ctx, _normalizedScores) {
  throw new Error("Ingestion adapter 'pga_espn' is not yet implemented");
}

module.exports = {
  validateConfig,
  getWorkUnits,
  computeIngestionKey,
  ingestWorkUnit,
  upsertScores
};
