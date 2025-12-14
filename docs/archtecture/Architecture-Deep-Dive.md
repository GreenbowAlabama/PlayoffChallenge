# Architecture Deep Dive

This page provides a comprehensive overview of how the Playoff Challenge system works, from user interaction to data flow to external integrations.

⏱️ **Estimated time:** 30 minutes reading

## System Overview

Playoff Challenge is a full-stack application with three main components working together:

```
┌─────────────────┐
│   iOS App       │
│  (Swift/UI)     │
└────────┬────────┘
         │ HTTPS/JSON
         │
┌────────▼────────┐      ┌──────────────┐
│  Backend API    │◄─────┤  Railway     │
│  (Node/Express) │      │  PostgreSQL  │
└────────┬────────┘      └──────────────┘
         │
    ┌────┴────┐
    │         │
┌───▼──┐  ┌──▼────┐
│ ESPN │  │Sleeper│
│ API  │  │ API   │
└──────┘  └───────┘
```

---

## Component Details

### iOS App (SwiftUI)

**Purpose:** Primary user interface for fantasy football picks and leaderboard viewing.

**Architecture Pattern:** MVVM (Model-View-ViewModel)
- **Models:** Data structures matching API responses
- **Views:** SwiftUI screens and components
- **ViewModels:** Business logic (e.g., PlayerViewModel)
- **Services:** API communication and authentication

**Key Technologies:**
- SwiftUI for declarative UI
- async/await for API calls
- Sign in with Apple for authentication
- URLSession for networking

**Data Flow:**
1. User interacts with View
2. View calls APIService function
3. APIService makes HTTP request to backend
4. Backend returns JSON
5. JSON decoded into Swift models
6. View updates with new data

**Example: Making a Pick**
```
User taps player
  → PlayerViewModel updates selection
  → User taps "Submit"
  → APIService.submitPick() called
  → POST /api/picks with player data
  → Backend saves to database
  → Returns success/error
  → View shows confirmation
```

---

### Backend API (Node.js/Express)

**Purpose:** REST API providing player data, scoring, and user management.

**Architecture Pattern:** Monolithic single-file server
- All code in `server.js` (2,246 lines)
- No framework layers or middleware patterns
- Direct PostgreSQL queries (no ORM)
- In-memory caching for performance

**Why Single File?**
- Started as a rapid prototype
- Fast iteration during development
- No unnecessary abstraction
- Easy to search and understand flow

**Caching Strategy:**

The backend uses in-memory caching to reduce database/API calls:

| Cache | TTL | Purpose | Invalidation |
|-------|-----|---------|--------------|
| `playersCache` | 30 min | Player roster | Manual sync |
| `liveStatsCache.games` | 10 min | Game scoreboard | Time-based |
| `liveStatsCache.playerStats` | 10 min | Player stats | Time-based |
| Game summaries | 90 sec | Individual game details | Time-based |

**Important:** All caches are in-memory. When the server restarts (deploys), all caches are cleared.

**Helper Functions:**

**`mapESPNAthleteToPlayer(athleteId, athleteName)`** (lines 41-84)
- Maps ESPN athlete IDs to internal database player IDs
- Primary: Exact match on `espn_id`
- Fallback: Fuzzy name matching (first + last name)
- Auto-updates `espn_id` when fuzzy match succeeds

**`parsePlayerStatsFromSummary(boxscore)`** (lines 87-129)
- Parses ESPN boxscore JSON
- Extracts player statistics
- Maps to fantasy point calculations
- Returns array of player stat objects

---

### Database (PostgreSQL on Railway)

**Purpose:** Persistent data storage for users, picks, scores, and configuration.

**Schema Philosophy:**
- Normalized tables (3NF)
- UUID primary keys for users and picks
- Natural keys for players (Sleeper ID)
- Audit columns (`created_at`, `updated_at`)

**Core Tables:**

**`users`**
- id (UUID, primary key)
- apple_user_id (unique, authentication)
- email, username
- is_admin (boolean)
- payment_status
- created_at, updated_at

