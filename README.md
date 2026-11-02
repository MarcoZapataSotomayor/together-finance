# Together Finance

A private application to track personal/shared expenses, loans, debts, and repayments. The React frontend connects its themed dashboard, expense, debt, loan and repayment screens to a NestJS API with shared-password authentication and Prisma 7 / Neon PostgreSQL. Frontend POV controls the visual context and visible financial summaries, never proof of identity or financial ownership. Mutation forms require explicit financial parties.

## Requirements and structure

Use Node.js 24.x and npm (verified with Node 24.18.0 and npm 11.16.0). The frontend and backend have separate packages and lockfiles:

- `frontend/`: React, TypeScript, Vite, Tailwind CSS v4, and three POV themes.
- `backend/`: NestJS 12, TypeScript, Express, Prisma 7, PostgreSQL, and health endpoint.
- `docs/design-references/`: approved visual references.
- `docs/database-design.md`: relational model, money/debt rules, transactions, migrations, and restoration policy.
- `docs/authentication.md`: shared-password setup, sessions, CSRF, tests, and deployment limits.
- `docs/ci-cd.md`: GitHub Actions CI, local reproduction, and future delivery concepts.
- `docs/expenses-api.md`: protected expense/reference endpoints, examples, transactions, and repayment safeguards.
- `docs/debts-api.md`: protected debt summaries, independent loans, repayments, retries and restoration rules.
- `docs/frontend-expenses.md`: API-backed form/history, reference setup, draft recovery, and validation.
- `docs/frontend-debts.md`: debt/loan/payment screens, directional POV defaults, exact amounts, retry recovery, browser validation and limitations.
- `docs/analytics.md`: exact spending analytics, monthly/category analysis, funding versus allocation, themed dashboard, tests and limits.
- `docs/data-management.md`: protected CSV formats, filtered exports, centralized recovery, permanent-deletion restrictions, resource limits and validation.

## Start the frontend

In a terminal at the repository root:

```powershell
cd frontend
npm ci
npm run dev
```

Open the URL printed by Vite, normally `http://localhost:5173`. If Vite chooses another port, add that exact frontend origin to the backend's `CORS_ORIGINS` value.

After authentication, `#/dashboard` is the default home. Resumen displays actual monthly/range spending, categories, trends, contributions, recent expenses and current debts. Current debt obligations cover all dates and are kept separate from the selected spending period. No income or available-bank-balance feature is implemented.

**Exportar** (`#/exports`) downloads explicitly scoped financial CSV files. **Eliminados** (`#/recycle-bin`) filters directly deleted expenses, loans and repayments and restores them through the existing financial checks. Permanent deletion remains unavailable to preserve history and idempotency. See [data management](docs/data-management.md) for endpoints, security, limits and the validation checklist.

## Start the API

In a second terminal at the repository root:

```powershell
cd backend
npm ci
```

On first setup, copy `backend/.env.example` to `backend/.env` and fill the database connections locally. Preserve an existing `.env` file instead of replacing it. Canonical names are `DATABASE_URL` (pooled runtime) and `DIRECT_URL` (direct migrations). Existing local files with a direct `DATABASE_URL` and pooled `DATABASE_URL_POOLED` are supported without rewriting their values. Then run:

