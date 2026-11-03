# Together Finance 1.0 production deployment

Prepared November 2, 2026. Repository branch: `feat/production-deployment`; release branch: `main`.

**This prepares one production application, not a permanent staging environment. Nothing was deployed, no account was connected and no Neon branch was accessed or modified.** All cloud provisioning, migration, backup/recovery execution and hosted validation below require future explicit authorization. No commit, push, merge or branch switch was performed.

The active configuration is `frontend/vercel.json` plus `render.production.yaml`. Historical staging scripts remain guarded and their Vercel configuration is archived at `docs/deployment/vercel.staging.json`. Do not create a staging application or apply `render.staging.yaml` for this release. The old [staging runbook](staging-deployment.md) is historical optional guidance.

## Current state and release blockers

Actual hosting URLs are unknown, so **no production hostname is configured**. The production Vercel config has an empty rewrite list rather than a fake hostname. Its preflight intentionally refuses a hosted build until the owned origins are known, independently reviewed, supplied through public environment pins and written into the single rewrite. Ordinary local/CI frontend builds remain available. There is no automatic fallback to another API or HTML.

Before real use, resolve: production Neon identity/privileges, a current encrypted restorable backup and recovery record, actual hostname setup, dedicated secrets, green CI on `main`, hosted HTTPS/cookie/CSRF/proxy/IP verification, real-device accessibility checks and explicit acceptance of Render Free/session limitations. This document does not certify those pending conditions.

## Monorepo settings

| Setting | Vercel frontend | Render backend |
| --- | --- | --- |
| Project/service count | One production project | One production service/process |
| Source branch | `main` | `main` |
| Configuration | `frontend/vercel.json` | Explicit Blueprint path `render.production.yaml` |
| Root directory | `frontend` | `backend` |
| Runtime | Node 24.x, selected by package engines | Node major 24 via Blueprint; record the resolved patch |
| Plan | Eligible personal plan; verify actual limits | Free, one instance, no disk/add-ons |
| Install | `npm ci --include=dev` | Included in build below |
| Build | `node scripts/check-production-config.mjs && npm run build` | `npm ci --include=dev && npm run build` |
| Output/start | `dist` | `npm run check:production && npm run start:prod` |
| Health | Frontend plus proxied API smoke checks | `/api/health` |
| Automatic deployment | Disabled by `git.deploymentEnabled` and project settings | `autoDeployTrigger` off |
| Database action | None | Startup connects only; no migration/seed hooks |

Backend `prebuild` already generates Prisma Client. `start:prod` runs `node dist/main.js`; Nest binds Render's `PORT` on `0.0.0.0` and validates port/auth/CORS/environment configuration. Production startup additionally checks independently verified Neon host/database pins and the canonical pooled runtime URL. Generation/validation do not connect to the database. The health response is `{ "status": "ok", "application": "Together Finance" }`; it is liveness, not a continual database-health guarantee.

Choose the actual Render region near the existing production Neon branch before provisioning; add a reviewed `region` field to the Blueprint if the default is unsuitable. Never select a paid resource automatically. Blueprint/project creation can initiate an initial deployment even though subsequent automatic deployments are off: obtain authorization before clicking Create/Import/Deploy. No CLI login, hook or hosting integration was installed here.

## Environment variables and private credential generation

Names below are configuration inventories, not real values. Use Render's private environment editor for dedicated **new production** credentials. Do not reuse development/test/staging secrets, paste secrets into command arguments/history, print environment files or upload them as CI artifacts.

