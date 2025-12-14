# Making Changes

This guide shows you how to make changes to the codebase using proper branching and pull requests.

⏱️ **Estimated time:** 10 minutes for first time, 2 minutes after that

---

## Workflow Overview

**Never commit directly to the `backend` branch!** It's protected and is our production code.

Instead, follow this workflow:
1. Create a new branch from `backend`
2. Make your changes
3. Commit to your branch
4. Push your branch to GitHub
5. Create a Pull Request (PR)
6. Get it reviewed and merged

---

## Step 1: Create a New Branch

Always start from the latest `backend` branch:

```bash
# Make sure you're on backend and up to date
git checkout backend
git pull origin backend

# Create and switch to a new branch
git checkout -b your-feature-name
```

**Branch naming conventions:**
- `feature/add-scoring-multiplier` - New features
- `fix/espn-api-timeout` - Bug fixes
- `docs/update-readme` - Documentation changes
- `refactor/simplify-auth` - Code improvements

**Examples:**
```bash
git checkout -b feature/add-defense-scoring
git checkout -b fix/leaderboard-crash
git checkout -b docs/setup-guide
```

---

## Step 2: Make Your Changes

Now you can edit files, add features, fix bugs, etc.

**Use Claude Code for help:**
- Open the file you want to change
- Ask Claude Code to help you make the change
- Review the changes Claude Code suggests
- Accept or modify as needed

---

## Step 3: Commit Your Changes

**Check what changed:**
```bash
git status
```

**Stage your changes:**
```bash
# Stage specific files
git add backend/server.js

# Or stage all changes
git add .
```

**Commit with a clear message:**
```bash
git commit -m "Add defense scoring to scoring rules

- Add sack, interception, fumble recovery points
- Update scores calculation to include defense stats
- Add tests for defense scoring"
```

**Good commit messages:**
- Start with a verb (Add, Fix, Update, Remove, Refactor)
- Be specific about what changed
- Include why if it's not obvious
- Use bullet points for multiple changes

---

## Step 4: Push Your Branch

Push your branch to GitHub:

```bash
git push origin your-feature-name
```

**Example:**
```bash
git push origin feature/add-defense-scoring
```

**Expected output:**
```
Enumerating objects: 5, done.
Counting objects: 100% (5/5), done.
...
To https://github.com/GreenbowAlabama/PlayoffChallenge.git
 * [new branch]      feature/add-defense-scoring -> feature/add-defense-scoring
```

---

## Step 5: Create a Pull Request

**Option A: GitHub CLI (Recommended)**

If you have `gh` installed:

```bash
gh pr create --base backend --title "Add defense scoring" --body "
## What changed
- Added defense scoring rules (sacks, interceptions, fumbles)
- Updated scores calculation to include defense stats

## Testing
- Tested with Chiefs defense in Week 1
- Verified points calculation matches expected

## Checklist
- [x] Code tested locally
- [x] No breaking changes
- [x] Documentation updated if needed
"
```

**Option B: GitHub Web UI**

1. Go to https://github.com/GreenbowAlabama/PlayoffChallenge
2. You'll see a banner: "your-feature-name had recent pushes"
3. Click "Compare & pull request"
4. Set base branch to `backend`
5. Fill in:
   - **Title**: Short description of changes
   - **Description**: What changed, why, how to test
6. Click "Create pull request"

---

## Pull Request Template

Use this template for your PR description:

```markdown
## What changed
Describe what you changed and why.

## How to test
1. Checkout this branch
2. Run `npm run dev`
3. Test the feature by doing X
4. Expected result: Y

## Checklist
- [ ] Code tested locally
- [ ] No breaking changes to API
- [ ] Environment variables documented if added
- [ ] CLAUDE.md updated if architecture changed
```

---

## Step 6: Code Review & Merge

**What happens next:**
1. Team members will review your PR
2. They may ask questions or request changes
3. You can push more commits to address feedback
4. Once approved, it gets merged into `backend`
5. Railway automatically deploys the changes

