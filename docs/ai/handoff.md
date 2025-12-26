# Web Admin Application Architecture

## Objective

Design and specify a greenfield **Web Admin application** that provides administrative visibility and controls for the Playoff Challenge platform.

The web admin is the exclusive home for all admin functionality. No admin capabilities remain in the iOS app.

---

## High-Level Architecture

### Application Model
- **Type**: Single Page Application (SPA)
- **Hosting**: Vercel (or equivalent static/SSR hosting platform)
- **Backend**: Existing backend at current hosting location
- **Architecture Style**: Thin, API-driven client with all business logic on backend

### Design Philosophy
- Web-first experience (not constrained by prior iOS admin UI)
- Stateless frontend
- All admin authorization enforced server-side via existing `requireAdmin` middleware
- Minimal frontend complexity
- Extensible for future admin capabilities

---

## Authentication & Authorization Flow

### Overview
The web admin uses **Login with Apple** as the sole authentication mechanism. All admin routes are protected by backend middleware.

### Detailed Flow

1. **User Initiates Login**
   - User navigates to web admin root (e.g., `https://admin.playoffchallenge.com`)
   - Unauthenticated users see only a login page with "Sign in with Apple" button

2. **Apple Authentication (Client-Side)**
   - Web client invokes Apple's JS SDK for web authentication
   - User completes Apple authentication flow
   - Web client receives Apple `id_token` (JWT from Apple)

3. **Token Exchange (Backend)**
   - Web client POSTs Apple `id_token` to `/api/admin/auth/*` endpoint
   - Backend validates Apple token
   - Backend checks if authenticated user has admin privileges
   - If valid and admin: backend returns session token or sets session cookie
   - If invalid or not admin: backend returns 401/403

4. **Session Management (Client)**
   - Web client stores session token/cookie
   - All subsequent API requests include session credentials
   - Session persists across page refreshes

5. **Protected Route Access**
   - Every admin API call hits `/api/admin/*` (except initial auth)
   - Backend `requireAdmin` middleware validates session and admin status
   - Unauthorized requests receive 401/403 and trigger redirect to login

### Session Mechanism (Backend-Determined)
- Backend session/token mechanism is opaque to frontend
- Assumed to be either:
  - Session cookie (httpOnly, secure, sameSite)
  - OR bearer token returned in response body
- Frontend adapts to whichever mechanism backend uses
- No JWT decoding or session logic in frontend

---

## Recommended Tech Stack

### Frontend
- **Framework**: React 18+ with TypeScript
- **Routing**: React Router v6
- **HTTP Client**: Native Fetch API (or Axios if preferred)
- **API State Management**: React Query or SWR (handles caching, refetching, loading states)
- **UI Library**: Tailwind CSS + Headless UI (or similar accessible component library)
- **Build Tool**: Vite (fast, modern, good DX)

### Rationale
- **React + TypeScript**: Industry standard, good ecosystem, type safety
- **React Query/SWR**: Eliminates need for Redux/complex state management for API-driven apps
- **Tailwind CSS**: Rapid UI development, small bundle, no CSS-in-JS overhead
- **Vite**: Fast dev server, optimized production builds

### Hosting & Deployment
- **Primary**: Vercel (zero-config React deployment, HTTPS, edge network)
- **Alternatives**: Netlify, AWS Amplify, Cloudflare Pages
- **Build Output**: Static SPA (client-side routing)
- **Environment Variables**: Backend API URL configured via Vercel env vars

---

## API Integration Plan

### Existing Admin Endpoints (Reuse)

Based on backend analysis, the following endpoints are available and protected by `requireAdmin`:

#### User Management (Core Requirement)
| Method | Endpoint | Purpose | Request | Response |
|--------|----------|---------|---------|----------|
| GET | `/api/admin/users` | List all users | None | Array of user objects with: `id`, `email`, `phone`, `is_paid` |
| PATCH | `/api/admin/users/:userId` | Update user eligibility | `{ is_paid: boolean }` | Updated user object |

#### Additional Capabilities (Future Use)
| Method | Endpoint | Purpose | Notes |
|--------|----------|---------|-------|
| GET | `/api/admin/settings` | Read admin settings | Available for future features |
| PUT | `/api/admin/settings` | Update settings | Available for future features |
| PATCH | `/api/admin/week` | Toggle week active state | Available for future features |

### Frontend API Layer

Recommended structure:

```
src/
  api/
    client.ts          # Axios/fetch wrapper with auth headers
    auth.ts            # Login, logout, session check
    users.ts           # User list, update eligibility
    settings.ts        # Future: settings CRUD
```

Each API module exports typed functions:
- Type-safe request/response contracts
- Automatic session token inclusion
- Centralized error handling
- React Query integration

---

## UI Design (Minimum Viable)

### Page Structure

#### 1. Login Page (`/login`)
- "Sign in with Apple" button
- No other content
- Redirects to `/users` on successful auth

#### 2. User List Page (`/users`)
- **Table View** displaying:
  - User ID
  - Email (if available, else "N/A")
  - Phone (if available, else "N/A")
  - Eligibility Status (visual indicator: badge or toggle)
  - Action: Toggle eligibility button/switch
- **Functionality**:
  - Fetch users via `GET /api/admin/users`
  - Toggle eligibility via `PATCH /api/admin/users/:userId`
  - Optimistic UI updates (toggle immediately, revert on error)
  - Loading states during fetch/update
  - Error handling with user-friendly messages

#### 3. Layout (Shared)
- Top nav bar:
  - App title/logo
  - Current admin user info (if available from session)
  - Logout button
