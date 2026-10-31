# Together Finance

A private application to track personal/shared expenses, loans, debts, and repayments. The repository contains a React visual prototype and a NestJS API with a Prisma 7 / Neon PostgreSQL foundation. Financial CRUD endpoints and authentication are planned for later stages. Frontend POV is a visual context, never proof of identity or financial ownership.

## Requirements and structure

Use Node.js 24.x and npm (verified with Node 24.18.0 and npm 11.16.0). The frontend and backend have separate packages and lockfiles:

- `frontend/`: React, TypeScript, Vite, Tailwind CSS v4, and three POV themes.
- `backend/`: NestJS 12, TypeScript, Express, Prisma 7, PostgreSQL, and health endpoint.
- `docs/design-references/`: approved visual references.
- `docs/database-design.md`: relational model, money/debt rules, transactions, migrations, and restoration policy.

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

On first setup, copy `backend/.env.example` to `backend/.env` and fill the database connections locally. Preserve an existing `.env` file instead of replacing it. Canonical names are `DATABASE_URL` (pooled runtime) and `DIRECT_URL` (direct migrations). Existing local files with a direct `DATABASE_URL` and pooled `DATABASE_URL_POOLED` are supported without rewriting their values. Then run:

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

Startup connects Prisma to the configured database. This health endpoint remains a process liveness check, not a continuous database readiness probe. The frontend has not been connected to the API yet.

## API configuration

Nest's configuration module loads `backend/.env`; process variables supplied by the hosting service take precedence. Run backend commands from `backend/` so the local file is found.

| Variable | Development default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development`, `test`, or `production` |
| `PORT` | `3000` | Integer TCP port between 1 and 65535 |
| `CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | Comma-separated exact allowed frontend origins |
| `DATABASE_URL` | None; required | Pooled runtime PostgreSQL connection; never expose it to the frontend |
| `DIRECT_URL` | None | Direct PostgreSQL connection for Prisma migration commands; not required by the running API |

Production requires an explicit, nonempty `CORS_ORIGINS`. Wildcards, URL credentials, paths, queries, and fragments are rejected. Optional trailing slashes are normalized. Cross-origin cookies/credentials are disabled. Unlisted origins receive no CORS permission header; command-line clients can still call the health endpoint because CORS is a browser policy, not authentication.

The root `.gitignore` excludes `.env` and `.env.*` while allowing `.env.example`. Do not put secrets in the example file or commit local configuration.

## Backend architecture and checks

`AppModule` loads configuration, `PrismaModule`, and `HealthModule`. The singleton `PrismaService` uses the PostgreSQL driver adapter and a bounded pool. `HealthController` and `HealthService` retain their separation. `configure-app.ts` applies the global `/api` prefix, exact-origin CORS, and DTO validation. Future request DTOs must use validation decorators for their allowed properties.

From `backend/`:

```powershell
npm run prisma:validate
npm run prisma:generate
npm run prisma:migrate:status
npm run build
npm run lint
npm test
npm run test:e2e
npm audit
npm audit --omit=dev
```

The NestJS 12 scaffold uses type-aware Oxlint and Vitest. The end-to-end validation probe exists only in the test application, not in the real API.

The reviewed initial migration is `20261031170000_initial_financial_schema`. It was applied to an inspected empty database without seed data. Existing installations use `npm run prisma:migrate:status`; new installations must follow the inspection/review procedure in [database design](docs/database-design.md) before `npm run prisma:migrate:deploy`. Never reset the existing database. Build and development startup generate Prisma Client automatically.

## Hosting preparation

- **Vercel frontend:** root directory `frontend`, build command `npm run build`, output directory `dist`.
- **Render backend:** root directory `backend`, build command `npm ci --include=dev && npm run build`, start command `npm run start:prod`. Use Node 24.x, set `NODE_ENV=production`, set `CORS_ORIGINS` to the exact deployed frontend origin, and use `/api/health` as the health-check path. Render supplies `PORT`; the API binds to `0.0.0.0`.
- **Neon PostgreSQL:** Prisma 7 is integrated. Apply reviewed migrations from a trusted migration environment using the direct connection before deploying the API. Runtime uses the pooled connection. Never run migrations automatically on API startup or put a database URL in a `VITE_` variable.

These are configuration instructions, not completed deployments. No authentication or financial business endpoints exist yet.

See the [frontend documentation](frontend/README.md) for the visual prototype and [backend documentation](backend/README.md) for the API structure and audit findings.
