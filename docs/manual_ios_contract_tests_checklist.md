# CLIENT LOCK V1 — Manual QA Script (Staging Only)

Environment:
- Backend: Staging
- Device: iOS Simulator
- No local mocks
- Kill app between major flow tests

---

## STEP 0 — Login Flow

1. Open the iOS app.
2. Enter credentials.
3. Tap Login.

Verify:
- Home screen loads successfully.
- No errors displayed.
- Network call completes successfully.

---

## STEP 1 — Available Contests Flow

1. Tap "Available Contests".
2. Verify Contest List screen appears.

You should see:
- Contest Name
- Status
- Entry Fee

Now:

3. Tap a joinable contest.

Verify:
- Contest Detail screen opens.
- Join button visible if can_join = true
- Edit button visible if can_edit_entry = true
- Share button visible if can_share_invite = true
- Manage controls visible only if can_manage_contest = true
- Lifecycle display matches backend flags

Kill app after completing this flow.

---

## STEP 2 — Create Contest Flow

1. Tap "Create Contest".
2. Verify Create Contest screen appears.

You should see:
- Contest Name input
- Contest Type selector
- Entry Fee input
- Max Entries input
- Lock / Start / End time pickers

Now:

3. Fill all required fields.
4. Verify Create button enables only when valid.

5. Tap Create.

Verify:
- Contest successfully created.
- You are redirected to Contest Detail.
- Manage controls visible (organizer only).

Kill app after completing this flow.

---

## STEP 3 — Contest Management Flow

1. Open a contest where you are organizer.
2. Tap Manage / Edit.

Verify:
- Editable fields enabled when can_manage_contest = true
- Save button enabled only after valid edits
- Cancel/Delete visible if allowed

Now:

3. Log in as non-organizer.
4. Open same contest.

Verify:
- Management controls hidden or disabled
- No editable fields available

Kill app after completing this flow.

---

## REQUIRED FOR ANY FAILURE

Provide:
- Contest ID
- User ID
- Raw JSON payload
- Screenshot
- App build number