| Location | Names | Purpose |
| --- | --- | --- |
| Vercel | `VITE_API_URL` | Same-origin `/api`; never a secret or direct backend URL |
| Vercel | `PRODUCTION_RENDER_ORIGIN`, `PRODUCTION_FRONTEND_ORIGIN`, `PRODUCTION_HOSTS_APPROVED` | Exact reviewed public HTTPS origins and explicit hostname approval |
| Vercel system variables | `VERCEL`, `VERCEL_ENV`, `VERCEL_PROJECT_PRODUCTION_URL` | Stable production target/project cross-check; enable system variable exposure |
| Render policy | `NODE_VERSION`, `NODE_ENV`, `SESSION_TTL_SECONDS`, `SESSION_COOKIE_SAME_SITE`, `TRUST_PROXY_HOPS` | Blueprint defaults; retain production security mode/Lax cookie policy and initially no forwarded-IP trust |
| Render supplied | `PORT` | Do not override in this procedure |
| Render secrets | `DATABASE_URL`, `SHARED_PASSWORD_HASH`, `SESSION_SECRET` | Production pooled TLS runtime connection, scrypt hash and independent signing secret |
| Render public configuration | `CORS_ORIGINS`, `PRODUCTION_FRONTEND_ORIGIN` | One exact approved frontend HTTPS origin; no wildcard/automatic preview allowance |
| Render identity pins | `PRODUCTION_EXPECTED_DATABASE_HOST`, `PRODUCTION_EXPECTED_DATABASE_NAME`, `PRODUCTION_DATABASE_CONFIRMED` | Independently verified direct endpoint/database and explicit production identity confirmation |
| Separate migration operator | `DIRECT_URL`, `MIGRATION_TARGET`, `MIGRATION_EXPECTED_HOST`, `MIGRATION_EXPECTED_DATABASE`, `MIGRATION_APPROVED` | Direct migration-owner connection, production classification, independently matching pins and final approval |
| Separate migration/recovery operator | `PRODUCTION_EXPECTED_DATABASE_HOST`, `PRODUCTION_EXPECTED_DATABASE_NAME`, `PRODUCTION_DATABASE_CONFIRMED`, `MIGRATION_BACKUP_MANIFEST`, `MIGRATION_BACKUP_CONFIRMED`, `MIGRATION_RESTORE_SHA256`, `BACKUP_STORAGE_CONFIRMED` | Production identity, absolute current manifest path, successful recovery acknowledgement, independently recorded recovered archive checksum and encrypted-storage acknowledgement |

Use the documented non-sensitive policy/acknowledgement tokens in `.env.example` and the checked-in Blueprint; never substitute a placeholder secret. Runtime must not contain `DIRECT_URL`, legacy `DATABASE_URL_POOLED`, migration approvals or backup/disposable-test credentials. Vercel must never receive a database URL, password/hash or signing secret. No `STAGING_*` variables are required by either production configuration.

To generate credentials privately, create a new empty protected local working directory and invoke the existing `backend/scripts/setup-auth.mjs` by absolute path with Node 24. It prompts through hidden input and writes `.env` **in the current working directory**. Do not run it from the ordinary backend directory or rotate development credentials by mistake. Enter a new shared production password, then privately transfer the generated hash and independent secret to Render's secret fields. Preserve the hash literally, including its dollar separators. Protect/remove the temporary file using local encrypted-storage policy; do not display it in terminal output. Share the password privately only after release acceptance. The app stores no plaintext password and has no individual accounts.

## Verify the production Neon target before any connection or write

1. In the authorized Neon console, inspect the intended **production** project and branch IDs, endpoint IDs, database, role and PostgreSQL major. Do not infer production from a branch/database name or reuse the current development `.env`. Confirm that this is the intended real-data branch and not a fictional-data ancestor/copy. If identity or existing content is uncertain, stop; never reset or clean it.
2. Obtain a pooled runtime connection and a direct migration connection for that same branch/database. Use unique production credentials and TLS. Prefer a dedicated runtime role with only required DML privileges, separate from the schema/migration owner. Verify grants before exposing financial routes; no role/grant change was made here.
3. Record the exact **direct** hostname and database independently in the production pins. The startup guard expects the corresponding pooler hostname only for runtime. The migration wrapper separately requires matching migration pins and the direct connection. The explicit production confirmation token is an operator assertion, not proof of branch identity or contents.
4. Use a clean operator checkout/process without an ordinary development `.env`. Load private settings without echoing them. After separate authorization for read-only access, the existing `npm run db:inspect` can compare canonical pooled/direct targets and inspect catalogs without changing data. Do not run it merely because this preparation is complete.
5. Review the existing initial SQL `20261031170000_initial_financial_schema`, current migration history and application/schema compatibility. If the schema is already initialized and up to date, do not replay SQL. Existing objects without consistent migration history require a separate baseline review; do not use database push, reset, force flags or fabricated history rows.

