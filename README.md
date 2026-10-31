# Together Finance

A private application for Antonella and Marco to track personal/shared expenses, loans, debts, and repayments. The repository currently contains a React visual prototype and a NestJS API foundation. Database integration and financial business features are planned for later stages. Frontend POV is a visual context, never proof of identity or financial ownership.

## Requirements and structure

Use Node.js 24.x and npm (verified with Node 24.18.0 and npm 11.16.0). The frontend and backend have separate packages and lockfiles:

- `frontend/`: React, TypeScript, Vite, Tailwind CSS v4, and three POV themes.
- `backend/`: NestJS 12, TypeScript, Express, environment configuration, and health endpoint.
- `docs/design-references/`: approved visual references.

## Start the frontend

In a terminal at the repository root:

```powershell
cd frontend
npm ci
npm run dev
```

Open the URL printed by Vite, normally `http://localhost:5173`. If Vite chooses another port, add that exact frontend origin to the backend's `CORS_ORIGINS` value.

## Start the API

In a second terminal at the repository root:

```powershell
cd backend
npm ci
```

On first setup, copy `backend/.env.example` to `backend/.env`. Preserve an existing `.env` file and edit its settings instead of replacing it. Then run:

```powershell
npm run start:dev
```

The API defaults to `http://localhost:3000/api`. Verify it in PowerShell:

```powershell
Invoke-RestMethod http://localhost:3000/api/health
```

Expected JSON:

```json
{
  "status": "ok",
  "application": "Together Finance"
}
```

This is an application liveness endpoint; it does not check a database. The frontend has not been connected to the API yet.

## API configuration

Nest's configuration module loads `backend/.env`; process variables supplied by the hosting service take precedence. Run backend commands from `backend/` so the local file is found.

| Variable | Development default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development`, `test`, or `production` |
| `PORT` | `3000` | Integer TCP port between 1 and 65535 |
| `CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | Comma-separated exact allowed frontend origins |

Production requires an explicit, nonempty `CORS_ORIGINS`. Wildcards, URL credentials, paths, queries, and fragments are rejected. Optional trailing slashes are normalized. Cross-origin cookies/credentials are disabled. Unlisted origins receive no CORS permission header; command-line clients can still call the health endpoint because CORS is a browser policy, not authentication.

The root `.gitignore` excludes `.env` and `.env.*` while allowing `.env.example`. Do not put secrets in the example file or commit local configuration.

## Backend architecture and checks

`AppModule` loads configuration and `HealthModule`. `HealthController` handles the route, while `HealthService` returns its response. `configure-app.ts` applies the global `/api` prefix, exact-origin CORS, and `ValidationPipe` with transformation, `whitelist`, and `forbidNonWhitelisted`. Future request DTOs must use validation decorators for their allowed properties.

From `backend/`:

```powershell
npm run build
npm run lint
npm test
npm run test:e2e
npm audit
npm audit --omit=dev
```

The NestJS 12 scaffold uses type-aware Oxlint and Vitest. The end-to-end validation probe exists only in the test application, not in the real API.

## Hosting preparation

- **Vercel frontend:** root directory `frontend`, build command `npm run build`, output directory `dist`.
- **Render backend:** root directory `backend`, build command `npm ci --include=dev && npm run build`, start command `npm run start:prod`. Use Node 24.x, set `NODE_ENV=production`, set `CORS_ORIGINS` to the exact deployed frontend origin, and use `/api/health` as the health-check path. Render supplies `PORT`; the API binds to `0.0.0.0`.
- **Neon PostgreSQL and Prisma:** planned only; neither is installed or connected.

These are configuration instructions, not completed deployments. No authentication or financial business endpoints exist yet.

See the [frontend documentation](frontend/README.md) for the visual prototype and [backend documentation](backend/README.md) for the API structure and audit findings.
