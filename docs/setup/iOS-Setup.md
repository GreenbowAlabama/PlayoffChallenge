# iOS Setup

This guide will help you set up and run the iOS app in Xcode simulator.

⏱️ **Estimated time:** 25 minutes

## Prerequisites

Before starting, ensure you have:
- [ ] Completed [Prerequisites](Prerequisites.md)
- [ ] Xcode 15.0+ installed
- [ ] Apple ID configured

**Backend:** You can either run the backend locally ([Backend Setup](Backend-Setup.md)) or use the production API.

---

## Overview

By the end of this guide, you will:
- Open the Xcode project
- Configure API endpoint
- Build the app
- Run in iOS simulator
- Sign in and test functionality

---

## Step 1: Navigate to iOS Project

From the repository root:

```bash
cd ios-app/PlayoffChallenge
```

**Verify you're in the right place:**
```bash
ls
```

**Expected output:**
You should see:
- `PlayoffChallenge.xcodeproj` (Xcode project file)
- `PlayoffChallenge/` directory (source code)

---

## Step 2: Open Project in Xcode

```bash
open PlayoffChallenge.xcodeproj
```

**Alternative:** Double-click `PlayoffChallenge.xcodeproj` in Finder

Xcode will open and load the project. This may take a moment on first launch.

---

## Step 3: Configure API Endpoint

The iOS app needs to know where to find the backend API. You have two options:

### Option A: Use Production API (Easiest)

**Keep the default value in APIService.swift:**
```swift
private let baseURL = "https://playoffchallenge-production.up.railway.app"
```

**Pros:** No local backend needed, always available
**Cons:** Shares data with production users

---

### Option B: Use Local Backend (For Development)

If you completed [Backend Setup](Backend-Setup.md) and have the server running locally:

**1. Find APIService.swift**
- In Xcode's left sidebar (Navigator), expand: `PlayoffChallenge` → `Services`
- Click on `APIService.swift`

**2. Locate the baseURL property** (around line 10-15):

```swift
class APIService {
    private let baseURL = "https://playoffchallenge-production.up.railway.app"
    // ...
}
```

**3. Change it to your local server:**

```swift
class APIService {
    private let baseURL = "http://localhost:8080"
    // ...
}
```

**Important:**
- Use `http` (not `https`) for localhost
- Use port `8080` (or whatever you set in backend `.env`)
- Make sure your backend server is running (`npm run dev` in backend folder)

---

## Step 4: Configure Signing & Capabilities

Xcode needs to sign the app to run on simulator or device.

**1. Select the project** in Xcode's left sidebar (top item: PlayoffChallenge in blue)

**2. Select the target** "PlayoffChallenge" under TARGETS

**3. Go to "Signing & Capabilities" tab**

**4. Configure Team:**
- Check "Automatically manage signing"
- Under "Team", select your Apple Developer team
  - If you see "Add an Account...", click it and sign in with your Apple ID
  - If you're part of the team, select the team name
  - If developing solo, select your personal team

**5. Verify Bundle Identifier:**
- Should be: `com.greenbowalabama.PlayoffChallenge`
- If there's a signing error, you may need to change this to a unique identifier:
  - Example: `com.YOURNAME.PlayoffChallenge`

**6. Check "Sign in with Apple" capability:**
- This should already be configured
- You should see "Sign in with Apple" in the capabilities list

---

## Step 5: Select a Simulator

**1. At the top of Xcode, find the device selector** (next to the Play button)

**2. Click it and select a simulator:**
- Recommended: "iPhone 15 Pro" or "iPhone 15"
- iOS 17.0+ is recommended

**3. If you don't see any simulators:**
- Click "Download Simulators..."
- Download "iOS 17.x Simulator"
- Wait for download to complete (may take 5-10 minutes)

---

## Step 6: Build and Run

**1. Click the Play button** (▶) at the top left of Xcode

**Or press:** `Cmd + R`

**What happens:**
1. Xcode compiles the Swift code (may take 1-2 minutes on first build)
2. iOS Simulator launches
3. App installs and opens automatically

**Expected output in Xcode console:**
```
Build succeeded
Running on iPhone 15 Pro
```

⏱️ **Note:** First build takes 1-3 minutes. Subsequent builds are much faster (10-30 seconds).