## Backup, recovery proof and guarded initial migration

No migration, backup against Neon or restore was run in this task. The following is a future operator procedure, not an instruction to execute it without authorization.

1. Schedule a write-free maintenance window. Stop every writer, including the backend if already running, and coordinate with both users. Do not let the backup become stale through later writes before migration.
2. Follow [backup-restore.md](backup-restore.md): independently pin the production direct source, configure the explicit `BACKUP_DATABASE_URL`/source pins and an encrypted access-controlled destination, then run `npm run db:backup` only after authorization. This creates a custom archive and adjacent `.dump.json` manifest. A dump is not encrypted by the script; storage must already be protected. Keep an independently encrypted offline copy and private key/recovery custody. CSV is not a backup.
3. Prove restoration of **this archive** into a newly created disposable loopback target using matching PostgreSQL tools. For an initialized financial database, use the existing `npm run db:restore:isolated -- <archive>` procedure; verify exact amounts, history, constraints, migration state and active/deleted ancestry. Never restore over production or development. Record the manifest SHA-256, source identity, successful drill, time and operator privately.
4. A genuinely empty first production database still needs a backup and recovery proof before its first schema migration. The regular financial restore verifier expects application tables and intentionally cannot certify an empty schema. Use the empty-source procedure below instead; do not weaken that verifier or mark an unsuccessful drill as verified.
5. In the private migration-only process, set the production identity/pins, select the production migration classification and point `MIGRATION_BACKUP_MANIFEST` at the absolute manifest path on protected storage. Enter the **checksum recorded after the successful recovery drill** in `MIGRATION_RESTORE_SHA256`, acknowledge successful restoration/encrypted storage and set the existing explicit migration approval **last**. Do not derive the recovery confirmation from a checksum check alone.
6. After explicit final operator approval, from `backend/`, execute only:

```text
npm run prisma:validate
npm run prisma:migrate:status
npm run prisma:migrate:deploy
npm run prisma:migrate:status
```

Initial status can report pending migrations on an empty branch. Unexpected drift, existing objects or failures require investigation rather than forced repair. Prisma applies only pending migration IDs; this is a deliberate one-time initial release action, never a startup command. Do not run raw Prisma/SQL to bypass the wrapper.

The production deploy guard requires exact production identity, direct TLS, matching migration pins and approval. Before spawning Prisma it verifies the archive's size, custom-format magic, SHA-256 and manifest, a creation time no more than **24 hours** old and not in the future, and equality to the independently recorded recovery checksum. Missing, stale, changed or unconfirmed artifacts fail closed. There is no empty-database exemption. Checksum/age checks cannot prove source identity, actual encryption or a successful restoration; those remain independently reviewed operator responsibilities. The guard is not a security boundary against someone deliberately invoking other tools.

After success, privately record the applied migration/revision and verification results, clear approval/direct/backup variables and end the operator process. Runtime retains only its pooled least-privilege connection. If anything fails, keep writers stopped, preserve the current state and follow the rollback procedure; do not reset, delete or rerun arbitrary SQL.

### Empty-source recovery proof

This applies only after an operator has independently confirmed that the new production source has **no application schema/data**. It is not a way to skip financial integrity checks on an initialized database.

Use the disposable Docker setup/identity-checked cleanup in [backup-restore.md](backup-restore.md). Match the actual source/dump/tool major; its PostgreSQL 17 example is suitable only for compatible sources. Keep the archive on encrypted storage and use installed native matching PostgreSQL tools. Inside that setup's protected `try` block, **instead of** the regular financial restore command:

