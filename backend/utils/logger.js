'use strict';

/**
 * Platform Logger
 *
 * Minimal abstraction wrapping console to enable future replacement
 * with a structured logger (Winston, Pino, etc.) without touching codebase.
 *
 * All ingestion and service code uses this module, not console directly.
 */

function format(level, args) {
  const timestamp = new Date().toISOString();
  return [`[${timestamp}] [${level}]`, ...args];
}

module.exports = {
  info: (...args) => console.info(...format('INFO', args)),
  warn: (...args) => console.warn(...format('WARN', args)),
  error: (...args) => console.error(...format('ERROR', args)),
  debug: (...args) => console.debug(...format('DEBUG', args)),
};
