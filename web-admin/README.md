# Playoff Challenge Admin

Web admin application for managing the Playoff Challenge platform.

## Tech Stack

- **Framework**: React 18 + TypeScript
- **Build Tool**: Vite
- **Routing**: React Router v6
- **API State**: TanStack Query (React Query)
- **Styling**: Tailwind CSS + Headless UI
- **Hosting**: Railway

## Development

### Prerequisites

- Node.js 18+
- npm

### Setup

1. Install dependencies:
```bash
npm install
```

2. Configure environment variables:
```bash
# .env (development)
VITE_API_BASE_URL=http://localhost:3000
VITE_APPLE_CLIENT_ID=<APPLE_WEB_SERVICE_ID>

# .env.production
VITE_API_BASE_URL=https://playoffchallenge-production.up.railway.app
VITE_APPLE_CLIENT_ID=<APPLE_WEB_SERVICE_ID>
```

3. Start development server:
```bash
npm run dev
```

The app will be available at `http://localhost:5173`

## Deployment

### Railway Deployment

**Platform**: Railway (same platform as backend)

1. Create new Railway service for web admin

2. Configure build settings in Railway:
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npx serve -s dist -l $PORT`
   - **Root Directory**: `web-admin/` (if deploying from monorepo root)

3. Add environment variables in Railway dashboard:
   - `VITE_API_BASE_URL`: `https://playoffchallenge-production.up.railway.app`
   - `VITE_APPLE_CLIENT_ID`: `<your Apple Web Service ID>`

4. Install serve for static hosting:
```bash
npm install -D serve
```

5. Add start script to `package.json` (if not present):
```json
{
  "scripts": {
    "start": "serve -s dist -l $PORT"
  }
}
```

6. Deploy via GitHub push or Railway CLI

### Backend CORS Configuration

Ensure backend allows web admin origin:

```typescript
// In backend CORS config
const allowedOrigins = [
  'https://<WEB_ADMIN_RAILWAY_DOMAIN>',
  // e.g., 'https://playoff-admin-production.up.railway.app'
];
```

## Features

### Authentication
- Login with Apple (web flow)
- Session-based authentication
- Protected routes

### User Management
- View all users (ID, email, phone, eligibility status)
- Toggle user eligibility (is_paid field)
- Optimistic UI updates
- Real-time data synchronization

## API Integration

The app integrates with the following backend endpoints:

- `POST /api/admin/auth/apple` - Apple authentication
- `GET /api/admin/users` - List users
- `PATCH /api/admin/users/:userId` - Update user eligibility

All admin routes are protected by backend `requireAdmin` middleware.

## Project Structure

```
web-admin/
├── src/
│   ├── api/              # API client and endpoints
│   │   ├── client.ts     # HTTP client wrapper
│   │   ├── auth.ts       # Authentication API
│   │   └── users.ts      # User management API
│   ├── components/       # React components
│   │   ├── Layout.tsx    # Main layout with nav
│   │   └── ProtectedRoute.tsx  # Route guard
│   ├── pages/            # Page components
│   │   ├── Login.tsx     # Login page
│   │   └── Users.tsx     # User list page
│   ├── types.ts          # TypeScript types
│   ├── App.tsx           # Root component with routing
│   └── main.tsx          # Entry point
├── .env                  # Development config
├── .env.production       # Production config
└── package.json
```

## Environment Variables

### Frontend (Railway Web Admin Service)

| Variable | Purpose | Example |
|----------|---------|---------|
| `VITE_API_BASE_URL` | Backend API URL | `https://playoffchallenge-production.up.railway.app` |
| `VITE_APPLE_CLIENT_ID` | Apple Web Service ID | `com.example.playoffchallenge.web` |

### Backend (Railway API Service)

| Variable | Purpose | Example |
|----------|---------|---------|
| `CORS_ORIGIN` | Allowed web admin origin | `https://playoff-admin-production.up.railway.app` |

## Security

- All admin authorization enforced server-side
- HTTPS only (enforced by Railway)
- Session tokens stored in localStorage
- CORS configured to whitelist admin origin
- No sensitive data exposed in client errors

## Deployment Checklist

- [ ] Web admin deployed to Railway
- [ ] Backend deployed to Railway
- [ ] `VITE_API_BASE_URL` set in Railway web admin env vars
- [ ] `VITE_APPLE_CLIENT_ID` set in Railway web admin env vars
- [ ] Backend CORS allows web admin Railway domain
- [ ] Apple Sign In configured for web admin domain
- [ ] Test login flow end-to-end
- [ ] Test user list and eligibility toggle

## Notes

- **Single Platform**: Both frontend and backend deployed on Railway
- **No Platform Drift**: Unified deployment model
- **Environment Variables**: All config via Railway env vars, no hardcoded values
- **Client-Side Routing**: Serve configuration ensures SPA routing works correctly