---

## Step 7: Test the App

### Sign In Flow

When the app launches, you should see:

1. **Sign In with Apple button**
   - In simulator, you'll use a test Apple ID
   - Click "Sign In with Apple"
   - Choose "Use Password" (simulator doesn't support Face ID for Apple Sign In)
   - Enter your Apple ID credentials
   - If prompted, trust the simulator

2. **User created successfully**
   - The app sends your Apple User ID to the backend
   - Backend creates or retrieves your user account
   - You're logged in!

### Navigate the App

Once signed in, you should see tabs:

**Home Tab:**
- Dashboard with current week info
- Quick overview of your picks
- Entry fee and prize pool info

**My Picks Tab:**
- Select your players for each week
- View position requirements (1 QB, 2 RB, 2 WR, 1 TE, 1 K, 1 DEF)
- Submit picks for current week

**Leaderboard Tab:**
- View rankings
- See other players' scores
- Check your standing

**Profile Tab:**
- View your user info
- Payment status
- Settings
- Sign out

---

## Step 8: Make a Test Pick

Let's verify the app is working correctly:

**1. Go to "My Picks" tab**

**2. Tap on a position** (e.g., "QB")

**3. You should see a list of NFL quarterbacks**
- If you see players, your API connection is working!
- If you see "No players available", check your API endpoint configuration

**4. Select a player** by tapping on them

**5. Repeat for other positions** until you have a complete roster

**6. Tap "Submit Picks"**

**7. Go back to "Home"** - you should see your picks displayed

✅ **Success!** Your iOS app is fully functional!

---

## Understanding the iOS App Structure

### Key Directories

```
PlayoffChallenge/
├── PlayoffChallengeApp.swift  # App entry point
├── Views/                      # All SwiftUI screens
│   ├── ContentView.swift       # Main tab navigation
│   ├── HomeView.swift          # Dashboard
│   ├── PlayerSelectionView.swift  # Pick players
│   ├── MyPickView.swift        # View/manage picks
│   ├── LeaderboardView.swift   # Rankings
│   ├── ProfileView.swift       # User settings
│   ├── AdminView.swift         # Admin panel
│   └── SignInView.swift        # Apple Sign In
├── Services/                   # Business logic
│   ├── APIService.swift        # REST API client
│   └── AuthService.swift       # Sign in with Apple
├── Models/                     # Data structures
│   ├── Models.swift            # All model definitions
│   └── PlayerViewModel.swift   # Player selection logic
└── Assets.xcassets/            # Images, colors, icons
```

---

## Next Steps

Now that your iOS app is running:

1. **Understand the architecture:** [Architecture Deep Dive](Architecture-Deep-Dive.md)
2. **Explore the codebase:** Review the key files mentioned above
3. **Review technical docs:** Check [CLAUDE.md](../CLAUDE.md) for full details

---

## Troubleshooting

### Build Fails: "No signing certificate found"

**Solution:**
1. Xcode → Settings → Accounts
2. Add your Apple ID if not present
3. Select your Apple ID → Download Manual Profiles
4. In Signing & Capabilities, select your team again

### Simulator Crashes or Hangs

**Solution:**
1. Close simulator completely
2. Xcode → Product → Clean Build Folder (`Cmd + Shift + K`)
3. Rebuild (`Cmd + R`)

**If still crashing:**
```bash
# Reset simulator
xcrun simctl erase all
```

### "No players available" in player selection

**Possible causes:**
1. API endpoint is wrong (check APIService.swift `baseURL`)
2. Backend server isn't running (if using localhost)
3. Network error (check Xcode console for errors)

**Debug steps:**
1. Check Xcode console for API errors
2. Test API directly: `curl http://localhost:8080/api/players`
3. Verify backend is running: `curl http://localhost:8080/health`

### Sign in with Apple fails in simulator

**Error:** "Apple ID not found" or "Authentication failed"

**Solution:**
1. On your Mac, sign in to iCloud (System Settings → Apple ID)
2. In simulator: Settings → Sign in with Apple ID
3. Use the same Apple ID as your Mac
4. Try signing in again in the app

**Alternative:** Use the production API endpoint - signing works more reliably

---

**Need more help?** Check [CLAUDE.md](../CLAUDE.md) or ask your team lead.
