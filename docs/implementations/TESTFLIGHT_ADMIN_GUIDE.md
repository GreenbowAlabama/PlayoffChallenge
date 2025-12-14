# TestFlight Admin Guide - Adding Test Users

## Quick Steps to Add Test Users in App Store Connect

### 1. Create the Test Apple IDs First

Before you can add them to TestFlight, create the Apple IDs:

**Go to:** https://appleid.apple.com/account

For each test account:
- Email: `playofftest1@icloud.com`, `playofftest2@icloud.com`, etc.
- Password: `PlayoffTest2025!` (same for all)
- Birth Date: January 1, 1990 (must be 18+)
- Country: United States
- Security Questions: Pick the same answers for all accounts
- Phone: You can use your own phone number or Google Voice

**Important:** You'll need to verify the email. Sign in at https://www.icloud.com/mail to check verification emails.

---

## 2. Add Test Users to App Store Connect

### Navigate to TestFlight

1. Go to **https://appstoreconnect.apple.com/**
2. Sign in with your developer Apple ID
3. Click **"My Apps"**
4. Select **"Playoff Challenge"** (or your app name)
5. Click the **"TestFlight"** tab at the top

### Add to Internal Testing (Recommended)

**Internal testing = unlimited installs, instant access, no review**

1. On the TestFlight page, look for **"Internal Testing"** in the left sidebar
2. Click your test group (create one if it doesn't exist):
   - Click **"+ "** next to "Internal Testing"
   - Name it: "Test Team" or "Shared Test Accounts"
3. Click the test group name to open it
4. Click **"Testers"** tab (or the **"+"** button)
5. Click **"Add Internal Testers"**
6. In the dialog:
   - First Name: Test
   - Last Name: User 1 (or User 2, User 3, etc.)
   - Email: `playofftest1@icloud.com`
   - Click **"Add"**
7. Repeat for all 5 test accounts

### OR Add to External Testing (Not Recommended)

**External testing = requires app review, slower**

1. Click **"External Testing"** in left sidebar
2. Create a group or select existing
3. Click **"+ "** to add testers
4. Enter the test Apple ID emails
5. Submit for beta review (takes 24-48 hours)

**Skip this unless you need to test the App Review process.**

---

## 3. Verify Test Users Were Added

After adding testers:

1. Go back to your test group in **Internal Testing**
2. You should see all 5 test accounts listed
3. Each will show status: "Invited" → "Installed" once they accept

---

## 4. Send Invite Links (Optional)

TestFlight automatically sends email invites to the test Apple IDs. But you can also get a public link:

1. In your test group, look for **"Public Link"** section
2. Click **"Enable Public Link"**
3. Copy the link
4. Share this link with testers

Testers can click the link to accept the invite directly (must be signed into TestFlight with the test Apple ID).

---

## 5. Upload a Build (If You Haven't)

If you haven't uploaded a build yet:

### In Xcode:
1. Open your project
2. Select **"Any iOS Device"** as destination
3. Go to **Product → Archive**
4. Once archive completes, click **"Distribute App"**
5. Select **"App Store Connect"**
6. Follow prompts → **"Upload"**
7. Wait 5-10 minutes for processing

### In App Store Connect:
1. Once build is processed, go to TestFlight tab
2. The build will appear under **"Builds"** on the left
3. Add the build to your test group:
   - Click your test group
   - Click **"Builds"** tab (or the **"+"** next to builds)
   - Select your build
   - Click **"Add"**

Testers can now install this build.

---

## 6. Managing Test Users

### Check Who Has Installed

1. Go to your test group in TestFlight
2. Look at the tester list
3. Status shows: Invited / Installed / Testing

### Remove a Test User

1. Go to test group
2. Find the tester in the list
3. Click the **"..."** menu next to their name
4. Click **"Remove from Group"**

### Resend Invite

1. Find the tester
2. Click **"..."** menu
3. Click **"Resend Invite"**

---

## Summary Checklist

- [ ] Created 5 test Apple IDs (playofftest1-5@icloud.com)
- [ ] Logged into App Store Connect
- [ ] Navigated to: My Apps → Playoff Challenge → TestFlight
- [ ] Created Internal Testing group (if doesn't exist)
- [ ] Added all 5 test Apple IDs to internal testing group
- [ ] Uploaded a build via Xcode
- [ ] Added build to test group
- [ ] (Optional) Enabled public link and shared with testers
- [ ] Testers can now install and test the app!

---

## Sharing Credentials with Testers

Send testers this info:

```
TestFlight Test Account Credentials:

Pick any one of these:
- playofftest1@icloud.com
- playofftest2@icloud.com
- playofftest3@icloud.com
- playofftest4@icloud.com
- playofftest5@icloud.com

Password (same for all): PlayoffTest2025!

Instructions:
1. Install TestFlight from App Store
2. Open TestFlight, sign in with one of these accounts
3. Accept invite for "Playoff Challenge"
4. Open the app, sign in with Apple using THE SAME account
5. Complete signup (pick any state except NV, HI, ID, MT, WA)

Questions? Let me know!
```

---

## Troubleshooting

**"User already exists"**
- The email is already registered as a tester
- Check if they're already in another test group

**Build not showing for testers**
- Make sure build is added to the test group (step 5)
- Check build status isn't "Processing" or "Missing Compliance"

**Tester can't accept invite**
- Make sure they're signed into TestFlight with the exact test Apple ID
- Resend the invite from App Store Connect

**Need more than 5 test accounts?**
- Internal testing supports up to 100 testers
- Just create more Apple IDs: playofftest6@icloud.com, etc.
