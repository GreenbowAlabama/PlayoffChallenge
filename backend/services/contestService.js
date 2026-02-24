/**
 * DEPRECATED — DO NOT USE
 *
 * This module was the original contest service (v0). It references tables
 * (`contests`, `contest_entries`) that do not exist in the current schema.
 *
 * All contest functionality is now in customContestService.js, which uses
 * the contest_templates / contest_instances schema.
 *
 * This file throws on import to prevent accidental usage.
 * If you need contest functionality, use:
 *
 *   const customContestService = require('./customContestService');
 *
 * Deprecated: 2026-02-05
 */

throw new Error(
  'contestService.js is deprecated and must not be imported. ' +
  'Use customContestService.js instead. ' +
  'This module referenced non-existent tables (contests, contest_entries) ' +
  'and has been replaced by the contest_templates / contest_instances schema.'
);
