const express = require('express');
const pg = require('pg');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

// Route modules
const adminAuthRoutes = require('./routes/adminAuth');
const adminDiagnosticsRoutes = require('./routes/admin.diagnostics.routes');
const adminRunbooksRoutes = require('./routes/admin.runbooks.routes');
const adminTrendsRoutes = require('./routes/admin.trends.routes');
const adminContestsRoutes = require('./routes/admin.contests.routes');
const adminTournamentsRoutes = require('./routes/admin.tournaments.routes');
const customContestRoutes = require('./routes/customContest.routes');
const customContestTemplatesRoutes = require('./routes/customContestTemplates.routes');
const contestsRoutes = require('./routes/contests.routes');
const walletRoutes = require('./routes/wallet.routes');
const webhooksRoutes = require('./routes/webhooks');
const paymentsRoutes = require('./routes/payments');
const requireAdmin = require('./middleware/adminAuth');

// Configure PostgreSQL decimal parsing
pg.types.setTypeParser(1700, (v) => v === null ? null : parseFloat(v));

// Create Express app
const app = express();
app.set('trust proxy', 1);

// Middleware: CORS
app.use(cors());

// Middleware: Webhook routes must be mounted BEFORE express.json()
// so that the raw request body is available for Stripe signature verification
app.use('/api/webhooks', webhooksRoutes);

// Middleware: Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting configuration
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
});

// Middleware: Apply rate limiting
app.use('/api/', apiLimiter);

// Mount route modules
app.use('/api/payments', paymentsRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/admin/auth', adminAuthRoutes);
app.use('/api/admin', requireAdmin);
app.use('/api/admin/diagnostics', adminDiagnosticsRoutes);
app.use('/api/admin/runbooks', adminRunbooksRoutes);
app.use('/api/admin/trends', adminTrendsRoutes);
app.use('/api/admin/contests', adminContestsRoutes);
app.use('/api/admin/tournaments', adminTournamentsRoutes);
app.use('/api/admin/custom-contests/templates', customContestTemplatesRoutes);
app.use('/api/custom-contests', customContestRoutes);
app.use('/api/contests', contestsRoutes);

// Global error handler (must be LAST middleware)
// Converts unhandled errors into deterministic 500 responses
app.use((err, req, res, next) => {
  console.error('[Express Error Handler]', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method
  });

  // Prevent double response
  if (res.headersSent) {
    return next(err);
  }

  res.status(err.status || 500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'test' ? err.message : 'Unexpected error'
  });
});

module.exports = { app };
