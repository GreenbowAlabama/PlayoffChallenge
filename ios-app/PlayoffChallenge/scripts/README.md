# Scripts Directory

Utility scripts for managing the Playoff Challenge application.

## Available Scripts

### load-test-picks.js

Automatically creates picks for test bot accounts (users with @test.com email addresses). Randomly selects players for each position to create complete rosters.

**Usage:**
```bash
node scripts/load-test-picks.js <week_number> [--delete-existing]
```

**Examples:**

Load picks for week 12 for all test accounts:
```bash
export DATABASE_URL="your-postgresql-connection-string"
node scripts/load-test-picks.js 12
```

Delete existing picks and create new ones:
```bash
node scripts/load-test-picks.js 12 --delete-existing
```

**Options:**
- `--delete-existing` - Delete existing picks for test accounts before creating new ones
- `--help` - Show help message

**What it does:**
1. Finds all users with email addresses ending in `@test.com`
2. Fetches available players for each position (QB, RB, WR, TE, FLEX, K, DEF)
3. Optionally deletes existing picks for test accounts for the specified week
4. Randomly assigns players to each position for each test account
5. Creates complete rosters with proper position counts (1 QB, 2 RB, 2 WR, 1 TE, 1 FLEX, 1 K, 1 DEF)
6. Shows summary of picks created per account

**Safety:**
- Only affects users with `@test.com` email addresses
- Uses UPSERT logic to avoid duplicate picks
- Shows before/after summary

---

### reset-week.js

Resets the current playoff week and optionally clears picks/scores for future weeks.

**Usage:**
```bash
node scripts/reset-week.js <week_number> [--activate] [--delete-future]
```

**Examples:**

Reset to week 12, activate picking, and delete all future data:
```bash
# From project root directory
export DATABASE_URL="your-postgresql-connection-string"
node scripts/reset-week.js 12 --activate --delete-future
```

Output:
```
🔄 Starting week reset process...

📊 Current state:
   Current week: 11
   Week active: false
   Picks by week: [ { week_number: 11, count: '200' } ]
   Scores by week: [ { week_number: 11, count: '168' } ]

⚙️  Updating game settings...
   ✓ Set current_playoff_week to 12
   ✓ Set is_week_active to true

✅ New state:
   Current week: 12
   Week active: true
   Picks by week: [ { week_number: 11, count: '200' } ]
   Scores by week: [ { week_number: 11, count: '168' } ]

✨ Week reset complete!
```

Reset to week 1 and activate (preserve all data):
```bash
node scripts/reset-week.js 1 --activate
```

Set current week to 13 without activating:
```bash
node scripts/reset-week.js 13
```

**Options:**
- `--activate` - Set `is_week_active` to `true` (enable user picking)
- `--delete-future` - Delete all picks/scores for weeks greater than the specified week
- `--help` - Show help message

**Environment Variables:**
- `DATABASE_URL` - PostgreSQL connection string (required)
- `NODE_ENV` - Set to 'production' for SSL connection

**What it does:**
1. Shows current state (week number, active status, pick/score counts)
2. Optionally deletes picks, scores, and multipliers for future weeks
3. Updates `game_settings` table with new week and active status
4. Verifies changes and displays new state

**Safety:**
- Shows before/after state for verification
- Requires explicit `--delete-future` flag to delete data
- Uses transactions for safe database operations

## Setup

Scripts have their own dependencies. Install them once:

```bash
cd scripts
npm install
cd ..
```

## Database Connection

Scripts use the `DATABASE_URL` environment variable. Get this from Railway:

1. Go to Railway dashboard
2. Select your project
3. Click on "Variables" tab
4. Copy the `DATABASE_URL` value

Set it locally:
```bash
export DATABASE_URL="postgresql://..."
```

Or create a `.env` file in the project root (DO NOT commit this):
```
DATABASE_URL=postgresql://...
```

## Common Use Cases

### Start a New Playoff Week

When advancing to a new week and allowing users to make picks:

```bash
# Reset to new week and activate picking
node scripts/reset-week.js <week_number> --activate --delete-future

# Load test data for bot accounts
node scripts/load-test-picks.js <week_number> --delete-existing
```

### Reset After Testing

If you need to go back to a previous week and clear test data:

```bash
# Reset to week 1 and clear all future data
node scripts/reset-week.js 1 --activate --delete-future

# Reload test picks
node scripts/load-test-picks.js 1 --delete-existing
```

### Populate Test Data Only

To add or refresh test bot picks without affecting real users:

```bash
# Add picks for test accounts for current week
node scripts/load-test-picks.js 12

# Replace existing test picks
node scripts/load-test-picks.js 12 --delete-existing
```

### Lock a Week

To disable picking for the current week without changing the week number:

```bash
# Manually update via psql:
psql "$DATABASE_URL" -c "UPDATE game_settings SET is_week_active = false;"
```

Or use the backend API:
```bash
curl -X POST "https://playoffchallenge-production.up.railway.app/api/admin/update-week-status" \
  -H "Content-Type: application/json" \
  -d '{"isActive": false}'
```

## Best Practices

1. **Always backup first** - Run a verification query before destructive operations
2. **Test locally** - Use a local database copy for testing scripts
3. **Check current state** - Review the "Current state" output before confirming changes
4. **Use --delete-future carefully** - This permanently deletes user picks and scores
5. **Notify users** - Let users know if you're resetting their picks

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
