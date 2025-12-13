# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current State (Last Updated: 2025-12-12)

### Testing Status
- **Current Week:** Week 14 (Conference Round simulation)
- **Next Transition:** Week 15 (Super Bowl) - TBD
- **Active Testers:** 1 admin user (User_hdss5l9s - admin, paid)
- **Database State:** Clean slate with compliance features fully implemented
- **iOS App Status:** ✅ Compliance flow complete and tested (Phase 5)
  - New user signup flow: Apple Sign In → EligibilityView → TermsOfServiceView → Main App
  - Existing user flow: Apple Sign In → Main App (or TOS if not accepted)
- **Known Issues (iOS) - Ready to Fix Next Session:**
  - **Bug #5 (Medium Priority):** Race condition on initial login
    - **Issue:** Shows "No picks yet" until user taps any week tab
    - **Root Cause:** `loadData()` called before `loadCurrentWeek()` completes (selectedWeek defaults to 12)
    - **Location:** LineupView.swift lines 564-605
    - **Fix:** Ensure `loadCurrentWeek()` completes before `loadData()` in init sequence
    - **Workaround:** User can tap any tab to reload with correct week
  - **Bug #3 (Low Priority):** RB not showing in UI until save
    - **Issue:** Adding James Cook (RB) shows "2/2" but player not visible until save
    - **Root Cause:** SwiftUI state not triggering view update
    - **Impact:** Cosmetic only - data correct after save
    - **Location:** Likely PlayerSelectionView.swift or MyPickView.swift state management
- **Last Deploy (Backend):** Dec 12, 2025 - Compliance features (commit a2c1c9e)
- **Last Deploy (iOS):** Dec 12, 2025 - Phase 5 complete (eligibility + TOS flows tested)

### Recent Major Changes (Last 7 Days)
1. **Dec 12 (Compliance - Phases 0-5):** ✅ Complete legal compliance implementation - TESTED & WORKING
   - **Backend (Phases 0-4):**
     - Database wiped for fresh testing state (Phase 0)
     - Added compliance fields to users table: state, eligibility, TOS tracking (Phase 1)
     - Created signup_attempts audit table for compliance reporting (Phase 2)
     - Installed geoip-lite for IP-based state verification (Phase 4)
     - Blocked restricted states: NV, HI, ID, MT, WA at signup (Phase 4)
     - Added TOS endpoints: GET /api/terms, PUT /api/admin/terms (Phase 3)
     - Added compliance admin endpoints for reporting (Phase 4)
   - **iOS (Phase 5 - COMPLETED):**
     - Created EligibilityView.swift - state selection, age/residency/skill-based confirmations
     - Created TermsOfServiceView.swift - TOS acceptance with scrollable content
     - Updated APIService.swift - added `APIError.needsEligibility` handling
     - Updated AuthService.swift - integrated eligibility + TOS flows
     - Updated PlayoffChallengeApp.swift - routing logic for new user flows
     - **Tested end-to-end:** New user signup → eligibility → TOS → main app ✅
   - **Important Apple Sign In Behavior:** Email/name only provided on first authorization
     - If user previously authorized app, Apple won't send email/name again
     - Backend generates random username (e.g., User_hdss5l9s) when email/name unavailable
     - Users can update username/email/phone later in Profile section
2. **Dec 4 (iOS):** Fixed Bug #4 - Player removal now properly calls DELETE API and persists to backend
3. **Dec 4 (Backend):** Fixed critical Bug #2 - Multipliers now preserved when iOS app saves picks (COALESCE fix)
4. **Dec 4:** Executed Week 14 transition - advanced 201 picks from Week 13 with multiplier increases
5. **Dec 4:** Corrected playoff week setting from 14 → 3 (Conference Round)
6. **Dec 1:** Added user profile update functionality (username, email, phone editing)
7. **Dec 1:** Enhanced Admin Users tab with copy/paste contact info

### Active Priorities (See `/wiki/LAUNCH_ROADMAP.md`)
**Launch Target:** Jan 8-13, 2026 (NFL Wild Card weekend)

- ✅ **P0 Critical:** Legal compliance (geoblocking, age verification, TOS) - COMPLETED Dec 12
- **P0 Critical:** Monitoring & alerting system (Complexity: 8)
- **P0 Critical:** Refactor server.js - remove unused code (Complexity: 3)
- **P0 Critical:** Refactor database - remove unused tables/columns (Complexity: 5)
- **P1 High:** Check Railway API & DB usage/costs (Complexity: 1)
- ✅ **P1 High:** Enhance Admin section for launch day operations (Complexity: 3) - COMPLETED
- ✅ **P1 High:** Enhance Profile tab UX (Complexity: 5) - COMPLETED

