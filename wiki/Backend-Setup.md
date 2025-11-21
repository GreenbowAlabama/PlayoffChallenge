# Backend Setup

This guide will help you set up and run the Node.js backend API locally.

⏱️ **Estimated time:** 20 minutes

## Overview

By the end of this guide, you will:
- Clone the repository
- Install backend dependencies
- Configure environment variables
- Run the API server locally
- Verify the server is working

---

## Step 1: Clone the Repository

If you haven't already cloned the repository during prerequisites:

```bash
# Navigate to where you want to store the project
cd ~/Documents/workspace

# Clone the repository
git clone https://github.com/GreenbowAlabama/PlayoffChallenge.git

# Navigate into the project
cd playoff-challenge
```

**Expected output:**
```
Cloning into 'playoff-challenge'...
remote: Enumerating objects: ...
```

---

## Step 2: Navigate to Backend Directory

```bash
cd backend
```

**Verify you're in the right place:**
```bash
ls
```

**Expected output:**
You should see files including:
- `server.js` (the main API server)
- `schema.sql` (database schema)
- `package.json` (dependencies)

---

## Step 3: Install Dependencies

```bash
npm install
```

**Expected output:**
```
added 150+ packages in Xs
```

**Verify installation:**
```bash
ls node_modules
```

You should see many folders including: `express`, `pg`, `cors`, `dotenv`, etc.

⏱️ **Note:** This may take 1-2 minutes depending on your internet connection.

---

## Step 4: Configure Environment Variables

The backend needs to connect to the PostgreSQL database. We'll use a `.env` file for local development.

### Create .env file

```bash
touch .env
```

### Add environment variables

Open the `.env` file in your editor:

```bash
# If using VS Code
code .env

# Or use any text editor
nano .env
```

Add the following configuration:

```env
# Database connection (get this from Railway dashboard or team lead)
DATABASE_URL=postgresql://username:password@host:port/database

# Server port (optional, defaults to 8080)
PORT=8080

# Environment (optional, use 'development' for local work)
NODE_ENV=development
```

**Where to get DATABASE_URL:**
1. Log in to [Railway dashboard](https://railway.app/dashboard)
2. Open the Playoff Challenge project
3. Click on the PostgreSQL service
4. Go to "Connect" tab
5. Copy the "Postgres Connection URL"

**Security reminder:**
- The `.env` file is in `.gitignore` - it will never be committed
- Never commit database credentials to the repository
- This is a public repository - all secrets stay in Railway or local `.env`

---

## Step 5: Verify Database Connection

Test that you can connect to the database:

```bash
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM users;"
```

**Expected output:**
```
 count
-------
     5
(1 row)
```

**Troubleshooting:** If you see "connection refused" or "authentication failed":
- Double-check your DATABASE_URL is correct
- Ensure there are no extra spaces or line breaks
- Verify your Railway project access with your team lead

---

## Step 6: Start the Development Server

```bash
npm run dev
```

**Expected output:**
```
[nodemon] starting `node server.js`
Server is running on port 8080
Database connected successfully
Background stats update is disabled in non-production environment
```

**What this means:**
- `nodemon` watches for file changes and auto-restarts the server
- Server runs on port 8080 (or whatever you set in PORT)
- Database connection is successful
- Background polling is disabled locally (only runs in production)

⏱️ **Note:** The server will keep running. Open a new terminal tab for other commands.

---

## Step 7: Verify the Server is Running

### Test 1: Health Check Endpoint

In a **new terminal tab**, run:

```bash
curl http://localhost:8080/health
```

**Expected output:**
```json
{
  "status": "ok",
  "timestamp": "2025-01-20T12:34:56.789Z"
}
```

### Test 2: Game Config Endpoint

```bash
curl http://localhost:8080/api/game-config
```

**Expected output:**
```json
{
  "entryFee": 25,
  "currentWeek": 1,
  "playoffStartWeek": 19,
  "positionRequirements": [...]
}
```

### Test 3: Players Endpoint

```bash
curl http://localhost:8080/api/players
```

**Expected output:**
A JSON array of player objects with names, teams, positions, etc.

✅ **Success!** If all three tests pass, your backend is running correctly!

---

## Understanding the Backend Structure

### Main File: server.js

The entire API is in one file (`server.js`) with:
- **2,246 lines of code**
- **40+ API endpoints**
- **In-memory caching** for performance
- **Direct PostgreSQL queries** (no ORM)

**Key sections:**
1. **Lines 1-40**: Imports, database connection, cache setup
2. **Lines 41-129**: Helper functions (ESPN mapping, stats parsing)
3. **Lines 130+**: API endpoint definitions
4. **Bottom**: Server startup and background polling

### Database Schema: schema.sql

Contains all table definitions, functions, and views:
- `users` - User accounts (Apple ID authentication)
- `players` - NFL player roster
- `picks` - User player selections
- `scores` - Player fantasy points
- `game_settings` - Configurable parameters
- And more...

**Applying schema changes:**
```bash
psql "$DATABASE_URL" < schema.sql
```

**Warning:** This will modify the production database. Only run if you know what you're doing!

---

## Common Development Commands

### Start server (production mode)
```bash
npm start
```

Uses `node` directly (no auto-reload).

### Start server (development mode with auto-reload)
```bash
npm run dev
```

Uses `nodemon` - server restarts when you save files.

### Connect to database
```bash
psql "$DATABASE_URL"
```

Opens an interactive PostgreSQL prompt.

### Run a SQL query
```bash
psql "$DATABASE_URL" -c "SELECT * FROM users LIMIT 5;"
```

---

## Next Steps

Now that your backend is running, you can:

1. **Set up the iOS app:** [iOS Setup](iOS-Setup.md)
2. **Understand the architecture:** [Architecture Deep Dive](Architecture-Deep-Dive.md)
3. **Explore endpoints:** Check [CLAUDE.md](../CLAUDE.md) for full API reference

---

## Troubleshooting

### Port already in use

**Error:** `EADDRINUSE: address already in use :::8080`

**Solution:**
```bash
# Find process using port 8080
lsof -i :8080

# Kill the process
kill -9 <PID>

# Or change the port in .env
PORT=3000
```

### Database connection errors

**Error:** `Connection refused` or `authentication failed`

**Solutions:**
1. Verify DATABASE_URL is correct (no extra spaces)
2. Test connection: `psql "$DATABASE_URL" -c "SELECT 1;"`
3. Check Railway database is running in dashboard
4. Ensure you're connected to the internet

### Module not found errors

**Error:** `Cannot find module 'express'`

**Solution:**
```bash
# Delete node_modules and reinstall
rm -rf node_modules package-lock.json
npm install
```

---

**Need more help?** Check [CLAUDE.md](../CLAUDE.md) troubleshooting section or ask your team lead.
