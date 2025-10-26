# Playoff Challenge - Project Context

## Overview
Fantasy football playoff challenge app. Users pick players, compete with friends, manual payment tracking.

## Tech Stack
- **iOS**: Swift/SwiftUI (Xcode)
- **Backend**: Node.js + Express
- **Database**: PostgreSQL
- **Hosting**: Railway (backend + DB)
- **Distribution**: TestFlight
- **API**: Sleeper API for player data

## Key URLs
- Production API: https://playoffchallenge-production.up.railway.app
- GitHub: https://github.com/GreenbowAlabama/PlayoffChallenge
- TestFlight: [internal testing]

## Project Structure
```
playoff-challenge/
├── backend/          # Node.js API
│   ├── server.js
│   ├── schema.sql
│   └── package.json
├── ios-app/
│   └── PlayoffChallenge/
│       ├── Services/
│       │   ├── APIService.swift
│       │   └── AuthService.swift
│       ├── Models/
│       │   └── Models.swift
│       ├── Views/
│       │   ├── HomeView.swift
│       │   ├── PlayerSelectionView.swift
│       │   ├── MyPicksView.swift
│       │   ├── LeaderboardView.swift
│       │   ├── ProfileView.swift
│       │   ├── AdminView.swift
│       │   └── SignInView.swift
│       └── ViewModels/
│           └── PlayerViewModel.swift
```

## Database Schema
- **users**: Authentication, payment status, admin flag
- **players**: NFL players (from Sleeper API)
- **picks**: User player selections
- **scores**: Player points per week
- **game_settings**: Entry fee, payment handles, position limits

## Key Features Implemented
✅ Sign in with Apple
✅ Player selection with position limits
✅ Admin panel (user management, settings, player sync)
✅ Payment tracking (manual via Venmo/Cash App/Zelle)
✅ Leaderboard
✅ TestFlight distribution

## Configuration
- Position limits configurable by admin
- Entry amount: Configurable
- Payment methods: Admin sets handles
- Player data: Syncs from Sleeper API (top 2-3 per position per team)

## Deployment
- Backend: Push to `backend` branch → Railway auto-deploys
- iOS: Archive → Upload to App Store Connect → TestFlight

## Current Status 
- In TestFlight beta testing
- Ready for first playoff season
- ~150-200 quality players loaded

## Common Tasks
**Deploy backend changes:**
```bash
cd backend
git add .
git commit -m "Description"
git push origin backend
```

**Deploy iOS app:**
1. Update version in Xcode
2. Product → Archive
3. Distribute → App Store Connect → Upload

**Connect to production DB:**
```bash
psql "postgresql://[Railway connection string]"
```

**Sync players:**
Admin tab → Settings → "Sync Players from Sleeper API"