### Testing Setup Context
- **Week Mapping:** NFL regular season weeks 12-15 simulate playoff rounds
  - Week 12 = Wild Card (bye teams: DEN, LAC, MIA, WAS)
  - Week 13 = Divisional Round (no bye teams)
  - **Week 14 = Conference Championships (CURRENT WEEK)**
    - Bye teams for elimination testing: SF, NE, CAR, NYG (4 teams)
    - 7 players eliminated during Week 13→14 transition (from SF, NE, CAR only)
  - Week 15 = Super Bowl
- **Multiplier System:** Picks carry forward with increased multipliers (1x→2x→3x)
  - Week 14: 201 total picks (7 fewer due to eliminations)
  - Week 13 had 208 picks
- **Player Replacement Testing:**
  - 7 players available for real users to test replacement UI
  - Bot users have correct rosters (no bye team players auto-advanced)

### Quick Context for New Sessions
- Monorepo: backend (Node.js) + ios-app (Swift) + wiki (docs)
- Backend branch is protected and auto-deploys to Railway
- All operational scripts in `/scripts/` directory
- Week transition process documented in `/wiki/` for repeatability

---

## Project Overview

This is a fantasy football playoff challenge application where users pick NFL players and compete for prizes based on real-time player performance during the NFL playoffs. The app consists of:

- **iOS app** (Swift/SwiftUI) - primary user interface
- **Node.js/Express backend** - REST API with live stats integration
- **PostgreSQL database** - hosted on Railway

Production API: https://playoffchallenge-production.up.railway.app

## Code Quality Guidelines

Every session should improve the codebase, not just add to it. Actively refactor code you encounter, even outside your immediate task scope.

- **DRY**: Consolidate duplicate patterns into reusable functions after the 2nd occurrence
- **Clean**: Delete dead code immediately (unused imports, functions, variables, commented code)
- **Leverage**: Use battle-tested packages over custom implementations
- **Readable**: Maintain comments and clear naming—don't sacrifice clarity for LoC

Leave the code cleaner than you found it: fewer LoC through better abstractions.

## Custom Claude Agents

This repository includes custom Claude Code agents located in `.claude/agents/`:

- **git-workflow-helper** - Guides users through proper git operations, branching strategies, and version control workflows specific to this project
  - Helps create feature branches
  - Provides safe commit and push guidance
  - Assists with merge conflict resolution
  - Enforces best practices for the protected backend branch

- **onboarding-wiki-author** - Creates and maintains onboarding documentation for new developers
  - Generates setup guides
  - Documents development workflows
  - Creates getting-started materials

- **ops-doc-writer** - Creates operational and user-facing documentation
  - Writes user guides
  - Creates admin documentation
  - Documents feature workflows

These agents are automatically available to Claude Code and can be invoked when needed for their specialized tasks.

## Common Commands

### Backend Development

```bash
cd backend

# Start server (production mode)
npm start

# Start server with auto-reload (development)
npm run dev

# Install dependencies
npm install
```

### iOS Development

```bash
# Open project
open ios-app/PlayoffChallenge/PlayoffChallenge.xcodeproj

# Build from command line
xcodebuild -project ios-app/PlayoffChallenge/PlayoffChallenge.xcodeproj -scheme PlayoffChallenge build

# Archive for TestFlight (do this in Xcode: Product → Archive)
```

### Database Access

```bash
# Connect to production database (requires Railway connection string from env)
psql "$DATABASE_URL"

# Apply schema changes
psql "$DATABASE_URL" < backend/schema.sql
```

### Deployment

**Backend:** Push to `backend` branch triggers automatic Railway deployment
```bash
git push origin backend
```

**iOS:** Archive in Xcode → Upload to App Store Connect → TestFlight

## Architecture

### Monorepo Structure

```
playoff-challenge/
├── backend/              # Node.js/Express API
│   ├── server.js         # Main API server (3,901 lines, 53 endpoints)
│   └── schema.sql        # PostgreSQL schema
├── ios-app/PlayoffChallenge/
│   ├── Services/         # APIService, AuthService
│   ├── Models/           # Data models, ViewModels (includes PlayerViewModel.swift)
│   └── Views/            # SwiftUI screens (includes EligibilityView, TermsOfServiceView)
└── admin-dashboard/      # (empty placeholder)
```

