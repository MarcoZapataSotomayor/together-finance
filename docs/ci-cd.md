# Continuous integration and future delivery

## CI and CD

**Continuous Integration (CI)** checks each proposed integration automatically. Together Finance installs locked dependencies, checks code quality, runs automated tests, validates the Prisma schema, and compiles both applications. These checks help catch errors before changes reach a shared branch. They complement code review and manual browser testing; they do not prove that every feature or deployment works.

**Continuous Delivery (CD)** prepares a validated version for release, with an explicit approval before production. **Continuous Deployment** goes further and releases automatically after its gates pass. This workflow implements CI only. It does not upload artifacts, publish a site, start a production API, or change a database.

The configuration lives in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml). The repository has two independent npm projects, so each gets its own job, install, lockfile cache, and checks.

## Triggers and cancellation

| Event | When CI runs |
| --- | --- |
| `pull_request` | A PR is opened, reopened, or updated with commits, targeting `develop` or `main` |
| `push` | Commits reach `develop` or `main`, including a PR merge |

For PRs, the branch filter checks the **target** branch. Pushing only to `feat/ci-pipeline` does not trigger this workflow unless that branch has a qualifying PR. A normal PR run tests GitHub's proposed merge with the target branch; a push run checks the pushed revision. Both jobs always run, including for documentation-only changes, so their check names remain predictable.

Workflow-level `concurrency` groups runs by workflow name and PR number, or branch ref for pushes. `cancel-in-progress: true` cancels obsolete runs when a new commit arrives for the same PR or branch. A PR run and a target-branch push run have separate groups. Independent branches and PRs do not cancel each other. Each job also has a 15-minute timeout to stop a hung command.

## Runners, jobs, and steps

A **runner** is the machine that executes a job. `ubuntu-latest` requests a fresh GitHub-hosted Ubuntu environment for each job. It is separate from your computer and does not contain your local `.env`, installed packages, or generated Prisma Client. GitHub maintains the runner image; its Ubuntu version and preinstalled tools can change.

A **job** is a group of steps on one runner. **Frontend** and **Backend** have no `needs` dependency, so GitHub can run them in parallel when capacity is available. They have separate filesystems. A failure in one does not cancel the other job automatically.

A **step** either invokes an action with `uses` or executes a command with `run`. Steps run in order within their job. `defaults.run.working-directory` selects `frontend/` or `backend/` for shell commands. Action inputs such as `cache-dependency-path` still use paths relative to the checked-out repository root.

Only two actions are used: GitHub's official `actions/checkout` and `actions/setup-node`. They check out the source and install Node.js 24 with npm caching. Full commit SHAs pin the reviewed releases (checkout v7.0.1 and setup-node v7.1.0), with version comments for readability. Update each SHA and its comment together after reviewing future official releases. These are the action versions, separate from the application's Node.js version.

Node 24 matches the backend's `>=24 <25` engine constraint and supports the frontend tests' direct TypeScript imports. Backend and frontend have separate TypeScript versions; CI uses each project's lockfile rather than installing a global compiler.

## Checks in each job

Both jobs begin with checkout, Node setup, and `npm ci`.

| Frontend command | Purpose |
| --- | --- |
| `npm run lint` | Existing ESLint checks |
| `node --test tests/*.test.mjs` | All existing auth-client and expense-model tests using Node's test runner |
| `npm run build` | TypeScript checks and the Vite production build |

| Backend command | Purpose |
| --- | --- |
| `npm run prisma:generate` | Creates the ignored Prisma Client required by source imports and checks |
| `npm run prisma:validate` | Validates the Prisma schema without database credentials or a connection |
| `npm run lint` | Existing type-aware Oxlint checks |
| `npm test` | Vitest unit tests, including financial helpers, configuration, Prisma lifecycle, and auth setup |
| `npm run test:e2e` | HTTP/API integration tests with a mocked Prisma provider |
| `npm run build` | Compiles the NestJS production application |

The existing backend `prebuild` hook generates Client again before compilation. This small duplication is intentional: CI needs Client earlier for lint/tests, while the hook keeps local builds self-contained. Generating Client and validating a schema do not apply migrations or prove live PostgreSQL connectivity. The API tests start an isolated test application, not the real `main.ts` server.

## Dependency installation and caching

