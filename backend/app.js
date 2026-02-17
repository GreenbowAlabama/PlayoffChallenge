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
const customContestRoutes = require('./routes/customContest.routes');
const customContestTemplatesRoutes = require('./routes/customContestTemplates.routes');
const contestsRoutes = require('./routes/contests.routes');
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
app.use('/api/admin/auth', adminAuthRoutes);
app.use('/api/admin', requireAdmin);
app.use('/api/admin/diagnostics', adminDiagnosticsRoutes);
app.use('/api/admin/runbooks', adminRunbooksRoutes);
app.use('/api/admin/trends', adminTrendsRoutes);
app.use('/api/admin/contests', adminContestsRoutes);
app.use('/api/admin/custom-contests/templates', customContestTemplatesRoutes);
app.use('/api/custom-contests', customContestRoutes);
app.use('/api/contests', contestsRoutes);

module.exports = { app };
