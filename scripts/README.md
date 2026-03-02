# Scripts Directory

Utility and governance scripts for managing the Playoff Challenge application.

## Priority: System Mode Bootstrap

### launch-claude.sh

**Purpose:** Initialize Claude in SYSTEM MODE with full governance verification.

**Usage:**
```bash
./scripts/launch-claude.sh
```

**What it does:**

1. **Verifies Governance Infrastructure**
   - Checks all 5 governance documents exist
   - Validates golden contracts (openapi.yaml, schema.snapshot.sql)
   - Confirms CLAUDE.md master instructions present

2. **Reports Frozen Infrastructure**
   - Financial invariants status
   - Lifecycle engine status (all 4 transitions)
   - Mutation surface seal status
   - OpenAPI contract status
   - Database schema authority

3. **Reports Backend Test Infrastructure**
   - Core invariant tests (lifecycle, settlement, admin)
   - Governance service tests
   - Financial integrity tests
   - Contract freeze tests
   - Fast feedback tier availability

4. **Reports iOS Architecture**
   - DTO→Domain isolation status
   - ViewModel service boundary status
   - Design system enforcement (radius, spacing tokens)

5. **Launches Claude in SYSTEM MODE**
   - Hard gate: Must read governance files first
   - Bootstrap includes fast feedback tier commands
   - Operating rules enforced

**When to use:** Every Claude session touching core infrastructure.

---

## Feature & Testing Utilities

Utility scripts for development, testing, and data management.

### Database Connection

Scripts use the `DATABASE_URL` environment variable. Get this from your infrastructure:

1. Locate your database credentials
2. Set environment variable locally:
```bash
export DATABASE_URL="postgresql://..."
```

Or create a `.env` file in the project root (DO NOT commit this):
```
DATABASE_URL=postgresql://...
```

---

## Legacy Scripts (Pre-Governance Era)

The following scripts pre-date the governance layer. They remain operational but may require updates for new features that depend on frozen invariants.

### load-test-picks.js

Automatically creates data for test bot accounts.

**Status:** Operational (legacy, may require updates)

**Usage:**
```bash
node scripts/load-test-picks.js <param> [--options]
```

**Options:**
- `--delete-existing` - Clear existing test data before creating new
- `--help` - Show help message

**What it does:**
1. Finds test accounts (infrastructure-specific)
2. Fetches available data
3. Optionally deletes existing data
4. Creates new test entries
5. Shows summary

**Note:** This script pre-dates governance layer constraints. If it interacts with financial invariants (entry fees, wallet operations), it may require updates to respect atomic operation guarantees.

---

### reset-week.js

Resets operational state and optionally clears future data.

**Status:** Operational (legacy, may require updates)

**Usage:**
```bash
node scripts/reset-week.js <param> [--options]
```

**Options:**
- `--activate` - Enable new state
- `--delete-future` - Clear future data
- `--help` - Show help message

**Environment Variables:**
- `DATABASE_URL` - PostgreSQL connection string (required)
- `NODE_ENV` - Set to 'production' for SSL connection (optional)

**What it does:**
1. Shows current state
2. Optionally deletes future data
3. Updates operational state
4. Verifies changes and displays new state

**Safety:**
- Shows before/after state for verification
- Requires explicit flag for destructive operations
- Uses transactions for safe operations

**Note:** This script pre-dates governance layer. If used with frozen contest states (SCHEDULED/LOCKED/LIVE/COMPLETE), it may require updates to respect state machine constraints.

---

## Common Use Cases

### Run Tests Before Development

```bash
cd backend && \
ADMIN_JWT_SECRET=${ADMIN_JWT_SECRET:-test-admin-jwt-secret} \
TEST_DB_ALLOW_DBNAME=${TEST_DB_ALLOW_DBNAME:-railway} \
npm test -- --forceExit
```

### Validate with Fast Feedback Tiers

```bash
# Tier 1: Governance surface
cd backend && npm test -- tests/governance/ --runInBand --forceExit

# Tier 2: Frozen invariants
cd backend && npm test -- tests/e2e/ --runInBand --forceExit

# Tier 3: Full suite
cd backend && npm test -- --forceExit
```

### Launch System Mode

```bash
./scripts/launch-claude.sh
```

---

## Adding New Scripts

When creating new utility scripts:

1. Place them in the `scripts/` directory
2. Add a shebang: `#!/usr/bin/env node`
3. Make them executable: `chmod +x scripts/your-script.js`
4. Include `--help` documentation
5. Show before/after state for verification
6. Update this README with usage instructions
7. Handle errors gracefully with try/catch
8. Always release database connections in `finally` blocks

### Governance Alignment

If adding scripts that interact with frozen layers:
- **Contest status**: Respect frozen state machine (SCHEDULED→LOCKED→LIVE→COMPLETE)
- **Wallet operations**: Ensure atomicity (no partial operations)
- **Entry operations**: Use API endpoints (not direct DB insert)
- **Settlement**: Never bypass snapshot binding
- **Cascades**: Respect provider → instance ordering

If a script bypasses these invariants, it must be:
1. Clearly marked as admin/emergency-only
2. Documented in this README with warnings
3. Reviewed by governance layer owner

Otherwise, scripts can proceed without governance approval.

---

## Best Practices

1. **Always verify first** - Run a verification query before destructive operations
2. **Test locally** - Use a local database copy for testing scripts
3. **Check current state** - Review the output before confirming changes
4. **Use flags carefully** - Destructive operations should require explicit flags
5. **Log changes** - Show before/after state for auditing

---

**Last Updated:** March 2, 2026
**Governance Status:** launch-claude.sh fully governance-aligned; legacy scripts operational but may need updates
**Test Status:** Fast feedback tiers available and documented
**Critical Infrastructure:** ✅ System mode bootstrap operational