`npm ci` requires a committed `package-lock.json` consistent with `package.json`. It installs the locked dependency tree, removes an existing `node_modules`, and fails on a manifest/lockfile mismatch rather than updating the lockfile. This makes unexpected dependency changes visible. Use `npm install` locally when intentionally changing dependencies and review the resulting lockfile; use `npm ci` to reproduce the committed installation in CI.

`actions/setup-node` caches npm's downloaded package cache, **not `node_modules`**. The frontend uses `frontend/package-lock.json` as its cache dependency path; the backend uses `backend/package-lock.json`. The cache key incorporates the runner platform, package manager, and lockfile hash. A matching cache can avoid downloads, while a miss is normal and still performs a complete install. `npm ci` always runs even when the cache is restored. Neither a cache hit nor a build replaces tests.

Dependencies still come from the configured npm registry and may run their normal installation scripts. Lockfile integrity and SHA-pinned actions reduce unexpected changes; dependency updates still need review. Cache contents must never contain credentials, `.env` files, or financial data. Do not add those paths to a future cache configuration.

## Test configuration and database safety

The backend job sets only `NODE_ENV=test`. No repository secrets, Neon connections, or production authentication keys are required or referenced. Nest's test mode ignores `.env`. `test/setup-env.ts` supplies synthetic test values, and `test/auth-fixture.ts` derives a deliberately test-only hash and signing secret. API tests replace `PrismaService` with a mock. Prisma lifecycle tests stub connection behavior; they do not contact Neon. Auth setup tests operate only in isolated temporary directories and do not configure the real application's password.

On a clean checkout, Prisma 7's existing configuration omits a datasource URL for generation/validation. These commands work without providing a dummy database or real credentials. No PostgreSQL service container is needed for this initial pipeline.

The workflow never runs migration status/deploy/dev/reset, `db push`, seeds, `db:inspect`, database verification, the live API smoke script, or `auth:setup` against the repository. Do not add real connection variables to make a test pass. If future tests need real PostgreSQL behavior, use a dedicated disposable CI database with synthetic data and explicit isolation, never the Neon development or production database. Current mocked API tests do not validate real database constraints or SQL transactions.

Workflow permissions are limited to `contents: read`; no write, deployment, or OIDC token permission is requested. Checkout sets `persist-credentials: false`, so subsequent commands do not retain checkout credentials in Git configuration. The workflow uses `pull_request`, not `pull_request_target`, and has no secret-bearing deployment steps. Fork PRs may need maintainer approval to run under repository policy. Do not replace this isolation with privileged execution of untrusted PR code.

## Failures and checking GitHub runs

A nonzero command exit marks its step and job as failed. Later validation steps in that job are skipped; the other job continues independently. There is no `continue-on-error` to hide failures. An npm audit advisory printed during installation is informational unless npm itself fails; this workflow does not add a separate audit gate or force dependency upgrades.

After you review and commit the workflow yourself:

1. Open or update a PR targeting `develop` or `main`, or push to one of those branches. Ensure GitHub Actions is enabled in the repository. There is no manual `workflow_dispatch` trigger.
2. Open the repository's **Actions** tab, select **CI**, and select the run matching your commit or PR. The PR's **Checks** tab also links to its run.
3. Inspect **Frontend** and **Backend**, expand failed steps, and read the command and first useful error. An installation failure might indicate a lockfile mismatch or registry/network problem; a test failure should be reproduced with the same command locally.
4. Fix the cause and update the PR. Its new run cancels an older in-progress run for that PR. Re-run a failed job manually only when appropriate, such as a transient registry outage.
5. After the first successful run, optionally configure branch rules for `develop` and `main` to require **Frontend** and **Backend** checks before merging. The workflow alone does not enforce branch protection. Restrict direct pushes separately if desired.

No GitHub run is created by editing files locally. Local checks cannot prove checkout permissions, cache restoration, fork approval behavior, or the hosted Ubuntu environment; the first qualifying GitHub event validates those parts.

## Running equivalent checks locally

Use Node 24.x and separate terminals or run the projects sequentially.

From `frontend/`:

```powershell
npm ci
npm run lint
node --test tests/*.test.mjs
npm run build
```

From `backend/` in PowerShell:

