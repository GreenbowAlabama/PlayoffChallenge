/**
 * Golf Engine
 *
 * Config-driven tournament orchestration for stroke-play golf contests.
 * Pure service with no database writes or side effects.
 */

const { validateConfig } = require('./validateConfig');
const { selectField } = require('./selectField');
const { applyStrokePlayScoring } = require('./applyStrokePlayScoring');

module.exports = {
  validateConfig,
  selectField,
  applyStrokePlayScoring
};
