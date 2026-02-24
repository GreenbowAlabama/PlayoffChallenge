# Week Transition Process

**For: Operations Analysts**
**Last Updated: January 2026**

---

## What This Document Is

This is your complete guide to advancing the playoff contest from one week to the next. Follow these steps in order, and you will complete the transition successfully every time.

**You do not need:**
- Engineering support
- Database access
- Any technical tools

**You only need:**
- Your admin login credentials
- Access to the web-admin website
- This document

---

## Before You Begin

### Timing
Perform the week transition **after** all games for the current week have finished and scores are final. Do not transition mid-week or while games are in progress.

### Checklist
Before starting, confirm:
- [ ] All games for the current week are complete
- [ ] You have your admin login ready
- [ ] You have 15-20 minutes of uninterrupted time
- [ ] You will not refresh or close your browser during the process

---

## The Process (9 Steps)

### Step 1: Log In

1. Open the web-admin website in your browser
2. Enter your admin username and password
3. Click **Log In**

**You're ready to continue when:**
- You see the Dashboard page
- The page shows "Game State," "Week Management," and "Pick Trends" sections
- No error messages appear

**If something is wrong:**
- If you cannot log in, verify your credentials
- If the page won't load, wait a few minutes and try again
- If errors appear, stop and contact engineering

---

### Step 2: Check the Current State

Look at the Dashboard and confirm everything matches what you expect.

**Find and verify:**
- **Current NFL Week** - Does this match the week that just finished?
- **Playoff Week** - Does this match your records?
- **Week Lock State** - Note whether it says "LOCKED" or "UNLOCKED"

**You're ready to continue when:**
- The week numbers match what you expect
- No warning banners or error messages are showing

**If something is wrong:**
- If the week numbers don't match your expectations, stop and contact engineering
- If you see any error messages, stop and contact engineering

---

### Step 3: Enable Admin Edit Mode

This step unlocks the controls you need. The system requires you to type a specific phrase to prevent accidental changes.

1. Find the **Admin Edit Mode** section (yellow box near the top)
2. Read the warning message
3. In the text box, type exactly: `ENABLE ADMIN EDIT MODE`
4. Click the **Enable** button

**You're ready to continue when:**
- The box turns red
- You see an "ACTIVE" badge
- The message confirms edit mode is active

**Important:** If you refresh the page at any point, you will need to repeat this step.

---

### Step 4: Lock the Current Week

The week must be locked before you can advance. This prevents users from making changes during the transition.

**Check the Week Lock State in the Week Management section:**

**If it shows "LOCKED":**
- You're ready to continue to Step 5

**If it shows "UNLOCKED":**
1. Click the **Lock Week** button
2. In the popup, type the confirmation phrase: `LOCK WEEK`
3. Click **Confirm**
4. Wait for the status to change to "LOCKED"

**You're ready to continue when:**
- Week Lock State shows "LOCKED"
- The "Advance to Next Week" button is no longer grayed out

**Note:** If the week is unlocked, the "Advance to Next Week" button will be disabled and show the message: *"Week must be locked before advancing."* This is a safety feature.

---

### Step 5: Advance to the Next Week

This is the main action that moves the contest forward.

1. Look at the **Week Management** section
2. Find the **Advance to Next Week** button
3. Verify the text next to it shows the correct transition (example: "NFL Week 19 → Week 20")
4. Click **Advance to Next Week**
5. A confirmation popup will appear
6. Read the warning message carefully
7. Type the confirmation phrase: `ADVANCE WEEK`
8. Click **Confirm**
9. Wait for the process to complete (do not click anything else)

**You're ready to continue when:**
- A green success message appears
- You see counts for "Advanced" and "Eliminated" users
- No error messages appear

**If something goes wrong:**
- Do NOT click the button again
- Write down the exact error message
- Stop and contact engineering immediately

---

### Step 6: Review the Transition Results

After the transition completes, review what happened.

**In the green success panel, check:**
- **Advanced count** - Number of users who moved to the next week
- **Eliminated count** - Number of users who were eliminated
- **Timestamp** - When the transition occurred
- **Admin** - Should show your user ID

