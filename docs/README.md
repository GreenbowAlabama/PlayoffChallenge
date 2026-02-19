# Welcome to Playoff Challenge Development

Welcome to the Playoff Challenge team. This documentation guides you through setting up your development environment and making your first contribution to the fantasy football playoff app.

## What is Playoff Challenge?

Playoff Challenge is a fantasy football application where users pick NFL players and compete for prizes based on real-time performance during the NFL playoffs.

Users can:
- Pick players for each playoff week
- Track live scores during games
- View leaderboards and compete with friends
- Manage payment and prize distribution

## Tech Stack at a Glance

Component: iOS App  
Technology: Swift / SwiftUI  
Purpose: Primary user interface  

Component: Backend API  
Technology: Node.js / Express  
Purpose: REST API with live stats  

Component: Database  
Technology: PostgreSQL  
Purpose: Hosted on Railway  

Component: Distribution  
Technology: TestFlight  
Purpose: Beta testing  

Component: External APIs  
Technology: ESPN, Sleeper  
Purpose: Live stats and player data  

## Repository Structure Overview

playoff-challenge  
- backend  
  - server.js (Main API server)  
  - schema.sql (PostgreSQL schema)  
- ios-app/PlayoffChallenge (iOS app source)  
- docs (All documentation)  
  - ai (AI workflow and prompts)  
  - architecture (System design)  
  - implementations (Setup and how-to guides)  
  - operations (Runbooks and processes)  
  - process (Contribution workflow)  
  - planning (Roadmaps)  
  - bugs (Bug analysis and fixes)  
- CLAUDE.md (AI usage rules and discipline)

## Onboarding Journey

Follow these pages in order.

### 1. Prerequisites

docs/setup/Prerequisites.md

### 2. Development Environment Setup

docs/setup/Backend-Setup.md
docs/setup/iOS-Setup.md

### 3. Understanding the System

docs/architecture/Architecture-Deep-Dive.md

### 4. Making Changes

docs/process/Making-Changes.md

## Operational Documentation

docs/operations/

## Release and Testing Documentation

docs/implementations/

## AI Workflow

docs/ai/AI_WORKFLOW.md  
docs/ai/claude-architect-prompt.md  
docs/ai/claude-worker-prompt.md  
docs/ai/handoff-template.md

## Bug History and Fixes

docs/bugs/

## Planning

docs/planning/

## Quick Links

AI usage rules: CLAUDE.md  
Production API: https://playoffchallenge-production.up.railway.app  
Health check: https://playoffchallenge-production.up.railway.app/health  

## Important Notes

- This is a public repository. Never commit secrets.
- All secrets are managed via Railway environment variables.
- Manual testing only. No automated test suite exists yet