### Backend (server.js)

**Core Pattern:**
- Single-file Express server with all endpoints in `server.js`
- Direct PostgreSQL queries using `pg` Pool (no ORM)
- In-memory caching for live stats and player data
- External API integration: Sleeper API (player roster), ESPN API (live stats)
- **Compliance:** geoip-lite for IP geolocation, restricted states: NV, HI, ID, MT, WA

**Key Caching Strategy:**
- `playersCache`: 30-minute TTL for player list (in-memory object: `{ data: [], lastUpdate: timestamp }`)
  - Invalidated on player sync
- `liveStatsCache.games`: 10-minute TTL for scoreboard data (Map)
- `liveStatsCache.playerStats`: Player stats by ESPN ID (Map)
- Game summaries: 90-second TTL per game (Map)
- Cache helpers at top of server.js: `SCOREBOARD_CACHE_MS`, `GAME_SUMMARY_CACHE_MS`, `PLAYERS_CACHE_MS`
- **Note**: All caches are in-memory and reset on server restart

**Important Helper Functions:**
- `mapESPNAthleteToPlayer()`: Maps ESPN athlete IDs to internal player IDs (lines 41-84)
- `parsePlayerStatsFromSummary()`: Parses ESPN boxscore data (lines 87-129)

**Key API Endpoints:**

Authentication & Users:
- `POST /api/users` - Create/get user with Apple ID (requires state/eligibility for new users)
- `GET /api/users/:userId` - Get user details
- `PUT /api/users/:userId` - Update user profile (username, email, phone)
- `POST /api/users/:userId/accept-tos` - **NEW:** Accept Terms of Service
- `GET /api/admin/users` - List all users (admin)
- `PUT /api/admin/users/:id/payment` - Mark user as paid
- `DELETE /api/admin/users/:id` - Delete user

Compliance & Legal (NEW Dec 12):
- `GET /api/terms` - Get current active Terms of Service
- `PUT /api/admin/terms` - Update/create TOS version (admin)
- `GET /api/admin/compliance/signups` - Get signup attempts audit log (admin)
- `GET /api/admin/compliance/stats` - Get compliance statistics (admin)

Players & Picks:
- `GET /api/players` - Get available players (uses cache)
- `POST /api/picks` - Create/update a pick (upsert logic with ON CONFLICT)
- `GET /api/picks/user/:userId` - Get user's picks
- `GET /api/picks/:userId` - Alternative endpoint for user picks
- `GET /api/picks` - Get all picks (with optional filters)
- `DELETE /api/picks/:pickId` - Remove a pick

Scoring & Leaderboard:
- `GET /api/scores` - Get player scores by week
- `GET /api/leaderboard` - Get ranked user standings
- `GET /api/live-stats/player/:playerId` - Real-time player stats
- `GET /api/live-stats/week/:weekNumber` - All live stats for a week

Admin Functions:
- `POST /api/admin/sync-players` - Import players from Sleeper API
- `POST /api/admin/update-live-stats` - Refresh live stats from ESPN
- `POST /api/admin/sync-espn-ids` - Map ESPN IDs to players
- `POST /api/admin/set-active-week` - Change current playoff week
- `POST /api/admin/update-current-week` - Update current week
- `POST /api/admin/update-week-status` - Update week status
- `POST /admin/refresh-week` - Force refresh scoring for a specific week (critical for testing)
- `GET /api/admin/cache-status` - View cache statistics and active games
- `GET /api/admin/check-espn-ids` - Debug ESPN ID mappings with query params
- `GET /api/admin/position-requirements` - Get position requirements
- `PUT /api/admin/position-requirements/:id` - Update position requirement (supports requiredCount and isActive)

Configuration:
- `GET /api/game-config` - Game settings, position limits, payouts
- `GET /api/settings` - Alias for /api/game-config
- `PUT /api/admin/settings` - Update game settings (entry_amount, payment handles, position limits)
- `GET /api/rules` - Game rules content
- `PUT /api/admin/rules/:id` - Update specific rule content
- `GET /api/payouts` - Payout structure
- `GET /api/scoring-rules` - Get all scoring rules

Debugging & Testing:
- `GET /health` - Health check endpoint (returns `{ status: 'ok', timestamp }`)
- `GET /leaderboard-test` - HTML view of leaderboard for debugging