```powershell
# Run from backend/, in the separately authorized disposable recovery process only.
# The linked setup supplies a fresh run ID, own verified loopback container and random local password.
node --input-type=module -e "import { createDisposableDatabase } from './scripts/database-safety.mjs'; await createDisposableDatabase(process.env.TEST_POSTGRES_ADMIN_URL, process.env.TF_DISPOSABLE_POSTGRES, process.env.TF_TEST_RUN_ID, 'restore');"
if ($LASTEXITCODE -ne 0) { throw 'Fresh disposable recovery database creation failed.' }
$env:PGHOST = '127.0.0.1'
$env:PGPORT = ($drillPort -split ':')[-1]
$env:PGUSER = 'together_test'
$env:PGPASSWORD = $env:POSTGRES_PASSWORD
$env:PGSSLMODE = 'disable' # This fresh loopback-only test cluster, never Neon.
$emptyArchive = Read-Host 'Protected empty-source custom archive path'
try {
    & (Join-Path $env:PG_BIN_DIR 'pg_restore.exe') --exit-on-error --single-transaction --no-owner --no-acl --no-password --dbname "together_finance_restore_$($env:TF_TEST_RUN_ID)" $emptyArchive
    if ($LASTEXITCODE -ne 0) { throw 'Empty-source recovery failed; do not approve migration.' }
    # Privately inspect the restored catalogs with matching PostgreSQL tools.
    # Confirm the intended empty application schema, expected extensions and no ignored restore errors.
} finally {
    Remove-Item Env:PGHOST,Env:PGPORT,Env:PGUSER,Env:PGPASSWORD,Env:PGSSLMODE -ErrorAction SilentlyContinue
}
```

The existing helper refuses cloud/shared clusters and creates a new generated namespace; it never reuses or overwrites a database. The linked setup must still verify its container identity before cleanup. Do not substitute a Neon tunnel or shared local PostgreSQL server. Record successful restore/catalog inspection and the current archive's checksum before acknowledging recovery. Unknown extensions, tool incompatibility, unexpected objects or an unsuccessful restore remain release blockers. No such drill was executed here.

## Configure actual owned hostnames, then manually deploy

The initial public topology is browser → Vercel `/api` → reviewed Render HTTPS service → Neon pooled TLS. There are no hosting URLs in this preparation. Obtain ownership/project/service identity and actual assigned hostnames in the consoles only after cloud setup authorization; do not guess URLs from service names. Project/Blueprint creation can start a build/deployment, so it requires approval even before the hostname is recorded. A guard refusal during bootstrap is not permission to bypass it.

Once both actual origins are known, privately set the **public** production origin pins, same-origin API base and hostname approval in the operator environment. From `frontend/`:

```text
npm run configure:production
npm run check:production
```

The first command only writes the reviewed literal external API rewrite locally; it does not contact a provider or deploy. Inspect the diff and review it through the release PR. It preserves security headers and disabled automatic deployment. The second refuses configuration drift, a recursive/incorrect destination, missing cache protections or an absolute frontend API base. Unknown origins leave configuration unmodified. Keep the same independently reviewed origin pins in Vercel; no Vercel environment interpolation is assumed inside the JSON destination.

In the **one production Vercel project**, select root `frontend`, Vite, Node 24.x, the exact install/build/output settings above, the `main` production branch and the Production environment target. Enable system environment variables for project/target checking. Do not allow automatic Git deployments or auto-promote previews. An unexpected Preview target/project fails the production check. [Vercel Node version selection](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions) supports selecting major 24; record the actual build patch.

In the **one production Render service**, explicitly select `render.production.yaml`, verify root `backend`, branch `main`, Free plan, one instance, region, exact build/start/health settings and private production configuration. Keep automatic deployments off. Do not add migration, seed, pre-deploy or initial-deploy hooks. No Render database, disk, cron, microservice or extra paid resource is needed. Deploy a reviewed `main` revision manually after the migration/recovery gates; verify direct HTTPS health before the frontend rollout, then deploy the matching frontend revision manually and complete proxied acceptance before announcing 1.0.

## Security audit of the proxy path

