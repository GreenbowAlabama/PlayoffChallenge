# System Blueprint
67 Enterprises – Playoff Challenge Platform

Purpose

This document provides a visual blueprint of the system architecture and data flows.

The blueprint aligns with governance tower documentation so engineers and AI agents can:

- understand system boundaries
- follow high-level data flows
- trace integrations
- correlate architecture with governance documentation

Typical usage:

Left side → System Blueprint Diagram  
Right side → Governance Tower Documents

This allows developers to visually trace the architecture while reviewing system rules.

---

# System Architecture Towers

The platform is organized into the following architecture towers:

01-platform-architecture  
02-contest-engine  
03-financial-ledger  
04-discovery-system  
05-user-system  
06-admin-operations  
07-api-contracts  
08-client-lock  
09-ai-governance  
10-production-runbooks  

Each tower contains the canonical governance documentation for that subsystem.

---

# High-Level System Blueprint

```mermaid
flowchart LR

subgraph Clients
IOS[iOS App]
ADMIN[Web Admin]
end

subgraph API Layer
API[Backend API Server]
AUTH[Auth / User System]
CONTEST_API[Contest API]
WALLET_API[Wallet API]
end

subgraph Core Systems
CONTEST_ENGINE[Contest Engine]
DISCOVERY[Discovery Worker]
INGESTION[Player Ingestion]
LEADERBOARD[Leaderboard Service]
end

subgraph Financial System
LEDGER[Financial Ledger]
PAYMENTS[Stripe Integration]
WITHDRAWALS[Withdraw Pipeline]
end

subgraph Data Layer
DB[(PostgreSQL Database)]
end

IOS --> API
ADMIN --> API

API --> AUTH
API --> CONTEST_API
API --> WALLET_API

CONTEST_API --> CONTEST_ENGINE
CONTEST_ENGINE --> LEADERBOARD
CONTEST_ENGINE --> DB

DISCOVERY --> CONTEST_ENGINE
DISCOVERY --> INGESTION

INGESTION --> DB

WALLET_API --> LEDGER
LEDGER --> DB

PAYMENTS --> LEDGER
WITHDRAWALS --> PAYMENTS

ADMIN --> DISCOVERY
ADMIN --> LEDGER
ADMIN --> CONTEST_ENGINE
```

---

# System Data Flows

## User Onboarding Flow

User → Apple Login → API → User Creation → Wallet Initialization

Key Systems

- User System
- Authentication
- Wallet initialization

---

## Contest Discovery Flow

ESPN API → Discovery Worker → Contest Templates → Contest Instances

Key Systems

- Discovery Worker
- Contest Engine
- Database

---

## Contest Entry Flow

User → Join Contest → Wallet Debit → Ledger Entry → Contest Entry Recorded

Key Systems

- Contest Engine
- Wallet API
- Financial Ledger

---

## Lineup Submission Flow

User → Submit Lineup → Contest Validation → Picks Stored

Key Systems

- Player Ingestion
- Contest Engine
- Picks storage

---

## Leaderboard Flow

Player Scores → Ingestion → Contest Scoring → Leaderboard Update

Key Systems

- Ingestion pipeline
- Contest scoring engine
- Leaderboard service

---

## Deposit Flow

User → Deposit → Stripe → Ledger Credit → Wallet Balance Update

Key Systems

- Stripe integration
- Financial ledger

---

## Withdraw Flow

User → Withdraw Request → Ledger Debit → Stripe Payout

Key Systems

- Withdraw pipeline
- Stripe integration
- Financial ledger

---

# Financial Invariant

The platform enforces the following invariant:

SUM(ledger credits) - SUM(ledger debits) = wallet balances

The ledger is:

- append only
- never mutated
- never deleted

---

# Admin Operations

Web Admin provides operational tooling for:

- contest creation
- entry tier management
- marketing contest flag
- refund entry
- cancel contest
- replay discovery
- reconciliation
- financial dashboards
- user lookup

Admin operations must follow governance rules defined in:

docs/governance/06-admin-operations/

---

# AI Governance Integration

AI agents must reference governance towers before implementing changes.

Required loading order:

1 AI_ENTRYPOINT.md  
2 AI_WORKER_RULES.md  
3 CLAUDE_RULES.md  
4 Governance tower documentation  

AI agents must never invent architecture that contradicts governance.

---

# Blueprint Maintenance Rule

When system architecture changes:

1 Update governance tower documentation  
2 Update this SYSTEM_BLUEPRINT.md diagram  
3 Verify blueprint reflects real system behavior  

Documentation must remain driftless with the running system.

---

End of Document