### Database (schema.sql)

**Core Tables:**
- `users` - Apple ID authentication, payment status, admin flag, **compliance fields**
  - Auth: `apple_id`, `email`, `name`, `username`, `phone`
  - Payment: `paid`, `payment_method`, `payment_date`
  - Admin: `is_admin`
  - **Compliance (NEW Dec 12):** `state`, `ip_state_verified`, `state_certification_date`, `eligibility_confirmed_at`, `age_verified`, `tos_version`, `tos_accepted_at`
  - Note: `email` and `name` may be NULL (Apple Sign In only provides on first authorization)
- `players` - NFL player roster (synced from Sleeper API)
  - Critical fields for data integrity: `sleeper_id`, `espn_id`, `first_name`, `last_name`, `team`, `position`
- `picks` - User player selections per week
  - Unique constraint: one player per position per week per user
- `scores` - Player fantasy points per week
- `game_settings` - Configurable parameters (entry fee, playoff week, position limits)
- `scoring_rules` - Points per stat type
- `position_requirements` - Position limits per game
  - Each position has: `required_count`, `display_name`, `display_order`, `is_active`
  - Editable via: `PUT /api/admin/position-requirements/:id`

**Additional Tables:**
- `payout_structure` - Configurable prize distribution percentages by place
- `pick_multipliers` - Historical tracking of pick multipliers per week
- `player_swaps` - Audit log for player substitutions (tracks old/new player, reason, timestamp)
- `rules_content` - Dynamic game rules content (editable via admin panel)
- `payouts` - Actual payout records linking users to amounts
- **`signup_attempts` (NEW Dec 12)** - Compliance audit log for blocked/suspicious signups
  - Tracks: `apple_id`, `email`, `claimed_state`, `ip_state`, `blocked`, `block_reason`, timestamps
  - Used for compliance reporting and fraud detection
- **`terms_of_service` (NEW Dec 12)** - TOS versioning and content management
  - Fields: `version`, `content`, `effective_date`, `is_active`
  - Retrieved via: `GET /api/terms`, managed via: `PUT /api/admin/terms`

**Custom Functions:**
- `get_nfl_week_number(playoff_week)` - Converts playoff week (1-4) to NFL week number
- `get_playoff_week_number(nfl_week)` - Converts NFL week to playoff round (1-4)
- `update_updated_at_column()` - Trigger for timestamp management

**Views:**
- `v_game_status` - Complex query for game status tracking

### iOS App

**SwiftUI Architecture:**
- `PlayoffChallengeApp.swift` - Entry point, handles auth state
- `ContentView.swift` - Tab navigation (Home, My Picks, Leaderboard, Profile)

**Services:**
- `APIService.swift` - Comprehensive REST API client
  - Base URL configured via `baseURL` property
  - All endpoints return decoded Swift models
  - Error handling with `APIError` enum (includes `needsEligibility` for new user flow)
- `AuthService.swift` - Sign in with Apple integration
  - Uses ASAuthorizationController
  - Returns `appleUserId` for backend authentication
  - Manages `pendingAppleCredential` state for new user eligibility flow
  - Checks `needsToAcceptTOS` flag for TOS enforcement

**Key Views:**
- `SignInView.swift` - Apple Sign In flow (entry point for unauthenticated users)
- `EligibilityView.swift` - **NEW:** Compliance signup (state, age, residency verification)
- `TermsOfServiceView.swift` - **NEW:** TOS acceptance (required for new users)
- `HomeView.swift` - Dashboard, quick picks overview
- `PlayerSelectionView.swift` - Pick players for a week
- `MyPickView.swift` - View/manage user's picks
- `LeaderboardView.swift` - Rankings and scores
- `ProfileView.swift` - User settings and payment (username, email, phone editable)
- `AdminView.swift` - Admin panel (sync players, manage users, settings)
- `RulesView.swift` - Game rules display

**Models (Models.swift):**
- `User`, `Player`, `Pick`, `Score`, `GameConfig`, `PositionRequirement`, `Leaderboard`, etc.
- Custom `FlexibleDecoder` for handling number/string type mismatches from API

**ViewModels (located in Models/ directory):**
- `PlayerViewModel.swift` - Manages player selection logic, position limits

## Development Workflow

### Adding New Features

1. **Backend changes:**
   - Add endpoint to `server.js`
   - Update `schema.sql` if database changes needed
   - Test locally with `npm run dev`
   - Push to `backend` branch for deployment

