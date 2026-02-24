# Email/Password Authentication Guide

## Overview

Email/password authentication has been added **for TestFlight testing only**. This makes it much easier to onboard testers without requiring Apple IDs or phone numbers.

**Status:** ✅ Fully implemented and ready to test
**Build Status:** ✅ iOS app builds successfully
**Backend Status:** ✅ Endpoints deployed and ready

---

## What Was Added

### Database (Phase 1)
- ✅ `password_hash` column added to users table
- ✅ `auth_method` column added (tracks 'apple' vs 'email')
- ✅ Unique constraint on email
- ✅ apple_id made nullable in users and signup_attempts tables

### Backend (Phase 2)
- ✅ bcrypt installed for password hashing
- ✅ `POST /api/auth/register` - Email/password registration with compliance
- ✅ `POST /api/auth/login` - Email/password login
- ✅ All compliance features work with email auth (state blocking, IP audit, TOS)

### iOS (Phase 3)
- ✅ `EmailSignInView.swift` - New view with email/password forms
- ✅ `APIService.swift` - `registerWithEmail()` and `loginWithEmail()` methods
- ✅ `AuthService.swift` - Email auth logic integrated
- ✅ `SignInView.swift` - Shows email option below Apple Sign In (DEBUG only)
- ✅ All wrapped in `#if DEBUG` - **invisible in production builds**

---

## How Testers Use It

### For New Testers

1. **Install app from TestFlight**
2. **Open app** → See sign in screen
3. **Scroll down** → See "OR" divider and email/password fields
4. **Enter details:**
   - Email: `tester1@test.com`
   - Password: `password123`
   - Tap **"Sign Up"**
5. **Complete eligibility form:**
   - Enter name (optional)
   - Select state (not NV, HI, ID, MT, WA)
   - Check all confirmations
   - Tap **"Create Account"**
6. **Accept TOS** → Done!

### For Existing Testers

1. **Open app** → See sign in screen
2. **Enter existing email/password**
3. **Tap "Sign In"** → Done!

---

## Tester Credentials Template

Send this to testers:

```
Playoff Challenge - TestFlight Sign Up

No Apple ID needed! Just use email/password:

1. Install from TestFlight
2. Open the app
3. Scroll down to "Sign Up with Email"
4. Enter:
   - Email: your-email@example.com
   - Password: password123 (or any password 6+ characters)
5. Fill out eligibility form (pick any state except NV, HI, ID, MT, WA)
6. Accept Terms of Service
7. Start testing!

You can create as many accounts as you want for testing different scenarios.
```

---

## API Endpoints

### Register New User
```bash
POST /api/auth/register
Content-Type: application/json

{
  "email": "tester@test.com",
  "password": "password123",
  "name": "Test User",  // optional
  "state": "TX",
  "eligibility_certified": true,
  "tos_version": "2025-12-12"
}

# Response: User object (without password_hash)
```

### Login Existing User
```bash
POST /api/auth/login
Content-Type: application/json

{
  "email": "tester@test.com",
  "password": "password123"
}

# Response: User object (without password_hash)
```

---

## Testing Checklist

### Email Registration Flow
- [ ] Enter email/password, tap "Sign Up"
- [ ] Eligibility form appears
- [ ] Select state, check confirmations
- [ ] Tap "Create Account" → User created
- [ ] TOS screen appears
- [ ] Accept TOS → Main app loads
- [ ] User can make picks, view leaderboard, etc.

### Email Login Flow
- [ ] Enter existing email/password
- [ ] Tap "Sign In" → User logged in
- [ ] Main app loads with user's data
- [ ] Picks, scores all work normally

### Error Handling
- [ ] Try duplicate email → Shows error
- [ ] Try wrong password → Shows error
- [ ] Try restricted state → Blocked with message
- [ ] Missing fields → Shows validation error

### Production Build Check
- [ ] Build for production/archive
- [ ] Email/password UI should NOT appear
- [ ] Only Apple Sign In button visible
- [ ] No DEBUG code in archive

---

## Database Queries

### View Email Users
```sql
SELECT id, email, username, auth_method, state, created_at
FROM users
WHERE auth_method = 'email'
ORDER BY created_at DESC;
```

### View All Auth Methods
```sql
SELECT
  auth_method,
  COUNT(*) as user_count
FROM users
GROUP BY auth_method;
```

### Check User Auth Type
```sql
SELECT
  id,
  email,
  apple_id,
  auth_method,
  CASE
    WHEN password_hash IS NOT NULL THEN 'Has Password'
    ELSE 'No Password'
  END as password_status
FROM users
WHERE email = 'tester@test.com';
```

---

## Removing Before App Store Launch

When ready to submit to App Store:

1. **Remove `#if DEBUG` blocks:**
   - SignInView.swift - lines 32-48
   - EmailSignInView.swift - entire file can be deleted
   - APIService.swift - lines 140-251
   - AuthService.swift - lines 131-209

2. **Or keep code but ensure production build:**
   - Xcode → Product → Scheme → Edit Scheme
   - Run → Build Configuration → **Release**
   - Archive uses Release by default
   - `#if DEBUG` code won't be compiled

3. **Backend endpoints can stay:**
   - No harm keeping them (just won't be used)
   - Or comment them out with:
     ```javascript
     // REMOVED FOR APP STORE - Email auth (TestFlight only)
     ```

---

## Security Notes

### Password Storage
- Passwords hashed with bcrypt (10 salt rounds)
- Password hashes NEVER returned in API responses
- Login requires exact email + password match

### Compliance
- Same state restrictions apply (NV, HI, ID, MT, WA blocked)
- IP state logging for audit trail
- TOS acceptance required
- All signup attempts logged in `signup_attempts` table

### Email Validation
- Emails stored lowercase for consistency
- Unique constraint prevents duplicates
- No email verification (TestFlight only feature)

---

## Troubleshooting

**Email option not showing:**
- Check you're running DEBUG build (not Release)
- TestFlight builds are DEBUG by default
- Production/App Store builds won't show email auth

**"Email already registered" error:**
- Email is already in use
- Either login with that email or use different email
- Check database: `SELECT * FROM users WHERE email = 'email@test.com'`

**Password requirements:**
- Minimum 6 characters
- No special requirements for testing
- Change in APIService if needed

**Restricted state error:**
- User selected NV, HI, ID, MT, or WA
- Pick a different state to continue

---

## Summary

✅ **Database:** Ready
✅ **Backend:** Deployed
✅ **iOS:** Built successfully
✅ **TestFlight Only:** Won't appear in production
✅ **Easy Testing:** No Apple ID or phone number needed

**Next Steps:**
1. Deploy backend to Railway (push to backend branch)
2. Archive iOS app and upload to TestFlight
3. Share tester credentials (see template above)
4. Test complete flow end-to-end
5. Onboard testers easily!
