# Manual QA Flow — CLIENT LOCK V1 (With Pass/Fail)

**Objective:** Walk through the app exactly as a user would, and verify all contests enforce CLIENT LOCK V1 contract flags.

**Instructions for tester:** For each item, tick **☑ Pass** if it behaves correctly, **☐ Fail** if it does not.

---

## **Step 0 — User Login**

1. Open the iOS app.  
2. Enter credentials and log in.  
3. **Expected outcome:** Home screen appears.  
- [ ] Pass ☐ Fail  

---

## **Step 1 — Access Available Contests**

1. Tap **“Available Contests”**.  
2. **Expected outcome:** Contest List View opens.  
3. Verify contests display:  
   - Contest name  
   - Status (Live, Scheduled, Complete)  
   - Entry fee  
- [ ] Pass ☐ Fail  

---

## **Step 2 — Joinable Contest (Test Joinable Contest)**

1. Tap **“Test Joinable Contest”**.  
2. **Expected outcome:** Contest Detail screen opens.  

| Action / Flag                  | Expected UI | Pass | Fail |
|--------------------------------|------------|------|------|
| Join (`can_join`)               | Join button **visible and clickable** | ☐ | ☐ |
| Edit Lineup (`can_edit_entry`)  | Edit entry button **visible** | ☐ | ☐ |
| Share (`can_share_invite`)      | Share button **visible and works** | ☐ | ☐ |
| Manage (`can_manage_contest`)   | Edit/Delete **visible if organizer** | ☐ | ☐ |
| Lifecycle (`is_live`, `is_closed`) | Contest **marked Live, not closed** | ☐ | ☐ |

---

## **Step 3 — Expired Contest**

1. Tap **“Test Expired Contest”**.  

| Action / Flag                  | Expected UI | Pass | Fail |
|--------------------------------|------------|------|------|
| Join (`can_join`)               | Join button **not visible** | ☐ | ☐ |
| Edit Lineup (`can_edit_entry`)  | Edit button **disabled/hidden** | ☐ | ☐ |
| Share (`can_share_invite`)      | Share button **hidden/disabled** | ☐ | ☐ |
| Manage (`can_manage_contest`)   | Management buttons **enabled only for organizer** | ☐ | ☐ |
| Lifecycle (`is_live`, `is_closed`) | Contest **shows closed** | ☐ | ☐ |

---

## **Step 4 — Partial Entries Contest**

| Action / Flag                  | Expected UI | Pass | Fail |
|--------------------------------|------------|------|------|
| Join (`can_join`)               | Join button **visible** | ☐ | ☐ |
| Max Entries (`max_entries`)     | Cannot exceed allowed entries | ☐ | ☐ |
| Edit Lineup (`can_edit_entry`)  | Edit entry button **visible** | ☐ | ☐ |
| Share (`can_share_invite`)      | Share button **visible** | ☐ | ☐ |
| Manage (`can_manage_contest`)   | Management options **available if organizer** | ☐ | ☐ |

---

## **Step 5 — Share Disabled Contest**

| Action / Flag                  | Expected UI | Pass | Fail |
|--------------------------------|------------|------|------|
| Join (`can_join`)               | Join button **visible** | ☐ | ☐ |
| Share (`can_share_invite`)      | Share button **hidden/disabled** | ☐ | ☐ |
| Manage (`can_manage_contest`)   | Edit/Delete **enabled if organizer** | ☐ | ☐ |

---

## **Step 6 — Manage Disabled Contest**

| Action / Flag                  | Expected UI | Pass | Fail |
|--------------------------------|------------|------|------|
| Manage (`can_manage_contest`)   | Edit/Delete **hidden/disabled** | ☐ | ☐ |
| Join (`can_join`)               | Join button **visible** | ☐ | ☐ |
| Share (`can_share_invite`)      | Share button **visible and functional** | ☐ | ☐ |

---

## **Step 7 — Leaderboard Checks**

| Check                          | Expected UI | Pass | Fail |
|--------------------------------|------------|------|------|
| Leaderboard state (`leaderboard_state`) | Pending shows placeholder; computed shows scores | ☐ | ☐ |
| Column schema (`column_schema`) | All columns **rendered correctly** | ☐ | ☐ |
| Rows (`rows`)                   | Scores **render correctly**, no missing/extra rows | ☐ | ☐ |

---

## **Step 8 — Create Contest Flow**

| Field / Action                 | Expected UI | Pass | Fail |
|--------------------------------|------------|------|------|
| Contest Name                    | Input visible | ☐ | ☐ |
| Contest Type                    | Selector visible | ☐ | ☐ |
| Entry Fee                       | Input visible | ☐ | ☐ |
| Max Entries                     | Input visible and numeric limits enforced | ☐ | ☐ |
| Lock Time / Start Time / End Time | Date/time pickers visible | ☐ | ☐ |
| Submit / Create Button          | Enabled only if all required fields are filled | ☐ | ☐ |
| Preview / Action flags          | Default flags reflected (Join/Share/Manage) | ☐ | ☐ |