2. **iOS changes:**
   - Add models to `Models.swift` if needed
   - Add/update API methods in `APIService.swift`
   - Create/modify views in `Views/`
   - Test in Xcode simulator
   - Archive and upload to TestFlight

3. **Database migrations:**
   - Update `schema.sql` with new tables/columns
   - Apply manually to production database via Railway dashboard or psql
   - Note: No automated migration system - handle carefully

### Live Stats Sync

The backend continuously polls ESPN API for live game stats during active games:
- Scoreboard refresh: every 10 minutes (cache-based)
- Game summary refresh: every 90 seconds per active game
- **Background polling**: Every 2 minutes (production only, starts 5s after server boot)
- Admin manual trigger: `POST /api/admin/update-live-stats`
- Week-specific refresh: `POST /admin/refresh-week` (requires `{"week": 1}` in body)

### Player Data Sync

Players are imported from Sleeper API:
- **Not currently accessible via UI** (feature removed from admin panel)
- Endpoint still exists: `POST /api/admin/sync-players`
- Can be triggered manually via API call or database script
- Imports **all active NFL players** from Sleeper API
- Filters to: depth chart positions 1-2 (or all K/DEF players) for positions: QB, RB, WR, TE, K, DEF
- **Not limited to playoff teams** - syncs players from all NFL teams
- ESPN IDs come from Sleeper API data (not fuzzy matched during sync)
- Upserts players: updates existing, inserts new based on `player_id`/`sleeper_id`
- Clears player cache after sync completes

### ESPN ID Sync

- Available in admin panel: Settings → "Sync ESPN IDs" button
- Endpoint: `POST /api/admin/sync-espn-ids`
- Maps ESPN athlete IDs to existing players in database
- Uses Sleeper API to get ESPN ID mappings

### Utility Scripts

**Note**: Utility scripts have been removed from the repository. Previously there were 50+ troubleshooting scripts (`audit*.js`, `fix*.js`, `check*.js`, `generate*.js`) used for data maintenance and debugging during development. These can be recreated as needed for specific troubleshooting tasks.

## Key Considerations

### ESPN ID Mapping

Player stats from ESPN require mapping ESPN athlete IDs to internal player IDs:
- Primary: exact match on `players.espn_id`
- Fallback: fuzzy name matching (first + last name)
- Auto-updates `espn_id` when mapping succeeds via name match
- Critical function: `mapESPNAthleteToPlayer()` in server.js

### Playoff Week System

The app uses a dual week numbering system:
- **NFL Week** (e.g., 19, 20, 21, 22) - actual NFL calendar week
- **Playoff Week** (1, 2, 3, 4) - game rounds (Wild Card, Divisional, Conference, Super Bowl)
- Conversion functions in database: `get_nfl_week_number()`, `get_playoff_week_number()`
- `game_settings.playoff_start_week` defines the mapping (usually week 19)

### Authentication

Sign in with Apple is the sole authentication method with **compliance-gated signup flow**:

**Backend Endpoints:**
- `POST /api/users` - Get or create user (requires state/eligibility for new users)
- `GET /api/users/:userId` - Get user details (uses Apple ID as userId)
- `POST /api/users/:userId/accept-tos` - Accept Terms of Service

**New User Flow (with Compliance):**
1. User signs in with Apple → iOS gets `apple_id`, `email?`, `name?`
2. iOS calls `POST /api/users` with just `apple_id` (no state/eligibility)
3. Backend returns **400 error** if user doesn't exist (needs eligibility)
4. iOS catches `APIError.needsEligibility` → shows `EligibilityView`
5. User selects state, confirms age/residency/skill-based → iOS calls `POST /api/users` with full compliance data
6. Backend validates state (blocks NV, HI, ID, MT, WA), logs IP state for audit
7. User created → iOS shows `TermsOfServiceView`
8. User accepts TOS → iOS calls `POST /api/users/:userId/accept-tos`
9. User authenticated → Main app loads

**Existing User Flow:**
1. User signs in with Apple → iOS gets `apple_id`
2. iOS calls `POST /api/users` with just `apple_id`
3. Backend returns existing user record
4. If `tos_accepted_at` is NULL → show `TermsOfServiceView`
5. Else → Main app loads

