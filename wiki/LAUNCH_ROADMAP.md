# Launch Roadmap - NFL Playoff Challenge

**Target Launch:** Day 1 of NFL Playoff Games (Jan 8-13, 2026)
**Timeline:** 6 weeks from Nov 30, 2025
**Goal:** Complete P0 + P1 features for successful launch

---

## 🔴 **P0: CRITICAL - Must Have for Launch**

### **Feature 1: Monitoring & Alerting System**
**Why P0:** Can't launch without knowing when things break during live games

**Stories:**
1. Set up error logging service (e.g., Sentry, LogRocket, or Railway logs aggregation)
2. Create health check endpoint monitoring (ping `/health` every 60s)
3. Alert on ESPN API failures (score sync breaks)
4. Alert on database connection pool exhaustion
5. Alert on API endpoint errors (5xx responses)
6. Create dashboard for real-time metrics (requests/min, active users, score updates)
7. Set up notification channels (email, SMS, Slack for critical alerts)
8. Test alert triggers with simulated failures

**Estimated Complexity:** 8 (Fibonacci)

---

### **Feature 2: Refactor server.js - Remove Unused Code**
**Why P0:** Clean codebase = fewer bugs, faster debugging on launch day

**Stories:**
1. Audit all endpoints - identify unused/deprecated routes
2. Remove commented-out code blocks
3. Remove unused utility scripts from `/backend/` (already started)
4. Consolidate duplicate logic (e.g., multiple score refresh patterns)
5. Extract helper functions to separate modules (e.g., ESPN mapping, cache management)
6. Remove debug endpoints not needed in production
7. Update API documentation to reflect current endpoints
8. Test all remaining endpoints still work

**Estimated Complexity:** 3 (Fibonacci)

---

### **Feature 3: Refactor Database - Remove Unused Tables/Columns**
**Why P0:** Clean schema before real user data; prevents migration nightmares

**Stories:**
1. Audit schema.sql - identify unused tables
2. Identify deprecated columns (e.g., old `game_settings` position limits vs `position_requirements`)
3. Check for orphaned foreign keys or unused indexes
4. Remove test/temporary tables from development
5. Optimize slow queries (identify with Railway query analyzer)
6. Add missing indexes for common queries (leaderboard, picks by user)
7. Create migration script for production database
8. Test rollback plan in case migration fails

**Estimated Complexity:** 5 (Fibonacci)

---

## 🟡 **P1: HIGH - Strongly Recommended for Launch**

### **Feature 4: Check Railway API & DB Usage**
**Why P1:** Need cost visibility before scaling to 100+ users

**Stories:**
1. Review current Railway usage metrics (API calls, DB connections, bandwidth)
2. Estimate launch day traffic (100 users × avg requests/user)
3. Calculate estimated monthly costs at scale
4. Check current plan limits (connections, storage, bandwidth)
5. Set up billing alerts (e.g., warn at 75% of budget)
6. Upgrade plan if needed (do this early to avoid launch day throttling)
7. Document resource usage patterns for future optimization

**Estimated Complexity:** 1 (Fibonacci)

---

### **Feature 5: Enhance Admin Section**
**Why P1:** You'll need efficient tools to manage users/scores during live games

