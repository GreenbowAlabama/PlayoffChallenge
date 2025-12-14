# Welcome to Playoff Challenge Development!

Welcome to the Playoff Challenge team! This wiki will guide you through getting your development environment set up and making your first contribution to our fantasy football playoff app.

## What is Playoff Challenge?

Playoff Challenge is a fantasy football application where users pick NFL players and compete for prizes based on real-time player performance during the NFL playoffs. Users can:

- Pick players for each playoff week
- Track live scores during games
- View leaderboards and compete with friends
- Manage payment and prize distribution

## Tech Stack at a Glance

| Component | Technology | Purpose |
|-----------|-----------|---------|
| iOS App | Swift/SwiftUI | Primary user interface |
| Backend API | Node.js/Express | REST API with live stats integration |
| Database | PostgreSQL | Hosted on Railway |
| Distribution | TestFlight | Beta testing and deployment |
| External APIs | ESPN API, Sleeper API | Live stats and player data |

## Architecture Overview

```
playoff-challenge/
├── backend/              # Node.js/Express API
│   ├── server.js         # Main API server (40+ endpoints)
│   └── schema.sql        # PostgreSQL schema
├── ios-app/PlayoffChallenge/
│   ├── Services/         # APIService, AuthService
│   ├── Models/           # Data models, ViewModels
│   └── Views/            # SwiftUI screens
└── CLAUDE.md             # Comprehensive technical documentation
```

## Your Onboarding Journey

Follow these pages in order to get started:

### 1. Prerequisites & Setup
**Start here:** [Prerequisites](Prerequisites.md)
- Required tools and accounts
- Estimated time: 15 minutes

### 2. Development Environment
**[Backend Setup](Backend-Setup.md)** - Get the Node.js API running locally
- Estimated time: 20 minutes

**[iOS Setup](iOS-Setup.md)** - Get the iOS app running in simulator
- Estimated time: 25 minutes

### 3. Understanding the System
**[Architecture Deep Dive](Architecture-Deep-Dive.md)** - How everything works together
- Estimated time: 30 minutes reading

### 4. Making Changes
**[Making Changes](Making-Changes.md)** - Branching, commits, and pull requests
- Estimated time: 10 minutes first time, 2 minutes after
- **Important:** Learn the proper workflow before making changes!

## Quick Links

- **Main Documentation**: [CLAUDE.md](../CLAUDE.md) - Comprehensive technical reference
- **Production API**: https://playoffchallenge-production.up.railway.app
- **Repository**: This is a public GitHub repository
- **Health Check**: https://playoffchallenge-production.up.railway.app/health

## Need Help?

- Check the troubleshooting section in [CLAUDE.md](../CLAUDE.md)
- Review detailed technical documentation in CLAUDE.md
- Ask questions in the team communication channel
- Tag experienced team members for code reviews

## Important Notes

- This is a **public GitHub repository** - never commit secrets or credentials
- All secrets are managed via Railway environment variables
- Manual testing only - no automated test suite currently exists
- Branch protection is enabled on the `backend` branch

---

**Ready to get started?** Head to [Prerequisites](Prerequisites.md) to begin your setup!
