# Prerequisites

Before you begin development, you'll need to set up some tools and accounts. This page will guide you through everything you need.

⏱️ **Estimated time:** 15 minutes

## Opening Terminal on Mac

All commands in this guide are run in Terminal.

**To open Terminal:**
1. Press `Cmd + Space` to open Spotlight
2. Type "Terminal"
3. Press `Enter`

---

## Required Tools

### 1. macOS Development Machine

**Why:** iOS development requires Xcode, which only runs on macOS.

**Verify you have macOS:**

Open Terminal and run:
```bash
sw_vers
```

**Expected output:**
```
ProductName:        macOS
ProductVersion:     13.0 or later
BuildVersion:       ...
```

You should see macOS version 13.0 or later for best compatibility. macOS 15.0+ works great.

---

### 2. Xcode (Version 15.0+)

**Why:** Required for building and running the iOS app.

**Install:**
1. Open the Mac App Store
2. Search for "Xcode"
3. Click "Get" or "Update"
4. Wait for installation to complete (may take 30+ minutes, it's a large download)

**After installation, set the developer directory:**

This is a critical step that's often missed!

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
```

You'll be prompted for your Mac password. Type it and press Enter.

**Verify installation:**
```bash
xcodebuild -version
```

**Expected output:**
```
Xcode 15.0 or later (Xcode 26.1.1 works great!)
Build version ...
```

**If you see an error like:**
```
xcode-select: error: tool 'xcodebuild' requires Xcode, but active developer directory '/Library/Developer/CommandLineTools' is a command line tools instance
```

**Fix it by running:**
```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
```

**Install Command Line Tools:**
```bash
xcode-select --install
```

**Note:** If you see "Command line tools are already installed", that's fine! The tools are installed, you just needed to set the developer directory above.

---

### 3. Node.js (Version 18.0+)

**Why:** Required for running the backend API server.

**Install Homebrew (if you don't have it):**
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

**Install Node.js:**
```bash
brew install node
```

**Verify installation:**
```bash
node --version
npm --version
```

**Expected output:**
```
v18.x.x or higher
9.x.x or higher
```

---

### 4. PostgreSQL Client (psql)

**Why:** Used to connect to the production database and run SQL commands.

**Install:**
```bash
brew install postgresql@16
```

**Verify installation:**
```bash
psql --version
```

**Expected output:**
```
psql (PostgreSQL) 15.x or higher
```

**Note:** You don't need to run a local PostgreSQL server - we'll connect to Railway's hosted database.

---

### 5. Git

**Why:** Version control for all code changes.

**Verify installation (usually pre-installed on macOS):**
```bash
git --version
```

**Configure Git (if not already done):**
```bash
git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"
```

---

## Required Accounts

### 1. GitHub Account

**Why:** Access the repository and collaborate with the team.

**Sign up:** [github.com](https://github.com)

**Request repository access:**
- Ask your team lead to add you as a collaborator
- Accept the invitation email from GitHub

**Verify access:**

Create a workspace directory and clone the repository:

```bash
mkdir -p ~/Documents/workspace
cd ~/Documents/workspace
git clone https://github.com/GreenbowAlabama/PlayoffChallenge.git
cd playoff-challenge
```

You should be able to clone the repository without errors.

---

### 2. Railway Account

**Why:** Access production database, view logs, and manage deployments.

**Sign up:** [railway.app](https://railway.app)
- Use "Sign in with GitHub" for easiest setup

**Request project access:**
- Ask your team lead to invite you to the Playoff Challenge project
- Accept the invitation email

**Verify access:**
1. Go to [railway.app/dashboard](https://railway.app/dashboard)
2. You should see "Playoff Challenge" in your projects list

---

### 3. Apple Developer Account

**Why:** Required for TestFlight distribution and Sign in with Apple.

**Two tiers:**

**Option A: Free Apple ID** (for basic development)
- Good for: Xcode development, simulator testing
- Limitations: 7-day app signing, cannot distribute to TestFlight
- Sign up: [appleid.apple.com](https://appleid.apple.com)

**Option B: Apple Developer Program** ($99/year) (for distribution)
- Good for: TestFlight distribution, App Store submission
- Required for: Uploading builds to TestFlight
- Sign up: [developer.apple.com/programs](https://developer.apple.com/programs)

**Request team access:**
- Ask your team lead to add you to the Apple Developer team
- You'll receive an invitation via email

---

## Optional but Recommended Tools

### 1. Code Editor (if not using Xcode for backend work)

**VS Code (recommended for backend development):**
```bash
brew install --cask visual-studio-code
```

**Useful extensions:**
- ESLint
- Prettier
- PostgreSQL (for SQL syntax highlighting)

---

### 2. Postman or Insomnia

**Why:** Test API endpoints during development.

**Install Postman:**
```bash
brew install --cask postman
```

**Alternative:** Use curl (already installed on macOS)

---

### 3. TablePlus or pgAdmin

**Why:** Visual database client for exploring PostgreSQL data.

**Install TablePlus (recommended):**
```bash
brew install --cask tableplus
```

---

## Verification Checklist

Before proceeding, verify you have:

- [ ] macOS 13.0+ running
- [ ] Xcode 15.0+ installed
- [ ] Node.js 18.0+ installed
- [ ] PostgreSQL client (psql) installed
- [ ] Git configured with your name and email
- [ ] GitHub account with repository access
- [ ] Railway account with project access
- [ ] Apple ID (Developer Program membership if distributing)

---

## Environment Variables You'll Need

You'll need these values from your team lead. Save them securely (we'll use them in the next steps):

- [ ] `DATABASE_URL` - PostgreSQL connection string for development
  - Format: `postgresql://username:password@host:port/database`
  - **Where to get it:** Railway dashboard → Playoff Challenge → PostgreSQL → Connect → Connection String

---

## Next Steps

Once you've completed this checklist, you're ready to set up your development environment!

**Continue to:** [Backend Setup](Backend-Setup.md)

---

## Troubleshooting Prerequisites

### "Command not found" errors

If you get "command not found" after installing via Homebrew, you may need to add Homebrew to your PATH:

```bash
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
eval "$(/opt/homebrew/bin/brew shellenv)"
```

### Xcode Command Line Tools issues

If `xcode-select --install` fails, try:

```bash
sudo rm -rf /Library/Developer/CommandLineTools
sudo xcode-select --install
```

### Node.js version issues

If you need to manage multiple Node.js versions, consider using `nvm`:

```bash
brew install nvm
# Follow the setup instructions printed after installation
nvm install 18
nvm use 18
```

---

**Need help?** Reach out to your team lead or check the troubleshooting section in [CLAUDE.md](../CLAUDE.md).