**Important Apple Sign In Behavior:**
- Email and name **only provided on first authorization** (privacy/security)
- Subsequent signins: Apple sends only `apple_id`
- Backend generates random username (e.g., `User_hdss5l9s`) if email/name unavailable
- Users can update profile (username, email, phone) later in app

### Position Limits

Configurable per game via `position_requirements` table:
- Each position has: `required_count`, `display_name`, `display_order`, `is_active`
- Editable via admin endpoint: `PUT /api/admin/position-requirements/:id`
- Default: 1 QB, 2 RB, 2 WR, 1 TE, 1 K, 1 DEF (legacy `game_settings` columns deprecated)
- Enforced in backend when creating picks
- Displayed in iOS app via `GameConfig.positionRequirements`
- Retrieved via: `GET /api/admin/position-requirements`

### Testing Strategy

No formal test suite exists. Testing is primarily:
- Manual testing in iOS simulator/TestFlight
- Backend: test endpoints with curl/Postman
- Utility scripts for data validation

## Security Considerations

### Current Security Posture
- **Authentication**: Apple Sign In only - no password storage
- **Authorization**: Database-driven admin flag check per request (no middleware)
- **SQL Injection**: Protected via parameterized queries throughout ($1, $2, etc.)
- **CORS**: Wide open - accepts requests from any origin (server.js line 12)
- **Rate Limiting**: None implemented
- **SSL**: Enforced in production only (when NODE_ENV='production')

### Admin Access Pattern
Admin endpoints require `userId` parameter and verify admin status via database query:
```javascript
const userCheck = await pool.query(
  'SELECT is_admin FROM users WHERE id = $1',
  [userId]
);
if (!userCheck.rows[0].is_admin) {
  return res.status(403).json({ error: 'Admin access required' });
}
```

**Important Notes:**
- No JWT or session tokens - Apple ID is the sole authenticator
- User ID passed as query/body parameter on every request
- No authentication middleware - validation occurs per-endpoint
- Admin status checked via database lookup on each admin request

### Known Security Gaps
1. **No rate limiting** - API endpoints can be called unlimited times
2. **Open CORS** - Any website can make API requests (currently set to allow all origins)
3. **No admin session management** - Admin verified per request via DB query
4. **User IDs in URLs** - UUIDs exposed in leaderboard and API responses (low risk - hard to enumerate)
5. **No IP whitelisting** - Admin routes accessible from anywhere

### Recommended Security Improvements
- Implement `express-rate-limit` for admin endpoints
- Restrict CORS to production domain in production environment
- Add admin API key or JWT-based admin sessions
- Consider IP whitelisting for sensitive admin routes
- Add request logging for audit trail

### Data Privacy
- Apple IDs are unique identifiers (not personally identifiable information)
- Email addresses stored but not displayed publicly
- Leaderboard shows username/name publicly
- Payment status is visible via leaderboard (marked as "paid" or not)
- No sensitive payment information stored (uses Venmo/Cash App/Zelle handles only)

## API Error Responses

All API errors return JSON with an `error` field:
```json
{ "error": "Error message here" }
```