- Side nav (optional, for future expansion):
  - "Users" link
  - Placeholder for future admin sections

### Design Constraints
- **Responsive**: Desktop-first, but functional on tablet
- **Accessible**: WCAG 2.1 AA compliance (semantic HTML, ARIA labels, keyboard nav)
- **Minimal**: No unnecessary features or UI chrome

---

## Security Considerations

### Backend Enforcement (Primary)
- **All** admin authorization is enforced server-side via `requireAdmin` middleware
- Frontend NEVER assumes admin status without backend validation
- No client-side admin logic beyond UI rendering

### Frontend Security Measures

#### 1. Session Security
- If using bearer tokens: store in `localStorage` with secure practices
  - Clear on logout
  - Validate on every page load
- If using cookies: ensure backend sets `httpOnly`, `secure`, `sameSite=strict`

#### 2. CORS Configuration
- Backend must whitelist web admin origin (e.g., `https://admin.playoffchallenge.com`)
- No wildcard CORS in production

#### 3. HTTPS Only
- Web admin MUST be served over HTTPS (Vercel provides by default)
- Mixed content warnings indicate misconfiguration

#### 4. Input Validation
- Frontend validates user input (e.g., toggle actions) before sending
- Backend performs authoritative validation (never trust client)

#### 5. Error Handling
- Do NOT expose backend error details to UI (log internally, show generic messages)
- Sensitive info (stack traces, DB errors) only in server logs

#### 6. Logout
- Logout clears client-side session state AND calls backend logout endpoint (if exists)
- Redirect to login page
- Prevent back-button access to protected pages

---

## Deployment Overview

### Hosting
1. **Web Admin**: Deployed to Vercel
   - Git-based deployment (main branch = production)
   - Environment variables for backend API URL
   - Automatic HTTPS, CDN distribution

2. **Backend**: No changes to existing hosting
   - CORS updated to allow web admin origin
   - No other backend modifications required

### Environment Configuration
- **Development**: `VITE_API_URL=http://localhost:3000` (or backend dev URL)
- **Production**: `VITE_API_URL=https://api.playoffchallenge.com` (or actual backend URL)

### CI/CD (Optional)
- Vercel auto-deploys on git push (no manual CI/CD needed)
- Preview deployments for PRs

---

## API Contract Assumptions

The architecture assumes the following about `/api/admin/auth`:

### Admin Authentication Endpoint
**Assumed Endpoint**: `POST /api/admin/auth/apple` (or similar)

**Request**:
```json
{
  "id_token": "eyJraWQiOiJXNldjT0tC..."
}
```

**Response (Success - 200)**:
```json
{
  "token": "session-token-string"
}
```
OR
```
Set-Cookie: session=...; HttpOnly; Secure; SameSite=Strict
```

**Response (Unauthorized - 401/403)**:
```json
{
  "error": "Not authorized as admin"
}
```

### User List Endpoint
**Endpoint**: `GET /api/admin/users`

**Response**:
```json
[
  {
    "id": "uuid",
    "email": "user@example.com",
    "phone": "+1234567890",
    "is_paid": true
  },
  ...
]
```

### User Update Endpoint
**Endpoint**: `PATCH /api/admin/users/:userId`

**Request**:
```json
{
  "is_paid": false
}
```

**Response**:
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "phone": "+1234567890",
  "is_paid": false
}
```

---

## Risks & Guardrails

### Risk: Admin Authorization Bypass
- **Mitigation**: All admin enforcement is server-side. Frontend is untrusted.

### Risk: Session Hijacking
- **Mitigation**: HTTPS only, secure cookies (if used), short session TTL

### Risk: CORS Misconfiguration
- **Mitigation**: Explicitly whitelist admin origin, test in production

### Risk: Login with Apple Web Flow Issues
- **Mitigation**: Follow Apple's official web SDK docs, test across browsers

### Risk: Scope Creep (Admin UI Redesign)
- **Mitigation**: Architecture explicitly limits scope to minimal viable admin capabilities

### Risk: Backend API Changes
- **Mitigation**: Frontend API layer abstracts backend contracts, easy to update

---

## Forward-Looking Considerations

This architecture supports future expansion:

1. **Additional Admin Capabilities**
   - Settings management (already have endpoints)
   - Week/state controls
   - Analytics dashboards
   - User activity logs

2. **Multi-Role Admin**
   - Backend already has `requireAdmin` enforcement
   - Can extend to role-based permissions (super admin, moderator, etc.)

3. **Real-Time Updates**
   - WebSocket or SSE for live user status
   - Requires backend support

4. **Audit Logging**
   - Track admin actions (who toggled eligibility, when)
   - Backend feature, frontend just displays

---

## Exit Criteria

This architecture is complete when:

1. Web admin authenticates via Login with Apple
2. Authenticated admins can view user list (ID, email, phone, eligibility)
3. Admins can toggle user eligibility and persist changes
4. All admin API calls are protected by backend middleware
5. No admin functionality remains in iOS app
6. Web admin is deployed to production hosting

---

## Next Steps (For Worker)

This architecture is now **APPROVED FOR IMPLEMENTATION**.

The Worker agent should:

1. Scaffold React + TypeScript + Vite project
2. Implement Login with Apple web authentication
3. Integrate with `/api/admin/auth` for session creation
4. Build user list page using `/api/admin/users`
5. Implement eligibility toggle using `/api/admin/users/:userId`
6. Configure Vercel deployment
7. Test end-to-end flow with backend

**No architectural decisions remain. This is an implementation-ready handoff.**