- **Host and routing:** the literal destination must be the reviewed production `onrender.com` origin and retain `/api/:path*`. It cannot point back to Vercel or remove/double the API prefix. Hash routes need no catch-all HTML rewrite. Query strings, methods, JSON bodies, status codes and CSV attachment bytes must survive forwarding.
- **Origin and CSRF:** upstream Host can change for routing; the browser's original frontend Origin must not. The unchanged Nest guard requires that exact allowlisted Origin and the session-bound `X-CSRF-Token` on unsafe requests, including login/logout. Missing, `null`, forged or unapproved origins must fail. CORS is not authorization; do not add the Render origin or wildcard previews to make forwarding work.
- **Cookies:** production mode retains Secure, HttpOnly, host-only `__Host-together_session`, Path `/`, SameSite=Lax, signed opaque IDs and absolute expiration. Through a correctly forwarding reverse proxy, the browser stores the cookie on the frontend HTTPS host, with no Domain rewrite and no dependence on third-party cookies between unrelated provider domains. The proxy must preserve Cookie/Set-Cookie and CSRF/content-type headers. Real browser acceptance remains pending; never use localStorage tokens or weaken cookie flags as a workaround.
- **Forwarded headers and limiting:** keep `TRUST_PROXY_HOPS` at the safe default until both Vercel → Render and direct Render ingress are tested. Zero trusts no forwarded IPs and can make users share the edge's rate-limit bucket. Guessing a fixed hop count can trust spoofed headers on a shorter path. Verify spoof resistance and correct client identity before any change; preserve per-IP/global limits and the password-verification concurrency gate. This remains a release gate, not an assumed proxy fix.
- **Caching/CSP:** API responses already set no-store, including errors; exports use private/no-store. Vercel configuration adds browser/CDN/Vercel-CDN no-store and does not enable rewrite caching. [Vercel now honors upstream cache headers for external rewrites](https://vercel.com/changelog/vercels-cdn-now-respects-cache-control-headers-from-external-origins-by-default), so do not rely on historical uncached-by-default claims. Preserve the existing frontend CSP, local fonts and necessary chart style attributes without inline scripts. Verify effective headers/CSP on the actual deployment.
- **Sessions:** storage and limits remain process-local. One process only; Render restart, redeploy or process replacement revokes sessions and resets counters. No authentication/POV/account architecture or financial calculation changed.

## Production acceptance checklist — pending authorization

Record only sanitized pass/fail, revision IDs and header flags. Never put raw credentials, cookies, CSRF values, database URLs, HAR files, financial exports or backups in logs/issues/CI artifacts.

| Area | Required acceptance |
| --- | --- |
| Identity, health and HTTPS | Confirm owned production URLs, exact Neon branch/roles, TLS certificates, proxied/direct health JSON, expected API errors rather than HTML, no redirect/recursion |
| Login/restoration | Reject an incorrect password; accept the new dedicated password only after session confirmation; verify cookie flags/frontend host, refresh restoration and no readable token storage |
| CSRF/CORS/rate limiting | Reject unsafe requests with missing/forged token and missing/`null`/unapproved Origin even with valid cookies; valid same-origin request succeeds; verify both ingress paths and forwarded-header spoof resistance without aggressive load |
| Logout and expiration | Confirm revocation/204 and denial on transient old-cookie replay; verify absolute expiry/re-login. Any short-TTL/restart test is an authorized maintenance action; restore the normal policy afterward |
| Expenses/allocations | Read existing truthful data; verify explicit payer/beneficiary, personal/shared allocation, exact cents, category/date/POV totals and one-count shared expenses; validate create/edit and stable UUID retry only with separately approved legitimate transactions |
| Debts/loans/repayments | Verify directional obligations, partial/full repayments, overpayment rejection, source links, deletion/restoration and separation from spending; do not manufacture financial activity to test production |
| CSV/recycle bin | Verify authenticated export, exact UTF-8/BOM and attachment headers, no-store at all cache layers, filter/scope limits and correct active/deleted/restored ancestry; keep downloads private |
| Cold starts/failure/restart | Allow genuine idle suspension, verify waking/error UI and finite read attempts/manual reconnect; no automatic mutation retry or false success. An authorized restart must invalidate sessions while preserving records |
| Browser/UI | Actual Safari/iOS, Chromium/Android and desktop; keyboard/focus, Spanish labels, three retained POV identities, reduced motion, 320/375/390/768/1440px, CSP and no horizontal overflow |
| Recovery | Current encrypted backup, independent offline copy/key custody and successful isolated recovery of the exact archive, verified amounts/history/constraints and privately measured recovery time |

All hosted checks remain pending. Begin with read-only checks. Live financial writes require separate explicit approval and genuine, correctly attributed transactions agreed by the users; if none are available, leave that acceptance item pending rather than create fictitious production records. Broader mutation scenarios use synthetic local/CI tests or a separately authorized isolated local copy, not a permanent staging application. Soft deletion is history-preserving and is not a way to erase invented production test activity.

The frontend retains bounded safe read retries and manual reconnect for Render cold starts; login/logout/financial mutations are not blindly retried. Provider timeouts may end an attempt before wake-up completes. Do not introduce keep-alive polling or unlimited retries. Stop rollout if cookie acceptance, data accuracy, duplicate prevention, CSRF/IP checks or recovery fails.

## Exact promotion process to `main` — user actions only

1. On `feat/production-deployment`, inspect `git status --short` and the diff. Keep `.env`, archives, secrets and unrelated changes out of the release. Review the file inventory below. No agent commit or branch change was made.
2. Obtain actual hostname ownership and finish the local public rewrite configuration only after authorization. Run the production preflight with the independently reviewed public pins; it must pass before release deployment. Review all private backend/operator settings separately, without committing them.
3. In the IDE, stage only the reviewed release files, inspect the staged diff, create an English commit (for example, `chore: prepare Together Finance 1.0 production deployment`) and push the **feature branch**. These are future manual actions, not commands executed by this task.
4. Open a GitHub PR with **base `main`** and **compare `feat/production-deployment`**. Review the complete release diff against `main`, not merely the latest commit. Keep the existing CI **Frontend** and **Backend** checks required and green; the backend job includes the disposable PostgreSQL/recovery suite. Do not supply production credentials to CI.
5. Configure applicable `main` branch rules to require PR review/checks and prevent premature direct pushes. If the repository plan limits protection, document the equivalent manual release hold; do not bypass failed checks. Resolve review comments and rerun CI on the final revision.
6. After explicit user release approval, merge the reviewed PR through GitHub, record the resulting **`main` commit SHA**, and wait for both post-merge CI jobs to pass. Do not deploy a feature-branch SHA, stale build or unreviewed provider setting.
7. Execute the separately approved backup/migration procedure, then manually deploy that exact `main` revision to Render and the matching Vercel production project. Complete hosted acceptance privately before announcing 1.0 or inviting normal financial use.
8. Record the revision, migration state, private recovery evidence, frontend/backend deployment IDs, acceptance results and rollback candidates. Keep automatic deployment disabled until production validation succeeds **and a later explicit automation change is reviewed**; no automatic deployment is activated by this task.

The existing GitHub Actions workflow remains unchanged: PRs/pushes for `develop`/`main`, independent jobs, read-only permissions, npm lockfile installs/caches and no deployment job or production secret. No PR, commit, push, merge, tag or hosted workflow run was created here.

## Rollback and operational limits

On a suspected financial/security defect, stop new writes and coordinate with both users. Preserve affected data and the last known-good deployment IDs. Manually restore the prior verified compatible backend revision and frontend deployment **within the same production projects**, then verify environment pins, rewrite destination, health and authenticated reads. Frontend rewrites are baked into the deployment. A backend restart or secret rotation requires re-login. Do not assume a provider code rollback also restores environment configuration or database state.

There is no automatic database down migration. If the old code is incompatible with the current schema, keep writes stopped and use a separately reviewed forward fix or recovery plan. Never reset, drop, force-push schema, delete records or overwrite a Neon branch to roll back. Prove recovery on a new isolated target first; any later cutover to a new production target needs explicit approval, new verified pins/least-privilege credentials and reconciliation of post-backup activity. Do not discard the affected source. Expand/contract future schema changes so code rollback remains possible.

Free-tier limits must be accepted before real use. [Render Free](https://render.com/docs/free) sleeps after idle time, can take roughly a minute to wake, uses ephemeral files, has a shared free-hour allowance and limited rollback retention, and lacks the normal Free shell/one-off job facility. Render explicitly does not recommend Free for production availability; this private deployment choice needs owner acceptance, not a false uptime promise. Measure scrypt/Node/Prisma memory and never weaken hashing to fit a plan. Do migrations from the trusted operator process, never a startup workaround. No backup belongs on Render's filesystem.

Verify actual [Neon plan](https://neon.com/docs/introduction/plans) compute/storage/transfer and restore-history limits, backup needs and branch capacity before any recovery target is created. Provider restore history is not independent long-term backup. Check Vercel account/private-repository eligibility, proxy/build/traffic quotas and spending controls. Paid upgrades, extra traffic/compute/storage, custom features and overages may cost money; nothing was purchased or enabled. There is no permanent staging bill/resource requirement. Record a backup owner, daily/on-important-change schedule, retention/offline custody, recovery objective and an incident/secret-rotation procedure.

Remaining release gates include hosted security/proxy/cookie/IP results, verified production grants, actual backup/key/recovery custody, real-device/accessibility results, green GitHub CI and review of existing development-tool advisories/Prisma-pg warnings. Shared persistent sessions/rate limits would need a separate design before scaling beyond one process. No infrastructure connection or production-readiness certification is implied by successful local tests.

## Files and local validation

- `frontend/vercel.json`, `docs/deployment/vercel.example.json`: production-only templates, no fabricated hostname, guarded build, manual deployment and explicit no-store/security headers.
- `frontend/scripts/check-production-config.mjs`, `configure-production.mjs`, `frontend/tests/production-deployment.test.mjs`, `frontend/package.json`: public origin review/configuration, policy/routing checks and npm entry points, without new dependencies.
- `render.production.yaml`, `backend/scripts/check-production-env.mjs`, `backend/package.json`: one `main` production service, canonical runtime/identity preflight and existing production startup.
- `backend/scripts/database-safety.mjs`, `safe-prisma.mjs`, `production-migration-backup.mjs`, `production-config.test.mjs`, `database-safety.test.mjs`: stronger production migration/recovery gates and offline tests. Development/disposable/staging protections are preserved.
- `backend/test/staging-proxy.e2e-spec.ts`: the same synthetic loopback transport tests now cover both production and legacy staging origins; no live database/provider is contacted.
- `docs/deployment/vercel.staging.json`, `frontend/scripts/check-staging-config.mjs`, `frontend/tests/staging-deployment.test.mjs`: original staging snapshot retained, with lookup/tests moved to that archive; no guard relaxed.
- Environment examples, root README, readiness/backup/staging documentation and this runbook: production inventory and current authoritative instructions. UI, API/session implementation, financial schema/calculations, dependency versions and CI workflow are unchanged.

Local checks on Node 24.18.0 passed:

| Check | Result |
| --- | --- |
| Frontend lint and production build | Passed |
| Frontend Node tests | 85 passed, including six production configuration/routing tests and all retained staging checks |
| Backend lint and production build | Passed, including Prisma Client generation |
| Backend unit tests | 174 passed |
| Backend mocked API tests | 184 passed; the four production/legacy-origin proxy cases also passed a focused rerun |
| Backend operator/safety tests | Nine passed, including production identity, backup age/hash/recovery binding and wrapper refusal before Prisma execution |
| Prisma schema validation | Passed without database access |
| Repository safety and diff checks | Passed |
| Deployment schemas | Both Render Blueprints passed the full published schema; all configured properties in the active/example/archived Vercel JSON passed published-property schema validation |
| Unconfigured production preflights | Both refused as intended; no hostname was inserted and no database was contacted |

Vercel's full published schema includes mixed-draft constraints in unrelated function/service sections. Those unused sections were excluded from the local JSON Schema check; no configured property was excluded. YAML parsing rejected duplicate keys. Schema tools were used only from ignored local tooling storage, without adding a dependency or connecting an account. Provider-side validation and effective HTTPS routing/header behavior remain pending.

No migration engine, `test:postgres`, database backup/restore or live database operation was run. The negative wrapper test requests a deployment using only synthetic settings and an invalid archive in a clean temporary directory, and verifies refusal **before** Prisma can execute. Existing disposable integration tests remain a required future CI release check; previous-task PostgreSQL results are not presented as a new run. Archive-gate fixtures prove integrity/freshness/refusal behavior, not an actual PostgreSQL recovery. No browser redesign check was needed because no UI source/style changed; hosted browser acceptance remains pending.
