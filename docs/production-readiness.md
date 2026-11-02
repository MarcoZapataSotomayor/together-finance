# Production readiness and security review

## Status

This stage prepares deployment; it does **not** deploy or certify the application as production-ready. Genuine PostgreSQL concurrency and local backup/restore checks now pass. Production HTTPS/proxy/cookie behavior, a protected real-data backup process, operational recovery ownership and acceptance of restart-driven logouts remain release gates. No existing Neon development or production database was used for integration tests, migrations, resets, restores or writes during this work.

The approved frontend, three POV themes, shared-password architecture and financial schema are unchanged. There are no individual accounts, new financial features, paid services or deployment hooks.

## Findings and focused fixes

| Severity | Finding and impact | Resolution / remaining action |
| --- | --- | --- |
| High, fixed | Real simultaneous repayments exposed a commit-time `DriverAdapterError` with `cause.kind=TransactionWriteConflict`. The existing retry loop recognized `P2034` only. PostgreSQL aborted the conflicting transaction, but an affordable request could fail unexpectedly rather than retry. | Recognize only that specific adapter conflict in the existing whole-transaction retry loop. Keep Serializable isolation, three attempts, 20/40 ms delays and safe 409 exhaustion. Do not retry ambiguous connection errors. Unit tests and synchronized real PostgreSQL tests cover the fix. |
| Medium, fixed | The redacting Prisma wrapper previously forwarded arbitrary CLI commands/flags, including destructive ones. An operator could run a reset through the apparently safe wrapper. | Allow only format, generate, validate, migration status and explicitly reviewed deployment migrations. Deploy requires a target classification, exact direct host/database pins and approval. Disposable migrations require the generated test namespace. This is an operator guard, not a barrier against someone deliberately invoking Prisma/SQL directly. |
| Low, fixed | API responses exposed the Express signature and lacked uniform defensive response headers; JSON used a larger default body allowance. | Disable the signature; add no-store, nosniff, frame denial, no-referrer, restrictive API-only CSP, production HSTS and a 32 KiB JSON limit. Tests cover public/denied responses, production HSTS and oversized input. The frontend's separate CSP example is not enabled until deployment QA. |
| Medium, unresolved | Sessions and rate-limit counters are process-local. Restart invalidates sessions and resets counters; multiple backend instances would disagree about authentication and limits. | Deploy at most one backend instance for the current design. Explicitly accept re-login after restart or implement a separately reviewed persistent session/rate-limit store before promising seamless sessions/scaling. No persistence schema was introduced here. |
| High release gate | Cross-site cookies between unrelated Vercel/Render domains can be blocked; unverified proxy trust can undermine per-IP limiting. | Prefer the same-origin `/api` proxy described below. Verify forwarded Origin, cookies, HTTPS and real client IP behavior in an isolated preview, including requests directly to the Render URL. Never guess proxy hops or trust all proxies. |
| High operational release gate | A disposable fixture restore is proven; a protected production backup schedule and a restore of an actual production backup are not established. | Assign a backup owner, encrypt/protect local storage, retain independent copies and complete a privately reviewed recovery drill before real financial use. See [backup and restore](backup-restore.md). |
| Moderate, unresolved | `npm audit`: backend 2 and frontend 12 moderate findings in development tooling, through minimatch glob amplification and dependent CLI/ESLint packages. | No forced fix, major downgrade or global minimatch override. Audit suggests incompatible toolchain changes. Upgrade compatible parent releases in a separate tested dependency task. Both `npm audit --omit=dev` reports contain zero findings; this does not prove absence of all vulnerabilities. |
| Low, unresolved | The pinned Prisma/pg stack emits a warning about overlapping queries on a pg client during real tests. The current pg 8 release accepts these calls, but warns about pg 9 behavior. | Keep the tested lockfiles; monitor adapter/client updates and rerun real tests before upgrades. Do not suppress the warning or claim pg 9 compatibility. |