---

## **Step 9 — Contest Management Flow**

| Field / Action                 | Expected UI | Pass | Fail |
|--------------------------------|------------|------|------|
| Edit Contest Name               | Editable if `can_manage_contest = true` | ☐ | ☐ |
| Edit Entry Fee / Max Entries    | Editable if allowed | ☐ | ☐ |
| Edit Dates (Lock, Start, End)  | Editable if allowed | ☐ | ☐ |
| Cancel / Delete Contest         | Button visible if allowed | ☐ | ☐ |
| Save Changes                    | Enabled only if valid changes | ☐ | ☐ |
| Restrictions                    | All fields **disabled if `can_manage_contest = false`** | ☐ | ☐ |

---

## **Step 10 — Negative / Edge Case Testing**

| Action / Flag                  | Expected Behavior | Pass | Fail |
|--------------------------------|-----------------|------|------|
| Join expired contest            | Join button **not visible** | ☐ | ☐ |
| Edit disabled contest           | Edit buttons **disabled** | ☐ | ☐ |
| Share disabled contest          | Share button **hidden/disabled** | ☐ | ☐ |
| Partial entries limit           | Cannot join beyond max_entries | ☐ | ☐ |

---

# Manual QA Flow — CLIENT LOCK V1 (GitHub-flavored)

**Objective:** Walk through the app exactly as a user would, and verify all contests enforce CLIENT LOCK V1 contract flags.

**Instructions for tester:** Check boxes in GitHub. `[x]` = Pass, `[ ]` = Fail / issue observed.

---

## Step 0 — User Login
- [ ] Open the iOS app
- [ ] Enter credentials and log in
- [ ] Home screen appears successfully

---

## Step 1 — Access Available Contests
- [ ] Tap **Available Contests**
- [ ] Contest List View opens
- [ ] Contests display: name, status, entry fee

---

## Step 2 — Joinable Contest (Test Joinable Contest)
- [ ] Tap **Test Joinable Contest**
- [ ] Contest Detail screen opens
- [ ] Join button visible and clickable (`can_join`)
- [ ] Edit entry button visible (`can_edit_entry`)
- [ ] Share button visible and functional (`can_share_invite`)
- [ ] Management actions visible if organizer (`can_manage_contest`)
- [ ] Contest shows as Live and not closed (`is_live` / `is_closed`)

---

## Step 3 — Expired Contest (Test Expired Contest)
- [ ] Tap **Test Expired Contest**
- [ ] Join button not visible (`can_join`)
- [ ] Edit button disabled or hidden (`can_edit_entry`)
- [ ] Share button hidden or disabled (`can_share_invite`)
- [ ] Management actions only available if organizer (`can_manage_contest`)
- [ ] Contest marked as closed (`is_closed`)

---

## Step 4 — Partial Entries Contest
- [ ] Join button visible (`can_join`)
- [ ] Cannot exceed max entries (`max_entries`)
- [ ] Edit entry button visible (`can_edit_entry`)
- [ ] Share button visible (`can_share_invite`)
- [ ] Management options available if organizer (`can_manage_contest`)

---

## Step 5 — Share Disabled Contest
- [ ] Join button visible (`can_join`)
- [ ] Share button hidden or disabled (`can_share_invite`)
- [ ] Management options visible if organizer (`can_manage_contest`)

---

## Step 6 — Manage Disabled Contest
- [ ] Management actions hidden or disabled (`can_manage_contest`)
- [ ] Join button visible if contest open (`can_join`)
- [ ] Share button visible and functional (`can_share_invite`)

---

## Step 7 — Leaderboard Checks
- [ ] Pending contests show placeholder
- [ ] Computed contests display correct scores
- [ ] Columns rendered correctly (`column_schema`)
- [ ] Rows rendered correctly (`rows`)

---

## Step 8 — Create Contest Flow
- [ ] Tap **Create Contest**
- [ ] Contest Name input visible
- [ ] Contest Type selector visible
- [ ] Entry Fee input visible
- [ ] Max Entries input visible and numeric limits enforced
- [ ] Lock / Start / End time pickers visible
- [ ] Submit / Create button enabled only when required fields filled
- [ ] Preview / action flags reflect backend defaults (`can_join`, `can_share_invite`, `can_manage_contest`)

---

## Step 9 — Contest Management Flow
- [ ] Open contest as organizer
- [ ] Edit Contest Name editable if `can_manage_contest = true`
- [ ] Edit Entry Fee / Max Entries editable if allowed
- [ ] Edit Dates (Lock / Start / End) editable if allowed
- [ ] Cancel / Delete button visible if allowed
- [ ] Save Changes button enabled only for valid edits
- [ ] All fields disabled if `can_manage_contest = false`

---

## Step 10 — Negative / Edge Case Testing
- [ ] Join expired contest: Join button not visible
- [ ] Edit disabled contest: Edit buttons disabled
- [ ] Share disabled contest: Share button hidden / disabled
- [ ] Partial entries limit: Cannot join beyond `max_entries`