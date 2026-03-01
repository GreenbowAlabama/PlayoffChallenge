# Claude Worker Launch Rules

All Claude sessions MUST be launched from repository root.

Never launch from /backend or /ios-app.

Claude must have visibility into:
- /docs
- /backend
- /ios-app
- /backend/contracts/openapi.yaml
- /backend/db/schema.snapshot.sql
- /backend/tests

If Claude is launched from a subdirectory, terminate the session and relaunch from root.

This is mandatory for architectural integrity.
