## Instructions for Worker (Strict, Non-Negotiable)

This is a **pure deletion task**. All discovery, scoping, and decision-making has already been completed by Architecture.

You are an **executor only**, not an investigator.

---

### Absolute Rules

- DO NOT perform discovery of any kind
- DO NOT read server.js in full
- DO NOT scan, search, grep, or explore for additional code
- DO NOT infer usage or dependencies
- DO NOT compare against APIService.swift
- DO NOT request APIService.swift
- DO NOT request server.js wholesale
- DO NOT delete anything not explicitly listed in this handoff

If any instruction conflicts with this section, **this section wins**.

---

### Execution Model (Enforced)

You will perform **mechanical deletions only** based solely on the explicit KEEP and REMOVE lists in this handoff.

You are authorized to:
- Delete routes explicitly listed under **REMOVE → Routes**
- Delete helpers explicitly listed under **REMOVE → Helpers**
- Delete middleware explicitly listed under **REMOVE → Middleware**
- Delete imports **only if** they are exclusively referenced by removed code

You are NOT authorized to:
- Discover additional unused code
- Optimize or refactor
- Reorder code
- Rename functions
- Modify KEEP routes or helpers
- Change behavior of any retained code

---

### File Access Rules (Critical)

You may request file content **only in bounded, targeted chunks**.

Allowed requests:
- A specific route handler by path and method
- A specific helper function by name
- A specific middleware by name
- A specific line range (maximum 200 lines)

Examples (Allowed):
- “Please paste the route handler for `GET /api/users/:userId`.”
- “Please paste the helper function `hashPassword`.”
- “Please paste lines 320–420.”

Examples (Not Allowed):
- “Please paste server.js”
- “I will scan server.js”
- “I will search for unused helpers”

If required context is not provided, **STOP** and wait.

---

### Deletion Instructions (Authoritative)

Perform the following steps in order:

1. Delete **all** Express route handlers listed under:
   **REMOVE → Routes**
   - Remove the full route block
   - Remove any comments that exist solely for that route

2. Delete **all** helper functions listed under:
   **REMOVE → Helper Functions**
   - Only if they are not referenced by any KEEP route

3. Delete **all** middleware listed under:
   **REMOVE → Middleware**
   - Ensure `authenticateToken` is preserved

4. Remove imports ONLY IF:
   - They are exclusively referenced by removed routes, helpers, or middleware
   - Example: bcrypt, jsonwebtoken

Do not remove shared imports unless exclusivity is obvious and explicit.

---

### Verification (Non-Exploratory)

You must NOT:
- Run the application
- Execute tests
- Perform validation logic
- Infer correctness beyond syntax

You must:
- Ensure the file remains syntactically valid
- Ensure all KEEP routes and helpers remain untouched

---

### Output Requirements (Strict)

Return ONLY the following, in plain text:

- Deleted routes
- Deleted helpers
- Deleted middleware
- Deleted imports (if any)

No explanations  
No summaries  
No recommendations  
No additional steps  

---

### Stop Condition (Mandatory)

After reporting deletions:
- STOP immediately
- Await user validation
- Do not proceed further without explicit instruction