**Stories:**
1. Add bulk user operations (mark multiple as paid, delete test accounts)
2. Create "emergency score refresh" button (force sync all users for a week)
3. Add user search/filter (by email, payment status, score range)
4. Show real-time cache status on admin panel (what's cached, when it expires)
5. Add "override score" capability (manual correction for scoring bugs)
6. Create audit log viewer (who did what, when - for debugging)
7. Add "broadcast message" feature (notify all users via in-app banner)
8. Test admin workflows under load (can you manage 100 users quickly?)

**Estimated Complexity:** 3 (Fibonacci)

---

### **Feature 6: Enhance Profile Tab**
**Why P1:** First impression for real users; reduces support burden

**Stories:**
1. Show payment status clearly ("Paid ✅" vs "Payment Pending")
2. Add payment instructions (Venmo/CashApp/Zelle handles, amount due)
3. Display user stats (total points, rank, weeks participated)
4. Show team name prominently (if user has one)
5. Add "Edit Profile" capability (change team name, payment method preference)
6. Display transaction history (when paid, amount, method)
7. Add "Request Support" button (link to email/form)
8. Polish UI/UX (consistent with rest of app design)

**Estimated Complexity:** 5 (Fibonacci)

---

## 🟢 **P2: NICE TO HAVE - Post-Launch Enhancements**

### **Feature 7: SPIKE - Research Authentication Methods**
**Why P2:** Good to know options, but Apple auth works for Season 1

**Stories:**
1. Research Google OAuth integration complexity
2. Research email/password + magic link approach
3. Compare security implications of each method
4. Estimate implementation effort (Fibonacci complexity)
5. Survey current testers on preferred auth methods
6. Document findings in wiki (for Season 2 roadmap)

**Estimated Complexity:** 2 (Fibonacci)

---

### **Feature 8: Add Google Authentication**
**Why P2:** Expands user base, but defer until after Season 1 success

**Stories:**
1. Set up Google Cloud project & OAuth credentials
2. Implement Google Sign-In SDK in iOS app
3. Add `/api/auth/google` endpoint in backend
4. Link Google accounts to existing user records
5. Handle account merging (if user has both Apple & Google)
6. Test across iOS versions
7. Update privacy policy for Google auth data handling
8. Deploy & announce to users

**Estimated Complexity:** 5 (Fibonacci)

---

## 🔵 **P3: FUTURE - After Season 1**

### **Feature 9: Scaffold Next Game**
**Why P3:** Focus on nailing one game first; validate business model

**Stories:**
1. Define game mechanics for new game (rules, scoring, positions)
2. Design multi-game database schema (shared users, separate picks/scores)
3. Create game selection UI (choose which game to play)
4. Implement game-specific scoring logic
5. Build game-specific admin tools
6. Test with small beta group
7. Launch as Season 2 offering

**Estimated Complexity:** 13 (Fibonacci)

---

## 📊 **Effort Estimation Summary**

| Priority | Feature | Stories | Est. Complexity | Impact |
|----------|---------|---------|-----------------|--------|
| P0 | Monitoring & Alerting | 8 | 8 (Fibonacci) | 🔥 Critical |
| P0 | Refactor server.js | 8 | 3 (Fibonacci) | 🔥 Critical |
| P0 | Refactor database | 8 | 5 (Fibonacci) | 🔥 Critical |
| P1 | Railway usage check | 7 | 1 (Fibonacci) | ⚡ High |
| P1 | Enhance Admin section | 8 | 3 (Fibonacci) | ⚡ High |
| P1 | Enhance Profile tab | 8 | 5 (Fibonacci) | ⚡ High |
| P2 | Auth research SPIKE | 6 | 2 (Fibonacci) | 💡 Medium |
| P2 | Google authentication | 8 | 5 (Fibonacci) | 💡 Medium |
| P3 | Scaffold next game | 7 | 13 (Fibonacci) | 🔮 Low |

**Total P0 Complexity:** 16 (Fibonacci)
**Total P1 Complexity:** 9 (Fibonacci)
**Total P0+P1 Complexity:** 25 (Fibonacci)

---

## 🎯 **80% Fast-Track Recommendation**

**If you can knock out 80% quickly, focus here:**

### **Week 1 Sprint:**
1. ✅ Railway usage check (1 day)
2. ✅ Refactor server.js (2-3 days)
3. ✅ Refactor database (2-3 days)

### **Week 2 Sprint:**
4. ✅ Monitoring & Alerting (3-4 days - can parallelize with design/implementation)
5. ✅ Enhance Admin section (1-2 days)

### **Week 3 Sprint:**
6. ✅ Enhance Profile tab (2-3 days)
7. ✅ Final testing & polish

**Total Estimated Time: ~3 weeks to complete P0 + P1**

---

## ⚠️ **CRITICAL LAUNCH DAY RISKS**

### What Could Derail Launch:

1. **No monitoring** → You won't know if things break during live games
2. **Messy codebase** → Hard to debug issues on Jan 8 at 4:30 PM ET (first game kickoff)
3. **Untested admin tools** → Can't fix user issues quickly
4. **Railway cost overruns** → Service gets throttled mid-game

### Launch Day Scenarios to Prepare For:

- 100+ users signing up simultaneously (can your DB handle it?)
- ESPN API goes down (do you have fallback?)
- Scoring bug discovered mid-game (can you hotfix without breaking leaderboard?)
- User can't pay via Venmo (do you have support flow?)

---

## 📋 **Pre-Launch Checklist**

Before Jan 8, 2026:

### Infrastructure
- [ ] Monitoring & alerting system operational
- [ ] Railway plan adequate for projected load
- [ ] Database optimized and cleaned
- [ ] Backup & restore procedures tested

### Code Quality
- [ ] server.js refactored and documented
- [ ] All endpoints tested and necessary
- [ ] Database schema clean and indexed
- [ ] Emergency rollback plan ready

### User Experience
- [ ] Profile tab enhanced with payment clarity
- [ ] Admin panel efficient for rapid support
- [ ] Onboarding flow smooth for new users
- [ ] Support contact methods documented

### Operations
- [ ] Code freeze 3 days before launch
- [ ] Final smoke tests completed
- [ ] Emergency contact list created
- [ ] Chad trained on admin operations

---

## 🚀 **Launch Window Strategy**

### Pre-Launch (Jan 5-7)
- Final deployment on Jan 5
- NO code changes Jan 6-7
- Monitor logs for any anomalies
- Test payment flows one final time

### Launch Weekend (Jan 8-13)
- **Saturday Jan 11:** 2 Wild Card games
- **Sunday Jan 12:** 2 Wild Card games
- Active monitoring during all games
- Rapid response to user issues
- Document any bugs for post-game fixes

### Post-Launch (Jan 14+)
- Review monitoring data
- Address non-critical bugs
- Collect user feedback
- Plan improvements for Divisional Round

---

## 📈 **Success Metrics**

Track these KPIs to measure launch success:

### Technical Health
- API uptime: Target 99.9%
- Average response time: < 200ms
- Score sync latency: < 2 minutes from ESPN update
- Error rate: < 0.1%

### User Engagement
- Users who complete signup: Target 80% of invites
- Users who make picks: Target 90% of signups
- Users who pay: Target 85% of pick-makers
- Daily active users during games: Target 60%

### Business Metrics
- Total entry fees collected
- Cost per user (Railway + ops)
- Net revenue after payouts
- User satisfaction (post-season survey)

---

## 🔄 **Post-Season 1 Roadmap**

After Super Bowl (Feb 2026):

1. **Retrospective** - What worked, what didn't
2. **Data analysis** - User behavior, scoring patterns, engagement
3. **Feature prioritization** - Based on user feedback
4. **P2 Implementation** - Google auth, additional features
5. **Season 2 Planning** - Next year's playoff challenge
6. **P3 Exploration** - Consider additional games

---

## 📚 **Related Documentation**

- [Week Transition Guide](/WEEK_TRANSITION_GUIDE.md) - Operational procedures
- [Week 14 Transition Checklist](/wiki/WEEK14_TRANSITION_CHECKLIST.md) - Current testing week
- [Architecture Deep Dive](/wiki/Architecture-Deep-Dive.md) - System design
- [CLAUDE.md](/CLAUDE.md) - Project overview and commands

---

**Last Updated:** Nov 30, 2025
**Owner:** Ian Carter
**Status:** Planning Phase → Pre-Launch Execution