```powershell
npm run auth:setup
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

The interactive setup hides the password and saves only a salted hash and an independently generated session secret to the ignored backend `.env`. It preserves database configuration and refuses to replace existing auth keys unless explicitly run with `npm run auth:setup -- --rotate`. Choose your own password locally; no default password exists. Restart the API after changing authentication configuration.

Startup connects Prisma to the configured database. This public health endpoint remains a process liveness check, not a continuous database readiness probe. Vite proxies `/api` to port 3000 for authentication and financial requests. Before manual writes, verify the intended Neon development branch. The UI creates reference data only on explicit actions and supports saving, listing, editing, soft deletion, and restoration of expenses.

## API configuration

Nest's configuration module loads `backend/.env`; process variables supplied by the hosting service take precedence. Run backend commands from `backend/` so the local file is found.

| Variable | Development default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development`, `test`, or `production` |
| `PORT` | `3000` | Integer TCP port between 1 and 65535 |
| `CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | Comma-separated exact allowed frontend origins |
| `DATABASE_URL` | None; required | Pooled runtime PostgreSQL connection; never expose it to the frontend |
| `DIRECT_URL` | None | Direct PostgreSQL connection for Prisma migration commands; not required by the running API |
| `SHARED_PASSWORD_HASH` | None; required | Salted scrypt hash generated by `npm run auth:setup` |
| `SESSION_SECRET` | None; required | Independent random signing secret generated by setup |
| `SESSION_TTL_SECONDS` | `28800` | Absolute authenticated session lifetime; 60–86400 seconds |
| `SESSION_COOKIE_SAME_SITE` | `lax` | `lax`, `strict`, or opt-in `none` for production HTTPS |
| `TRUST_PROXY_HOPS` | `0` | Verified number of trusted proxies; 0, 1, or 2 |

Production requires explicit, nonempty HTTPS `CORS_ORIGINS`. Wildcards, URL credentials, paths, queries, and fragments are rejected. Optional trailing slashes are normalized. Credentialed CORS permits only exact configured origins. Authentication uses HttpOnly cookies, while all state-changing requests also require an allowed Origin and a session-bound `X-CSRF-Token`. CORS alone is not authentication.

The root `.gitignore` excludes `.env` and `.env.*` while allowing `.env.example`. Do not put secrets in the example file or commit local configuration.

## Backend architecture and checks

`AppModule` loads configuration, `PrismaModule`, `AuthModule`, `HealthModule`, `ExpensesModule`, `ReferenceDataModule`, `DebtsModule`, `LoansModule`, and `RepaymentsModule`. The singleton `PrismaService` uses the PostgreSQL driver adapter and a bounded pool. Global authentication guards protect routes unless explicitly marked public; health, session bootstrap, and login are public. `configure-app.ts` applies the global `/api` prefix, exact-origin credentialed CORS, and DTO validation. Future request DTOs must use validation decorators for their allowed properties.

The debt API supports filtered/paginated obligations, directional summaries, independent loan CRUD with soft deletion/restoration, and repayment creation/history/deletion/restoration. It reuses the existing schema and exact Decimal helpers. Financial writes use Serializable transactions with bounded retries, and creation UUIDs must be retained across retries. Repayment history freezes principal, parties and incurrence dates. No loan/repayment is counted as spending. See [debt API documentation](docs/debts-api.md) for payloads and limits. Current backend checks pass lint/build, 135 unit tests and 147 API tests; concurrency scenarios are mock-tested, not verified against a real PostgreSQL server. No live Neon records were created for this task.

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

## Continuous integration

GitHub Actions runs independent **Frontend** and **Backend** CI jobs for PRs targeting `develop`/`main` and pushes to those branches. Both use Node 24, locked npm installs, lint, tests, and production builds; the backend also generates and validates Prisma without database credentials. This workflow does not deploy or run migrations. See [CI/CD documentation](docs/ci-cd.md) for the commands, cache behavior, security boundaries, and how to inspect runs.

## Hosting preparation

- **Vercel frontend:** root directory `frontend`, build command `npm run build`, output directory `dist`.
- **Render backend:** root directory `backend`, build command `npm ci --include=dev && npm run build`, start command `npm run start:prod`. Use Node 24.x, set `NODE_ENV=production`, set `CORS_ORIGINS` to the exact deployed frontend origin, and use `/api/health` as the health-check path. Render supplies `PORT`; the API binds to `0.0.0.0`.
- **Neon PostgreSQL:** Prisma 7 is integrated. Apply reviewed migrations from a trusted migration environment using the direct connection before deploying the API. Runtime uses the pooled connection. Never run migrations automatically on API startup or put a database URL in a `VITE_` variable.

These are configuration instructions, not completed deployments. Configure the required authentication keys as private backend environment variables. The current session/rate-limit store supports **one backend instance**; restart or redeployment ends all sessions. For reliable cookies, prefer a same-origin `/api` reverse proxy or HTTPS subdomains under the same registrable domain. Separate `vercel.app` / `onrender.com` domains require `SameSite=None; Secure`, and browsers can still block their third-party cookies. See [authentication deployment options](docs/authentication.md#production-deployment) before deploying. Expense/reference endpoints are implemented; verify the intended development database before manual writes and read [expense safeguards](docs/expenses-api.md).

See the [frontend documentation](frontend/README.md) for the expense interface and [backend documentation](backend/README.md) for the API structure and audit findings.