**Common HTTP Status Codes:**
- **400**: Bad request (missing required parameters)
- **403**: Forbidden (admin access required, lacks permissions)
- **404**: Resource not found (player, pick, user doesn't exist)
- **500**: Internal server error (database errors, external API failures)

**Example Error Scenarios:**
- Missing userId: `{ "error": "userId is required" }`
- Admin required: `{ "error": "Admin access required" }`
- Position limit exceeded: `{ "error": "Position limit exceeded for QB" }`
- Duplicate pick: Silently updates via UPSERT (no error)

## Troubleshooting

### Players Not Scoring

**Symptoms:** Player has stats in ESPN but shows 0 points in app

**Debugging Steps:**
1. Check ESPN ID mapping:
   ```bash
   curl "https://playoffchallenge-production.up.railway.app/api/admin/check-espn-ids?espnIds=12345"
   ```
2. Verify cache status:
   ```bash
   curl "https://playoffchallenge-production.up.railway.app/api/admin/cache-status"
   ```
3. Force refresh for specific week:
   ```bash
   curl -X POST "https://playoffchallenge-production.up.railway.app/admin/refresh-week" \
     -H "Content-Type: application/json" \
     -d '{"week": 1}'
   ```
4. Check if player exists in database:
   ```sql
   SELECT * FROM players WHERE espn_id = '12345' OR LOWER(last_name) = 'playername';
   ```

### Live Stats Not Updating

**Symptoms:** Scores frozen or not updating during games

**Debugging Steps:**
1. Check current active week:
   ```bash
   curl "https://playoffchallenge-production.up.railway.app/api/game-config"
   ```
2. Verify active games in cache:
   ```bash
   curl "https://playoffchallenge-production.up.railway.app/api/admin/cache-status"
   ```
3. Manual stats update trigger:
   ```bash
   curl -X POST "https://playoffchallenge-production.up.railway.app/api/admin/update-live-stats" \
     -H "Content-Type: application/json" \
     -d '{"weekNumber": 1}'
   ```
4. Check Railway logs for ESPN API errors

### Database Connection Issues

**Symptoms:** 500 errors, "database connection failed"

**Debugging Steps:**
1. Verify DATABASE_URL is set correctly in Railway
2. Check database is running in Railway dashboard
3. Test connection manually:
   ```bash
   psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM users;"
   ```
4. Check for connection pool exhaustion (default max: 10 connections)

### ESPN ID Mapping Failures

**Symptoms:** New players not syncing, stats not appearing

**Debugging Steps:**
1. Run ESPN ID sync:
   ```bash
   curl -X POST "https://playoffchallenge-production.up.railway.app/api/admin/sync-espn-ids"
   ```
2. Manually update ESPN ID in database:
   ```sql
   UPDATE players SET espn_id = '12345' WHERE id = 'player-uuid-here';
   ```

## External API Dependencies

### ESPN API (No authentication required)

**Endpoints Used:**
- **Scoreboard**: `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard`
  - Returns all games for current week
  - Cached for 10 minutes
- **Game Summary**: `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event={gameId}`
  - Detailed boxscore and player stats
  - Cached for 90 seconds per game
- **Competitor Stats**: `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/{gameId}/competitions/{gameId}/competitors/{teamId}/statistics`
  - Team-level statistics

**Rate Limits:** Unknown - no throttling currently implemented
**Reliability:** No fallback if ESPN API is down
**Error Handling:** Logs errors but continues processing other games

### Sleeper API (No authentication required)

**Endpoints Used:**
- **Player Data**: `https://api.sleeper.app/v1/players/nfl`
  - Complete NFL player roster
  - Refreshed manually via admin panel only

**Rate Limits:** Unknown
**Refresh Frequency:** Manual only (not automated)
**Data Quality:** Generally reliable, but ESPN IDs may be missing or incorrect

## Repository Security

### Branch Protection
- **Backend Branch**: Protected with branch policy
- **Access Control**: Read, write, and deploy key roles can push to backend
- **Public Repository**: This is a public GitHub repository - never commit secrets

### Secret Management
- **Environment Variables**: All secrets stored in Railway environment variables only
- **Never Commit**:
  - `.env` files (properly in `.gitignore`)
  - Database connection strings
  - API keys or tokens
  - Private keys or certificates
- **Local Development**: Use `.env` file for local development (not tracked by git)
- **Production**: All secrets configured in Railway dashboard

### Environment Variable Configuration
**Required in Railway:**
- `DATABASE_URL` - PostgreSQL connection string (contains credentials)
- `NODE_ENV` - Set to 'production'
- `PORT` - Assigned automatically by Railway

**Not Required (optional):**
- Apple Sign In credentials (if backend needs to verify tokens in future)

### Code Review
- Since this is a public repository, assume all code is visible
- No security through obscurity - use proper authentication/authorization
- Admin endpoints rely on database `is_admin` flag, not secret keys

## Production Environment

- **Hosting:** Railway
- **Database:** PostgreSQL on Railway
- **Environment Variables:**
  - `DATABASE_URL` - PostgreSQL connection string (required)
  - `PORT` - Server port (default 8080)
  - `NODE_ENV` - Set to 'production' for SSL and background polling
- **Deployment:** Automatic on push to `backend` branch (protected)
- **Logs:** Available in Railway dashboard
- **Health Check:** `GET /health` returns `{ status: 'ok', timestamp }`
- **Database Migrations:** Manual only - no automated migration system
- **SSL:** Enforced when NODE_ENV='production' via `rejectUnauthorized: false`

## iOS Distribution

- **Method:** TestFlight (internal testing)
- **Bundle ID:** com.greenbowalabama.PlayoffChallenge (verify in Xcode)
- **Capabilities:** Sign in with Apple (requires entitlement)
- **Archive:** Xcode → Product → Archive → Distribute