```powershell
$env:NODE_ENV = 'test'
npm ci
npm run prisma:generate
npm run prisma:validate
npm run lint
npm test
npm run test:e2e
npm run build
```

Use a fresh checkout or temporary source copy without `.env`, inherited connection/auth variables, `node_modules`, or generated output to reproduce CI's credential-free environment. Existing Prisma CLI helpers load a local `.env` if present, even with `NODE_ENV=test`; generation/validation still do not connect, but an isolated copy avoids loading private configuration at all. Use a separate terminal so the temporary test environment does not affect later development startup. No `auth:setup` or database setup is required for these CI checks.

For optional local workflow validation, [actionlint](https://github.com/rhysd/actionlint) checks YAML, GitHub Actions expressions, and workflow structure. It is a development verification tool, not a dependency or an action added to this workflow.

### Initial local validation

The equivalent checks passed on Windows with Node 24.18.0 and npm 11.16.0, using a fresh temporary source copy without `.env`, `node_modules`, or generated output. Inherited connection/auth variables were removed from the validation processes. Both `npm ci` installs, frontend lint/build and 13 tests, backend generation/schema validation/lint/build and 64 unit plus 28 API tests passed. No database or live API startup was used. Actionlint 1.7.12 accepted the workflow's YAML, expressions, and structure; optional ShellCheck/Pyflakes integrations were disabled because the steps contain only direct npm/Node commands.

Installation reported the existing 12 frontend and two backend moderate audit findings. Backend installation also warned about two Prisma lifecycle scripts lacking explicit npm allow-scripts approval; explicit generation/validation and the subsequent checks still passed. No dependency changes or forced fixes were made. Revisit these warnings when updating dependencies/npm, and validate the actual hosted Ubuntu run after creating a qualifying PR or push. Local Windows checks do not establish Linux-specific behavior or successful GitHub cache/permission handling.

## Future production delivery

### Current database-safety addition

The backend job now starts a digest-pinned official PostgreSQL 17 service and runs `npm run test:safety`, `npm run check:repository` and `npm run test:postgres`. These additions use only disposable runner-local credentials. The runner creates a unique test database, applies the existing migration and verifies real concurrent financial operations plus an actual isolated pg_dump/pg_restore round trip. It never resets or truncates tables, connects to Neon, uploads backup artifacts or runs production migrations. The service is discarded with the job. Local checks passed all 10 PostgreSQL tests through both self-managed-container and externally supplied CI-service modes; hosted Ubuntu execution remains to be verified after the user submits a qualifying PR/push. See [production readiness](production-readiness.md) and [backup/restore](backup-restore.md).

Update the PostgreSQL image digest through reviewed dependency maintenance, keeping the local runner and service definition aligned. Cancellation can interrupt the runner's normal cleanup, but GitHub removes the disposable service with the job. Locally, inspect the uniquely labeled test container if the process is forcibly terminated; never prune unrelated Docker resources. The added service/checks consume the existing job's runner minutes and introduce no paid cloud database.

A later delivery pipeline can depend on successful CI and deploy reviewed versions to Vercel and Render. It should introduce scoped deployment credentials or supported short-lived identity, protected GitHub environments, explicit production approval where desired, deployed health checks, and rollback procedures. PR validation must remain separate from secret-bearing deployment jobs.

Build artifacts or immutable version identifiers can ensure that the deployed revision matches what passed CI. Production configuration will include real backend secrets and database connections supplied through the host's secret management, never the test fixtures or frontend build variables. Database migrations will need their own reviewed, controlled execution with backup/recovery planning; they must not be added casually to this validation workflow. Authentication's single-instance session and production cookie constraints still apply; see [authentication.md](authentication.md).

This pipeline does not configure deployment hooks. Review any existing Vercel/Render automatic deployment settings separately when introducing release gates, so hosting does not bypass the intended checks. GitHub-hosted runner minutes/cache limits depend on the repository's plan, particularly for private repositories; no additional paid service is introduced here.

## References

- [GitHub workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)
- [Workflow concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)
- [Official checkout action](https://github.com/actions/checkout)
- [Official setup-node action and caching](https://github.com/actions/setup-node)
- [npm ci documentation](https://docs.npmjs.com/cli/v11/commands/npm-ci)
- [GitHub Actions security guidance](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions)