**`players`**
- id (UUID, primary key)
- sleeper_id (text, unique)
- espn_id (text, indexed)
- first_name, last_name
- team (e.g., "KC", "BUF")
- position (QB/RB/WR/TE/K/DEF)
- status (active/inactive)

**`picks`**
- id (UUID, primary key)
- user_id (FK → users)
- player_id (FK → players)
- week (integer, 1-4)
- position (QB/RB/WR/TE/K/DEF)
- UNIQUE(user_id, week, position)

**`scores`**
- id (serial, primary key)
- player_id (FK → players)
- week (integer)
- points (decimal)
- stats (JSONB, raw stat breakdown)
- game_id (ESPN game ID)
- UNIQUE(player_id, week)

**Custom Functions:**

**`get_nfl_week_number(playoff_week)`**
- Converts playoff round (1-4) to NFL week (19-22)
- Example: `get_nfl_week_number(1)` → `19`

**`get_playoff_week_number(nfl_week)`**
- Converts NFL week to playoff round
- Example: `get_playoff_week_number(19)` → `1`

---

## Data Flow: User Makes Picks

### Step 1: User opens "My Picks" tab
```
iOS: MyPickView loads
  → APIService.getPlayers()
  → GET /api/players
```

### Step 2: Backend serves players
```
server.js: GET /api/players
  → Check playersCache
  → If fresh (< 30 min), return cached data
  → If stale, query database:
    SELECT * FROM players WHERE status = 'active'
  → Cache result
  → Return JSON array of players
```

### Step 3: User selects players and submits
```
iOS: User taps "Submit Picks"
  → APIService.submitPicks(userId, week, picks)
  → POST /api/picks
  → Body: {
      userId: "abc-123",
      week: 1,
      picks: [...]
    }
```

### Step 4: Backend validates and saves
```
server.js: POST /api/picks
  → Validate userId exists
  → Validate position limits not exceeded
  → For each pick:
    INSERT INTO picks (user_id, player_id, week, position)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (user_id, week, position)
    DO UPDATE SET player_id = $2
  → Return success
```

---

## Live Scoring Updates

**Background Process (Production Only):**

Every 2 minutes, the backend automatically:

```javascript
// In server.js (bottom of file)
if (process.env.NODE_ENV === 'production') {
  setInterval(async () => {
    await updateLiveStats(currentWeek);
  }, 120000); // 2 minutes
}
```

**What happens:**
1. Fetch scoreboard from ESPN API
2. Find active games (status = "in progress")
3. For each game, fetch detailed boxscore
4. Parse player stats from boxscore
5. Map ESPN athlete IDs to database players
6. Calculate fantasy points using scoring rules
7. Update scores table with new points

---

## External API Integrations

### ESPN API (Live Stats)

**Base URL:** `https://site.api.espn.com/apis/site/v2/sports/football/nfl/`

**Endpoints Used:**

**Scoreboard**
```
GET /scoreboard
Returns: All games for current day/week
Cache: 10 minutes
```

**Game Summary**
```
GET /summary?event={gameId}
Returns: Detailed boxscore, player stats
Cache: 90 seconds per game
```

**No Authentication Required** - Public API

---

### Sleeper API (Player Data)

**Base URL:** `https://api.sleeper.app/v1/`

**Endpoints Used:**

**NFL Players**
```
GET /players/nfl
Returns: Complete roster of all NFL players
Refresh: Manual only (endpoint exists but removed from UI)
```

**Sync Process:**
1. Endpoint triggered manually: `POST /api/admin/sync-players`
2. Backend fetches all NFL players from Sleeper
3. Filters to depth chart positions 1-2 (starters/backups)
4. Includes all kickers and defenses
5. Upserts players: updates existing, inserts new
6. Clears player cache

---

## Authentication Flow

### Sign in with Apple (iOS)

