# 67 Enterprises – Security & Architecture Overview

---

# 1. High-Level Architecture

## System Topology

             ┌──────────────────────────┐
             │        iOS Client        │
             │   Swift + Apple Sign-In  │
             └─────────────┬────────────┘
                           │ HTTPS (TLS)
                           ▼
             ┌──────────────────────────┐
             │   Node.js + Express API  │
             │   Stateless Application  │
             └─────────────┬────────────┘
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
   ┌────────────────────┐     ┌────────────────────┐
   │   PostgreSQL DB    │     │       Stripe       │
   │  (Railway Managed) │     │ Payment + Webhook  │
   └────────────────────┘     └────────────────────┘

- Single stateless backend service  
- Managed Postgres  
- Stripe fully externalized  
- No direct client → DB access  
- No raw card data handled internally  

Blast radius: backend compromise = full database exposure.

---

# 2. Trust Boundaries

## Logical Zones

[ Public Internet ]
        │
        ▼
[ API Boundary - JWT Required ]
        │
        ▼
[ Authorization Middleware ]
        │
        ▼
[ PostgreSQL Database ]

## Stripe Webhook Flow

Stripe → Webhook Endpoint
        ↓
Signature Verification
        ↓
Idempotent Event Processor
        ↓
State Transition + DB Write

Current posture:
- TLS enforced
- Stripe signature validation
- Idempotent webhook handling

Not yet implemented:
- WAF
- Network segmentation
- DB private networking enforcement beyond PaaS defaults

---

# 3. Repositories & Environments

Repositories:
- Backend
- iOS
- Governance / documentation

Environments:
- Staging
- Production

Secrets:
- Environment-scoped variables in Railway
- Stripe keys separated per environment
- No secrets in source control

Not yet implemented:
- Dedicated secrets manager
- Automated secret rotation
- Infrastructure as code
- Ephemeral preview environments

---

# 4. Authentication & Authorization

## Authentication Flow

Apple Sign-In
      ↓
Backend Identity Validation
      ↓
JWT Issued
      ↓
Bearer Token Required on Protected Routes

- Stateless JWT bearer auth
- Admin routes excluded from public OpenAPI spec
- No client-trusted flags

Authorization:
- Role checks enforced in middleware
- Contest-level permission validation server-side
- Lifecycle constraints enforced server-side

Not yet implemented:
- Formal RBAC matrix
- Policy engine
- Automated privilege escalation testing
- Advanced rate limiting

---

# 5. Payment Security Model

Client → Stripe Checkout
Stripe → Signed Webhook
Webhook → Signature Validation
Webhook → Idempotent Handler
Handler → Verified State Mutation

Controls:
- Idempotency key on payment intent creation
- Webhook signature validation
- Event ID deduplication
- Server-side lifecycle validation

Replay scenario:
- Safe
- Duplicate events ignored

Not yet implemented:
- Dead-letter queue
- Financial reconciliation automation
- Webhook anomaly alerting

---

# 6. Data & PII Handling

Stored:
- Email (Apple relay or direct)
- Apple ID
- Contest entries
- Payment metadata

Not stored:
- Raw card numbers
- Bank credentials

Current:
- TLS in transit
- Managed Postgres encryption at rest

Not yet implemented:
- Data classification framework
- Field-level encryption
- Access audit logging
- Formal retention policy
- Automated deletion workflows

---

# 7. Monitoring & Observability

Current:
- Structured error schema
- Enumerated error codes
- Application logging
- Stripe dashboard monitoring
- Railway logs

Not yet implemented:
- SIEM
- Centralized alerting pipeline
- Auth failure anomaly alerts
- Intrusion detection
- API fuzz monitoring

Incident response:
- No formal IR runbook
- No tabletop simulations

---

# 8. CI/CD & Dependency Posture

Current:
- GitHub source control
- Staging → production promotion
- Manual deployment discipline
- Contract freeze hash enforcement

Not yet implemented:
- SAST/DAST in CI
- Dependency vulnerability scanning automation
- Signed commit enforcement
- Container image scanning
- Security gates in CI pipeline

---

# 9. Blast Radius & Containment

Backend Compromise
        ↓
Full Database Access
        ↓
User PII Exposure
        ↓
Contest Integrity Risk

Current containment:
- Single service architecture
- Environment isolation (staging vs production)

Not yet implemented:
- Row-level DB security
- Least-privilege DB roles
- Read-only runtime roles
- Network segmentation
- Tenant isolation

---

# 10. Known Gaps

Not yet implemented:

- Formal threat model documentation
- Incident response runbook
- WAF
- Advanced rate limiting
- Secrets rotation
- RBAC matrix documentation
- Penetration testing
- SOC2 controls
- Documented RTO/RPO
- Centralized SIEM
- Infrastructure as code

---

# 11. 90-Day Security Roadmap

Priority 1
- Document formal threat model
- Write incident response plan
- Enforce MFA across all accounts
- Add rate limiting middleware
- Centralized logging + alerting
- Dependency vulnerability scanning
- Backup restore validation + documented RTO/RPO

Priority 2
- Secrets manager + rotation policy
- Database role separation
- Webhook dead-letter queue
- Admin audit logging
- API fuzz testing

Priority 3
- WAF
- Data classification framework
- Formal RBAC implementation
- Penetration test
- CI security gate enforcement
- Infrastructure as code

---

# 12. Operational Constraint

Current:
- Solo technical founder
- Part-time ops partner
- Engineering, infra, payments, monitoring centralized in one role

Next inflection:
- Security maturity requires sustained operational oversight
- Ops partner must transition to full-time for proper risk management

