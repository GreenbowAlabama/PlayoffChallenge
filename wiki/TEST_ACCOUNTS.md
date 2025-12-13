# Test Accounts for TestFlight

## Shared Test Apple IDs

These Apple IDs are specifically created for TestFlight testing. Share these credentials with testers who don't want to use their personal Apple ID.

### How Testers Use These Accounts

1. **Install TestFlight** from the App Store (can use personal Apple ID for this)
2. **Open TestFlight app** → Tap profile icon (top right)
3. **Sign out** of personal Apple ID (if signed in)
4. **Sign in** with one of the test accounts below
5. **Accept invite** and install Playoff Challenge
6. **Open Playoff Challenge app**
7. **Sign in with Apple** using the SAME test Apple ID
8. Complete eligibility and TOS screens

### Test Account Credentials

| # | Email | Password | Status | Notes |
|---|-------|----------|--------|-------|
| 1 | playofftest1@icloud.com | TBD | Not Created | Primary test account |
| 2 | playofftest2@icloud.com | TBD | Not Created | |
| 3 | playofftest3@icloud.com | TBD | Not Created | |
| 4 | playofftest4@icloud.com | TBD | Not Created | |
| 5 | playofftest5@icloud.com | TBD | Not Created | |

**Password (same for all):** `PlayoffTest2025!`

---

## Creating Test Apple IDs

### Prerequisites
- A phone number for each account (can use Google Voice or similar)
- An alternate email for recovery (can use your personal email)

### Step-by-Step Guide

1. **Go to** https://appleid.apple.com/
2. **Click** "Create Your Apple ID"
3. **Fill out the form:**
   - Email: `playofftest1@icloud.com`
   - Password: `PlayoffTest2025!`
   - Security Questions: Keep consistent across all accounts for easy recovery
   - Phone Number: Use your phone or Google Voice
   - Birth Date: Use **January 1, 1990** (must be 18+)
   - Country: **United States**
4. **Verify email** (check the @icloud.com inbox at https://www.icloud.com/mail)
5. **Verify phone number**
6. **Complete setup**

### Adding to TestFlight

Once created, each Apple ID needs to be added to TestFlight:

1. **App Store Connect** → Playoff Challenge → TestFlight
2. **Internal Testing** → Click your test group
3. **Add Tester** → Enter the test Apple ID email
4. Tester will receive email invite at that @icloud.com address

### Post-Creation Checklist

For each test account:
- [ ] Apple ID created and verified
- [ ] Added to TestFlight internal testing group
- [ ] Tested: Can install app via TestFlight
- [ ] Tested: Can sign in to app with Apple Sign In
- [ ] Tested: Can complete eligibility flow
- [ ] Set to paid/admin status in database (if needed for testing)

---

## Managing Test Accounts

### Resetting a Test Account

If you need to test fresh signup flow again:

```bash
# Delete user from database
psql "$DATABASE_URL" -c "DELETE FROM users WHERE apple_id = '<apple-user-id-from-signin>';"

# Or use the script
cd scripts
DATABASE_URL="postgresql://..." ./delete-test-user.sh "playofftest1@icloud.com"
```

### Setting Admin/Paid Status

```sql
-- Make test account an admin with paid status
UPDATE users
SET is_admin = true, paid = true
WHERE apple_id = '<apple-user-id>';
```

### Finding Apple User ID

The Apple User ID is generated during first sign-in and looks like:
```
001234.abc123def456.0789
```

Check the database:
```sql
SELECT id, username, apple_id, email, state
FROM users
WHERE username LIKE 'User_%'
ORDER BY created_at DESC;
```

---

## Tips for Testers

### Common Issues

**Q: TestFlight shows "This beta isn't accepting any new testers right now"**
- A: Contact admin to add your test Apple ID to TestFlight group

**Q: Can't remember which test account I used**
- A: Check with admin - they can see which accounts are in use

**Q: App crashes on sign in**
- A: Make sure you're signed into TestFlight with the SAME Apple ID you're using in the app

**Q: Stuck on eligibility screen**
- A: Don't select a restricted state (NV, HI, ID, MT, WA). Select any other state.

### Best Practices

- **Keep test account signed in** on your device to avoid password hassles
- **Use same test account** for both TestFlight and app sign-in
- **Don't use these for personal iCloud data** - they're shared testing accounts

---

## Security Notes

- These are PUBLIC test accounts - everyone has the password
- Do NOT store personal data, photos, contacts, etc.
- Do NOT enable iCloud backups or sync
- Do NOT use these accounts for anything besides Playoff Challenge testing
- Passwords can be changed if accounts get compromised

---

## Alternative: Personal Apple ID Testing

If testers prefer to use their personal Apple ID:

1. They still need access to their iCloud password
2. They'll need to enable 2FA if not already enabled
3. Their email/name may not populate in the app (Apple privacy)
4. They can update their profile in-app after signup

The shared test accounts are recommended for easier onboarding.