**To update your PR with changes:**
```bash
# Make the requested changes
git add .
git commit -m "Address review feedback"
git push origin your-feature-name
```

The PR automatically updates with your new commits!

---

## Common Workflows

### Working on Multiple Features

```bash
# Feature 1
git checkout backend
git checkout -b feature/add-multipliers
# ... make changes, commit, push, create PR ...

# Feature 2 (start fresh from backend)
git checkout backend
git checkout -b feature/add-notifications
# ... make changes, commit, push, create PR ...
```

### Updating Your Branch with Latest Backend

If `backend` has new changes while you're working:

```bash
# Save your work first
git add .
git commit -m "WIP: work in progress"

# Get latest backend
git checkout backend
git pull origin backend

# Go back to your branch and merge backend into it
git checkout your-feature-name
git merge backend

# Resolve any conflicts if needed
# Then continue working
```

### Fixing Merge Conflicts

If your branch conflicts with `backend`:

```bash
git merge backend
# Git will show conflicts in files

# Open the conflicting files
# Look for:
<<<<<<< HEAD
your changes
=======
backend changes
>>>>>>> backend

# Edit to keep what you want
# Remove the conflict markers (<<<, ===, >>>)
# Save the file

# Mark as resolved
git add conflicted-file.js
git commit -m "Resolve merge conflicts"
git push origin your-feature-name
```

---

## Using Claude Code for Git Workflow

Claude Code can help you with all of this!

**Ask Claude Code:**
- "Create a new branch called feature/add-leaderboard-filters"
- "Commit my changes with a good commit message"
- "Push this branch and create a PR"
- "Update my branch with the latest backend changes"
- "Help me resolve this merge conflict"

Claude Code will run the git commands for you and explain what's happening.

---

## Best Practices

### Branch Hygiene
- ✅ Create a new branch for each feature/fix
- ✅ Keep branches small and focused
- ✅ Delete branches after they're merged
- ❌ Don't work on multiple unrelated things in one branch

### Commit Hygiene
- ✅ Commit early and often
- ✅ Write clear commit messages
- ✅ One logical change per commit
- ❌ Don't commit broken code
- ❌ Don't commit secrets or credentials

### Pull Request Hygiene
- ✅ Keep PRs small (< 400 lines changed)
- ✅ Describe what and why
- ✅ Test your changes before creating PR
- ✅ Respond to review comments
- ❌ Don't merge your own PRs (unless you're admin)

---

## Deleting Branches

After your PR is merged, delete the branch:

**On GitHub:**
- Click "Delete branch" button on the merged PR

**Locally:**
```bash
# Switch to backend
git checkout backend

# Delete the local branch
git branch -d feature/your-feature-name

# If it complains, force delete
git branch -D feature/your-feature-name

# Update your local list of remote branches
git fetch --prune
```

---

## Quick Reference

```bash
# Start new feature
git checkout backend
git pull origin backend
git checkout -b feature/my-feature

# Make changes, then commit
git add .
git commit -m "Add my feature"
git push origin feature/my-feature

# Create PR (GitHub CLI)
gh pr create --base backend

# Update branch with latest backend
git checkout backend
git pull origin backend
git checkout feature/my-feature
git merge backend

# After PR is merged, cleanup
git checkout backend
git pull origin backend
git branch -d feature/my-feature
```

---

## Troubleshooting

### "Updates were rejected" when pushing

Your local `backend` is behind the remote:

```bash
git checkout backend
git pull origin backend
git checkout your-feature-name
git merge backend
git push origin your-feature-name
```

### "Branch already exists"

Delete the old branch first:

```bash
git branch -D old-feature-name
git checkout -b old-feature-name
```

### Pushed to wrong branch

Don't panic! Create a new branch from your current position:

```bash
git checkout -b correct-branch-name
git push origin correct-branch-name
```

Then reset the wrong branch (if it was `backend`):

```bash
git checkout backend
git reset --hard origin/backend
```

---

**Need help?** Ask Claude Code or check with your team lead before making changes to `backend` directly!