**You're ready to continue when:**
- The counts look reasonable (not zero unless expected)
- No error messages appear

---

### Step 7: Verify Picks Were Created

A verification panel appears automatically after a successful transition. This confirms that the system created picks for the new week correctly.

**In the "Post-Transition Verification" panel, check:**

| Item | What to Look For | What's Normal |
|------|------------------|---------------|
| **Pick Count** | Number of picks created | Should be greater than zero |
| **Score Count** | Number of scores recorded | Should be zero (scores come later) |
| **Multipliers** | Breakdown showing different multiplier values | Should show a mix (e.g., "1.0: 5, 1.5: 3") |
| **Anomalies** | Any warning messages | Should be empty (no anomalies) |

**You're ready to continue when:**
- Pick Count is greater than zero
- Score Count is zero (with "(expected)" shown)
- Multipliers section shows values
- No anomalies are listed

**If anomalies appear:**
- Write down exactly what the anomaly message says
- Stop and contact engineering

---

### Step 8: Unlock the New Week

Now that the transition is complete and verified, unlock the week so users can make their picks.

1. In **Week Management**, click the **Unlock Week** button
2. In the popup, type the confirmation phrase: `UNLOCK WEEK`
3. Click **Confirm**
4. Wait for the status to update

**You're ready to continue when:**
- Week Lock State shows "UNLOCKED"
- Users can now access the app and make picks

---

### Step 9: Final Confirmation

Take one final look at the Dashboard to confirm everything is correct.

**Verify:**
- [ ] The current week number has increased by one
- [ ] Week Lock State shows "UNLOCKED"
- [ ] No error messages or warnings are visible
- [ ] The Admin Edit Mode can be disabled (click "Disable Edit Mode")

**Congratulations!** The week transition is complete.

---

## After the Transition

### What Users Will Experience
- Users can now open the app and see the new week
- Users who advanced can make swaps or keep their current picks
- Eliminated users will see that they are no longer active

### What to Watch For
Over the next few hours, if users report issues such as:
- Missing picks
- Wrong multiplier values
- Inability to make swaps

...contact engineering with the specific details.

---

## Quick Reference Card

| Step | Action | Success Indicator |
|------|--------|-------------------|
| 1 | Log in | Dashboard loads |
| 2 | Check state | Week numbers correct |
| 3 | Enable Edit Mode | Red box, "ACTIVE" badge |
| 4 | Lock week | Shows "LOCKED" |
| 5 | Advance week | Green success panel |
| 6 | Review results | Counts displayed |
| 7 | Verify picks | Pick count > 0, no anomalies |
| 8 | Unlock week | Shows "UNLOCKED" |
| 9 | Final check | All looks normal |

---

## Troubleshooting

### "Advance to Next Week" button is grayed out

**Possible causes:**
1. Admin Edit Mode is not active → Go back to Step 3
2. Week is not locked → Go back to Step 4
3. You're in production read-only mode → Contact engineering

### The page refreshed and I lost my place

1. Check the current week number on the Dashboard
2. If it shows the NEW week number: The transition completed. Continue from Step 6.
3. If it shows the OLD week number: The transition did not complete. Start over from Step 3.

### An error appeared during the transition

1. Do NOT retry the transition
2. Write down the exact error message
3. Note the current time
4. Contact engineering immediately

### The verification shows anomalies

1. Write down exactly what the anomaly says
2. Do NOT unlock the week
3. Contact engineering immediately

---

## Safety Rules

1. **Never refresh the page** during Steps 5-7
2. **Never click a button twice** if it seems slow
3. **Never skip the verification step** (Step 7)
4. **Always contact engineering** if something unexpected happens
5. **When in doubt, stop** - It's better to pause than to cause problems

---

## Contact

If you encounter any issues during this process, contact the engineering team with:
- The step number where the issue occurred
- The exact error message or unexpected behavior
- The current time
- Screenshots if possible

---

*End of Week Transition Process*