Prisma documents retrying serialization failures in its [transaction guidance](https://www.prisma.io/docs/orm/v7/prisma-client/queries/transactions). The installed adapter source was inspected to distinguish its commit-time discriminant from generic failures; no upstream package was patched.

### Security properties reviewed and retained

- Passwords use Node's asynchronous scrypt (`N=131072`, `r=8`, `p=1`), a random 16-byte salt and 64-byte digest with constant-time comparison. Environment configuration accepts only the generated hash format and rejects plaintext password configuration. The separate signing secret requires at least 32 bytes. Only one password verification runs at once.
- Signed opaque 32-byte session IDs use server-side records and independent CSRF tokens. Login rotates ID/token; logout removes the session. Default absolute expiry is eight hours, configurable from 60 seconds to one day, with no silent sliding extension. Expired cookies or signatures cannot recreate an authenticated session. Restart invalidation is tested.
- Production cookies are Secure, HttpOnly, host-only `__Host-` cookies with Path `/`. Default SameSite is Lax; None is explicit, requires production mode and is not a universal third-party-cookie workaround. There is no Domain attribute and no auth token in localStorage.
- Global session protection covers financial, analytics, export, historical-person and recycle-bin endpoints. Only health and the intended auth bootstrap/login routes are public. POV never authorizes a request or determines a form's payer.
- Unsafe requests require the allowlisted Origin and session CSRF header; JSON is required except for existing DELETE handling. CORS uses exact origins and credentials, never a wildcard; only Content-Disposition is additionally exposed for CSV. Both the app's own origin and an allowed frontend origin must be configured correctly for a proxy deployment.
- Login limits remain five attempts/IP and sixty globally per fifteen minutes, with Retry-After; the expensive verifier also has a concurrency gate. Proxy settings must reflect every reachable ingress route.
- Database exceptions on financial routes are masked. Prisma lifecycle failures and the new CLI tools emit safe messages. No request-body/cookie/credential logging was added. Do not enable Prisma query/parameter logs or verbose dump output for financial data.
- CSV exports retain exact decimal strings, quoted UTF-8 output, formula neutralization, explicit deletion scope, row/byte caps and private temporary files. They are not backups. See [data management](data-management.md).
- `.env` files and backup archives are ignored. The scoped repository check detects tracked/unignored environment files, backup archives, private-key blocks and literal Neon credential URLs without printing values. Current tracked text and `.env` path history checks found no such exposures. This is not a comprehensive historical secret scan; rotate anything ever disclosed through another channel.

## Financial invariants and real database coverage

All money remains Prisma Decimal / integer cents in PEN. Expense allocations sum to the expense and 100%, with the existing deterministic remainder rule. Funding differs from responsibility. A loan is one debt record; neither loan disbursement nor repayment is new spending. Active balances follow the complete source/deletion chain. All financial foreign keys remain Restrict, and deleted repayment history still freezes principal, counterparties and original dates. Permanent deletion stays unavailable.

`npm run test:postgres` uses an official digest-pinned PostgreSQL 17 container with a random password, localhost-only dynamic port and temporary RAM-backed data. It creates a unique `together_finance_test_<run-id>` database, applies the existing reviewed migration and runs the real Prisma adapter and domain services. No table truncation, reset or drop operation is used. Containers are stopped only after checking the run's identifying label. Tests fail rather than silently skip if Docker/configuration is unavailable.

The concurrency adapter synchronizes the first two real reads inside independent real Serializable transactions. It does not fake results, conflicts or commits. Tests assert the overlapping reads and actual retries, then inspect committed state:

1. Two 60.00 payments against 100.00: one commits, one receives a financial 409, and the balance remains 40.00.
2. Concurrent 60.00 and 40.00 payments: both commit after conflict handling, leaving zero outstanding and two payment rows.
3. Concurrent expense modifications: retries preserve unrelated changed metadata and keep the final expense, allocations and source debt consistent.
4. A genuine PostgreSQL CHECK failure after service writes rolls back the expense, allocations and debt.
5. Concurrent creation of the same expense UUID produces one expense, two allocations and one source debt; duplicate loan creation produces one loan.
6. Related deletion/restoration preserves separate child flags, history and overpayment protections; active analytics/debt summaries exclude deleted ancestry.
7. The real recycle-bin UNION query is exercised against PostgreSQL.
8. A real pg_dump archive round-trips into a freshly created restore database. Fingerprints match all seven financial tables, migration metadata, constraints and indexes; checksum corruption and attempts to reuse a restore target fail.

These tests exercise selected interleavings, not every possible workload or provider failure. They do not prove Neon-specific proxy/pool behavior, high-load capacity or successful Ubuntu-hosted Actions execution.

## CI

The existing backend job now has an official PostgreSQL 17 service pinned to the same image digest as local checks. It uses only deterministic runner-local credentials; no repository/Neon/auth secret is required. `test:postgres` creates another unique database in that disposable cluster. Container-local PostgreSQL tools match the service version for backup drills. The externally supplied CI-service path was also exercised locally.

The workflow adds database-safety tests and the scoped repository check, retains npm ci, separate frontend/backend caches, Node 24, read-only contents, cancellation of obsolete runs and the existing timeouts. It creates no cloud infrastructure, uploads no database artifacts and performs no deployment. A PostgreSQL service adds a short bounded check to the existing job; private-repository runner minutes still count against the account's allowance. Refresh pinned actions/images with reviewed updates. [CI documentation](ci-cd.md) explains the general workflow.

## Render and Vercel preparation

For the isolated staging procedure, use [staging deployment](staging-deployment.md). The checked-in `frontend/vercel.json` is staging-only and deliberately refuses an unconfigured target. `render.staging.yaml` disables automatic deployments and must be selected explicitly; creating a Blueprint still initiates its first deployment. The older generic Vercel example below remains inactive and is not the staging configuration.

| Setting | Frontend / Vercel | Backend / Render |
| --- | --- | --- |
| Root directory | `frontend` | `backend` |
| Runtime | Node 24.x, maintained patch | Node 24.x, maintained patch |
| Install/build | `npm ci`, then `npm run build` | `npm ci --include=dev && npm run build` |
| Output/start | `dist` | `npm run start:prod` (`node dist/main.js`) |
| Health | Static frontend smoke check | `/api/health` |
| Database action at build/start | None | Generate Prisma Client only; never migrate automatically |

Render supplies `PORT`; the validated app listens on `0.0.0.0`, defaulting to 3000 locally. Generation runs in prebuild. Keep TypeScript/Nest/Prisma build tools available during the build; optional production dependency pruning happens only after a verified build.

Backend environment:

- `NODE_ENV=production`, with Render's supplied PORT.
- `DATABASE_URL`: pooled Neon **production** connection with TLS, entered only in backend secrets. Verify the branch in the Neon console rather than inferring it from the database name. Existing legacy local URL naming remains supported; production should use canonical names.
- `DIRECT_URL`: direct TLS connection only for reviewed migrations; keep it out of the running service if it is not needed there. Use a separate operator environment where practical. Never expose either URL through a `VITE_` variable.
- `SHARED_PASSWORD_HASH`, independently generated `SESSION_SECRET`, `SESSION_TTL_SECONDS=28800`, `SESSION_COOKIE_SAME_SITE=lax` for the recommended same-origin path.
- `CORS_ORIGINS`: only the exact approved HTTPS frontend origin(s); no wildcard previews. Add a particular isolated preview explicitly when testing it.
- `TRUST_PROXY_HOPS`: a verified number from 0–2 for the actual ingress; test spoofed forwarded headers and the public direct Render route before selecting it. Do not copy an assumed value from a tutorial.

Vercel needs only public `VITE_API_URL=/api` for the recommended proxy. [vercel.example.json](deployment/vercel.example.json) is an **inactive example**, not a deployed configuration. Replace the placeholder destination and review it before copying into `frontend/vercel.json`. It uses an external `/api/:path*` rewrite and defensive frontend headers; validate CSP initially in an isolated preview/report-only mode if needed. Bundled fonts remain local, and existing chart style attributes are allowed without allowing inline scripts. The current hash routes do not require a catch-all SPA rewrite. Do not redirect API traffic to index.html or enable rewrite caching for private data. Vercel supports external API proxy rewrites; see [its documentation](https://vercel.com/docs/routing/rewrites).

Verify the proxy preserves Origin, Cookie, Set-Cookie, CSRF headers, status codes, query parameters, CSV bytes and attachment headers. Browser cookies should belong to the frontend origin. SameSite Lax works because the browser calls its own `/api`; the API's Origin checks must still see the frontend origin. If using sibling custom domains instead, HTTPS sites may share a site while remaining distinct origins; keep exact CORS and host-only cookies. Separate unrelated default hosting domains require SameSite None and can still fail in privacy-restrictive browsers, so that topology is not the preferred release path.

### Restarts, availability and migration release procedure

Render's Free service sleeps after fifteen idle minutes, can take about a minute to resume, and may restart unexpectedly. Filesystem changes are ephemeral. These provider limits are described in [Render's free-service documentation](https://render.com/docs/free). Financial records survive in Neon, but in-memory sessions and rate limits do not. CSV temporary files are disposable; **never use the Render filesystem as backup storage**.

The frontend already shows loading/server-waking states and bounds read retries; mutations are never automatically repeated. Users can re-login/retry after a timeout, using the existing UUID recovery logic for uncertain writes. Do not add keep-alive polling or paid uptime services. Health is liveness, not a guarantee that a later database operation will succeed. Graceful shutdown disconnects Prisma; an interrupted transaction must be retried as a new whole operation with the same creation UUID. Do not introduce multiple instances with the current store.

Before any future migration: confirm branch/endpoint in the console; take and verify a protected backup; review SQL for destructive statements and compatibility with the currently running revision; rehearse on a fresh restored local copy. A deliberate operator then supplies `MIGRATION_TARGET=production`, `MIGRATION_EXPECTED_HOST`, `MIGRATION_EXPECTED_DATABASE` and `MIGRATION_APPROVED=yes` alongside the direct URL and runs `npm run prisma:migrate:deploy`. Development uses its own explicit target/pins. The flags record operator intent, not proof that a backup was reviewed. There are **no new migrations in this stage**. Never invoke reset, force-push or clean/overwrite restore against either existing Neon branch.

Use expand/contract migrations for future changes. Deploy a compatible backend, verify authenticated reads and a deliberately authorized test write in an isolated preview, then deploy the frontend. Code rollback requires schema compatibility; database recovery is not an automatic down migration. Free Render has no one-off job/shell facility, so reviewed migrations may need a trusted local operator environment rather than a start-command hook. No hosting connections were configured here.

## Validation and release checklist

### Changed files

- Added `backend/scripts/database-safety.mjs`, `database-safety.test.mjs`, `backup-restore.mjs`, `run-postgres-tests.mjs` and `check-repository-safety.mjs`: target/command guards, archive tooling, disposable test lifecycle and scoped exposure checks.
- Added `backend/test/postgres/financial.postgres-spec.ts`, `backup.postgres-spec.ts`, `backend/vitest.config.postgres.ts` and `backend/src/finance/transactions.spec.ts`: genuine integration/restore checks and retry regression tests.
- Updated `backend/src/finance/transactions.ts`, `backend/src/configure-app.ts`, `backend/test/auth.e2e-spec.ts`, `backend/scripts/safe-prisma.mjs`, `backend/package.json` and `backend/.env.example`: focused fixes, tested headers/body limits and operational commands/configuration.
- Updated `.github/workflows/ci.yml`, `.gitignore`, root/backend/frontend READMEs, `docs/ci-cd.md` and the subsequent-validation note in `docs/data-management.md`.
- Added this document, `docs/backup-restore.md` and the inactive `docs/deployment/vercel.example.json`. No financial schema, migration, lockfile, approved UI or authentication-store rewrite was added.

### Results

Completed locally on Windows / Node 24:

- Backend lint/build/schema validation; **174 unit tests and 180 API tests**.
- **3 database-safety script tests** and the scoped repository exposure check.
- **10 real PostgreSQL/backup tests**, including both self-managed-container and externally supplied CI-service paths.
- Frontend lint/build and **72 Node tests**; no UI code or theme was changed.
- GitHub Actions structure/expressions validated with Actionlint 1.7.12; no workflow was pushed or run on GitHub.
- npm audit performed: 2 backend / 12 frontend moderate development findings; zero omit-dev findings on each.

Not performed: a real Neon backup/restore, production deployment, real production browser-cookie/proxy/HTTPS tests, load/soak tests, multi-instance sessions or a comprehensive historical secret scan. No success is claimed for these.

Before real financial use:

- [ ] Confirm production/development branch identity and separate credentials in Neon; keep fictitious data out of production.
- [ ] Review database grants: use a dedicated runtime role with only required DML access and a separate migration owner; production grants were not inspected or changed here.
- [ ] Establish encrypted backups, an independent offline copy, responsible operator, recovery objective and a verified real-data isolated drill.
- [ ] Run CI on GitHub; verify Ubuntu service cleanup, package installation and no secret-bearing artifacts.
- [ ] Configure HTTPS origins/proxy; test session bootstrap, login, refresh, CSRF rejection, logout, expiry, downloads and direct-ingress rate-limit spoof resistance.
- [ ] Explicitly accept restart-driven logout and process-local limits, or design/test persistent sessions before requiring seamless operation.
- [ ] Verify frontend CSP and all three themes/forms/charts on mobile and desktop in the isolated deployment.
- [ ] Review dependency advisories and the pinned Prisma/pg warning before the release; do not blindly force upgrades.
- [ ] Document the reviewed revision, health check, migration operator, rollback path and incident/secret-rotation procedure. Keep deployment auto-connect/auto-promote disabled until this process is approved.

Rotate the shared password hash and signing secret through the existing setup procedure when necessary, restart the single instance to revoke sessions, and never publish old/new values in logs, issues or screenshots. Avoid exposing real financial records in diagnostics.