**Step 1: User taps "Sign In with Apple"**
```swift
AuthService.signInWithApple()
  → ASAuthorizationController presents Apple Sign In
  → User authenticates with Face ID / password
  → Apple returns userIdentifier
```

**Step 2: iOS sends Apple User ID to backend**
```swift
APIService.createOrGetUser(appleUserId: appleUserId)
  → POST /api/users
  → Body: { appleUserId: "001234.abc...xyz" }
```

**Step 3: Backend creates or retrieves user**
```sql
INSERT INTO users (apple_user_id, email, username)
VALUES ($1, $2, $3)
ON CONFLICT (apple_user_id)
DO UPDATE SET updated_at = NOW()
RETURNING *
```

**Security Notes:**
- Apple User ID is unique, stable identifier
- No passwords stored anywhere
- No session tokens or JWTs
- User ID passed as parameter on every API request

---

## Admin Functions

### Admin Access Control

Every admin endpoint checks user's admin status via database query:

```javascript
const userCheck = await pool.query(
  'SELECT is_admin FROM users WHERE id = $1',
  [userId]
);

if (!userCheck.rows[0]?.is_admin) {
  return res.status(403).json({ error: 'Admin access required' });
}
```

**No Middleware** - Authorization happens per-endpoint, not via middleware.

---

## Scoring System

### Scoring Rules

| Stat Type | Points | Description |
|-----------|--------|-------------|
| `passing_td` | 4 | Passing touchdown |
| `rushing_td` | 6 | Rushing touchdown |
| `receiving_td` | 6 | Receiving touchdown |
| `passing_yards` | 0.04 | 1 point per 25 yards |
| `rushing_yards` | 0.1 | 1 point per 10 yards |
| `receiving_yards` | 0.1 | 1 point per 10 yards |
| `reception` | 0.5 | PPR (half-point per reception) |
| `interception` | -2 | Thrown interception |
| `fumble_lost` | -2 | Lost fumble |
| `fg_made` | 3 | Field goal (kicker) |
| `pat_made` | 1 | Extra point (kicker) |
| `def_td` | 6 | Defensive touchdown |
| `sack` | 1 | Sack (defense) |

---

## Deployment Architecture

### Production Environment (Railway)

**Components:**
- **Web Service:** Node.js backend (auto-deploy from `backend` branch)
- **PostgreSQL Database:** Managed database with automatic backups
- **Environment Variables:** Stored securely in Railway dashboard

**Auto-Deployment Flow:**
```
Developer pushes to `backend` branch
  → GitHub webhook triggers Railway
  → Railway builds new container
  → Runs `npm install`
  → Starts server with `npm start`
  → Health check on /health
  → Switches traffic to new container
  → Old container terminated
```

**Deployment Time:** 1-2 minutes
**Zero-Downtime:** Railway switches traffic only after new container is healthy

---

### iOS Distribution (TestFlight)

**Build Process:**
1. Developer archives in Xcode: Product → Archive
2. Distribute App → App Store Connect
3. Upload to App Store Connect
4. Build processes (10-30 minutes)
5. Available in TestFlight
6. Testers receive notification
7. Install via TestFlight app

---

## Security Architecture

### Current Security Posture

**Authentication:**
- Sign in with Apple only
- No password storage
- Apple User ID as stable identifier

**Authorization:**
- Database-driven admin flag
- Per-request admin verification
- No session management or tokens

**Data Protection:**
- Parameterized SQL queries (no SQL injection)
- HTTPS enforced in production
- SSL database connections

**Known Gaps:**
- No rate limiting
- Open CORS (accepts all origins)
- No admin session management

**See:** [CLAUDE.md Security Considerations](../CLAUDE.md#security-considerations) for full details

---

## Next Steps

Now that you understand the architecture:

1. **Review code conventions:** Check [CLAUDE.md](../CLAUDE.md)
2. **Explore the code:** Open server.js and iOS files in your editor
3. **Make changes:** Follow best practices documented in CLAUDE.md

---

**Questions?** Check [CLAUDE.md](../CLAUDE.md) or ask your team lead.
