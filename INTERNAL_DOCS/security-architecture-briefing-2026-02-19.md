# 67 Enterprises -- Security & Architecture Overview

------------------------------------------------------------------------

# 1. High-Level Architecture

## System Topology

``` mermaid
flowchart LR

    User[End User iOS Client]
    Stripe[Stripe Payment Processor]

    subgraph Platform Boundary
        API[Application API Service]
        Auth[Auth and Authorization Layer]
        Contest[Contest Service Logic]
        Payments[Payment Processing Logic]
        DB[(Primary PostgreSQL Database)]
    end

    User --> API
    API --> Auth
    Auth --> Contest
    Contest --> DB

    API --> Payments
    Payments --> DB

    Stripe --> Payments
    Payments --> Stripe
```

-   Single stateless backend service\
-   Managed PostgreSQL\
-   Stripe fully externalized\
-   No direct client to database access\
-   No raw card data handled internally

Blast radius: backend compromise results in full database exposure.

------------------------------------------------------------------------

# 2. Trust Boundaries

``` mermaid
flowchart LR

    subgraph Public Zone
        User[End User iOS Client]
    end

    subgraph Application Zone
        API[Application API]
        Auth[Auth Layer]
        Business[Business Logic]
        Payments[Payment Logic]
    end

    subgraph Data Zone
        DB[(PostgreSQL Database)]
    end

    Stripe[Stripe]

    User --> API
    API --> Auth
    Auth --> Business
    Business --> DB

    API --> Payments
    Payments --> DB

    Stripe --> Payments
    Payments --> Stripe
```

------------------------------------------------------------------------

# 3. Payment Security Model

Controls: - Stripe Checkout and Payment Intents - Idempotency key on
payment intent creation - Webhook signature verification - Event ID
deduplication - Server side lifecycle enforcement

Replay scenario: - Duplicate Stripe webhook events are ignored safely -
State transitions are idempotent

------------------------------------------------------------------------

# 4. Authentication & Authorization

Authentication: - Apple Sign In - Backend identity validation - JWT
bearer token issuance - Stateless API authentication

Authorization: - Role checks enforced in middleware - Contest level
permission validation server side - Lifecycle constraints enforced
server side - Admin routes excluded from public OpenAPI contract

------------------------------------------------------------------------

# 5. Data & PII Handling

Stored: - Email address - Apple ID - Contest entries - Payment metadata

Not stored: - Raw card numbers - Bank credentials

Current: - TLS in transit - Managed database encryption at rest

------------------------------------------------------------------------

# 6. Monitoring & Observability

Current: - Structured error schema - Enumerated error codes -
Application logs - Stripe dashboard monitoring - Railway platform logs

------------------------------------------------------------------------

# 7. CI/CD & Dependency Posture

Current: - GitHub source control - Staging and production branches -
Manual promotion discipline - OpenAPI contract freeze via hash
enforcement

------------------------------------------------------------------------

# 8. Blast Radius & Containment

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

# 9. Operational Constraint

Current: - Solo technical founder - Full time operations partner

Next inflection: - Security maturity requires sustained operational
oversight - Operations partner must transition to full time to
responsibly scale
