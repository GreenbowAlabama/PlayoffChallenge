# 67 Enterprises -- Security & Architecture Overview

------------------------------------------------------------------------

# 1. High-Level Architecture

## System Topology

``` mermaid
flowchart TD
    A[iOS Client<br/>Swift + Apple Sign-In]
    B[Node.js + Express API<br/>Stateless Application]
    C[(PostgreSQL DB<br/>Railway Managed)]
    D[Stripe<br/>Payments + Webhooks]

    A -->|HTTPS (TLS)| B
    B --> C
    B --> D
```

-   Single stateless backend service\
-   Managed PostgreSQL\
-   Stripe fully externalized\
-   No direct client → DB access\
-   No raw card data handled internally

Blast radius: backend compromise = full database exposure.

------------------------------------------------------------------------

# 2. Trust Boundaries

``` mermaid
flowchart TD
    Internet[Public Internet]
    API[API Boundary<br/>JWT Required]
    Auth[Authorization Middleware]
    DB[(PostgreSQL Database)]

    Internet --> API
    API --> Auth
    Auth --> DB
```

Current posture: - TLS enforced - JWT required for protected routes -
Authorization enforced server-side - No client-trusted flags

Not yet implemented: - WAF - Network segmentation - Private DB
networking beyond PaaS defaults

------------------------------------------------------------------------

# 3. Stripe Webhook Processing

``` mermaid
flowchart TD
    Stripe[Stripe]
    Webhook[Webhook Endpoint]
    Verify[Signature Verification]
    Idempotent[Idempotent Event Processor]
    Mutation[Verified State Transition + DB Write]

    Stripe --> Webhook
    Webhook --> Verify
    Verify --> Idempotent
    Idempotent --> Mutation
```

Controls: - Idempotency key on payment intent creation - Webhook
signature validation - Event ID deduplication - Server-side lifecycle
validation

Replay scenario: - Duplicate events ignored safely

------------------------------------------------------------------------

# 4. Blast Radius Analysis

``` mermaid
flowchart TD
    Compromise[Backend Compromise]
    DBAccess[Full Database Access]
    PII[User PII Exposure]
    Integrity[Contest Integrity Risk]

    Compromise --> DBAccess
    DBAccess --> PII
    DBAccess --> Integrity
```

------------------------------------------------------------------------

# 5. Repositories & Environments

Repositories: - Backend - iOS - Governance / documentation

Environments: - Staging - Production

Secrets: - Environment-scoped variables - Stripe keys separated per
environment - No secrets in source control

Not yet implemented: - Dedicated secrets manager - Automated secret
rotation - Infrastructure as code

------------------------------------------------------------------------

# 6. Authentication & Authorization

Authentication flow: - Apple Sign-In - Backend identity validation - JWT
issued - Bearer token required for protected routes

Authorization: - Role checks enforced in middleware - Contest-level
permission validation server-side - Lifecycle constraints enforced
server-side

Not yet implemented: - Formal RBAC matrix - Policy engine - Privilege
escalation testing

------------------------------------------------------------------------

# 7. Monitoring & Observability

Current: - Structured error schema - Enumerated error codes -
Application logging - Stripe dashboard monitoring

Not yet implemented: - SIEM - Centralized alerting pipeline - Intrusion
detection - Incident response runbook

------------------------------------------------------------------------

# 8. Operational Constraint

Current: - Solo technical founder - Part-time ops partner

Next inflection: - Security maturity requires sustained operational
oversight - Ops partner must transition to full-time
