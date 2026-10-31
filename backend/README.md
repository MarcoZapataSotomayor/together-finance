# Together Finance API

NestJS 12 / TypeScript with Express, Prisma 7.10.1, and Neon PostgreSQL. The only HTTP endpoint is `GET /api/health`; financial helpers and schema exist without CRUD or authentication endpoints.

## Local startup

Use Node 24.x. From `backend/`:

```sh
npm ci
npm run prisma:validate
npm run prisma:generate
npm run prisma:migrate:status
npm run start:dev
```

Preserve the existing `.env`. For a fresh installation, copy `.env.example`, fill connections locally, then follow [database inspection/migration procedure](../docs/database-design.md) before applying migrations. Do not blindly migrate an unexpected existing database. API startup connects to PostgreSQL, so valid runtime configuration and network access are required.

Canonical variables are `DATABASE_URL` (pooled runtime) and `DIRECT_URL` (direct migrations). The existing alternative names are supported: when `DIRECT_URL` is absent, `DATABASE_URL_POOLED` supplies runtime and the existing direct `DATABASE_URL` supplies CLI migrations. No values are rewritten or logged. Canonical `DIRECT_URL` selects canonical naming. A deployed runtime can use only its pooled `DATABASE_URL`; do not give the frontend database credentials.

## Structure

```text
prisma.config.ts             Prisma 7 schema/migration/direct-connection configuration
prisma/schema.prisma        Seven models, enums, relations, decimals, indexes
prisma/migrations/          Reviewed versioned SQL, including custom CHECKs/index
scripts/                    Redacted Prisma CLI, read-only inspection/verification, API smoke test
src/
  main.ts                   Bootstrap, host/port, shutdown hooks
  app.module.ts             Config, Prisma, and health modules
  configure-app.ts          /api prefix, global validation, exact-origin CORS
  config/                   Environment validation and database URL mapping/tests
  prisma/                   Reusable PrismaModule/PrismaService and lifecycle tests
  generated/prisma/         Generated, Git-ignored ESM client compiled with Nest
  finance/                  Pure decimal allocation/debt/repayment rules and tests
  health/                   Health controller/service/module
```

`PrismaService` is one Nest provider per application context and owns a bounded PostgreSQL pool. It connects on initialization and disconnects during shutdown; it is not constructed per request. Build and development startup regenerate Client. Query/driver details are not forwarded by the operational scripts or connection-failure messages.

The database stores people, categories, payment methods, expenses, allocations, debts, and repayments. An independent loan is one `Debt(origin=LOAN)` rather than a second record duplicating the same obligation. Money is `NUMERIC(14,2)`; percentages are `NUMERIC(7,4)`. Counterparties are explicit and unrelated to POV. No balances/statuses are stored. All financial relationships restrict hard deletion, and financial records support effective soft deletion through their source chain.

Read [database-design.md](../docs/database-design.md) for examples, rounding, restoration, backup considerations, and the cross-row invariants that future services must enforce transactionally. Passing isolated tests is not proof of concurrent database write safety.

## Commands

```sh
npm run prisma:format
npm run prisma:validate
npm run prisma:generate
npm run db:inspect
npm run prisma:migrate:status
npm run prisma:migrate:deploy
npm run build
npm run lint
npm test
npm run test:e2e
npm audit
npm audit --omit=dev
```

Use deploy only for reviewed migrations after inspection/backups. The applied initial migration is `20261031170000_initial_financial_schema`; its guard requires an empty application database and it contains no seed data. Never run a destructive reset or forced push.

Generated code is ignored by Git, formatting, and Oxlint. Generate it before running tests/lint on a fresh checkout; the build does so automatically. API tests use a mocked Prisma provider and isolated test configuration, never the local `.env` database. Configuration tests and pure financial tests run without live data.

After building, `node scripts/database-verify.mjs --expect-empty` checks this initial schema, constraints, indexes, and empty business tables through the real pooled client. Drop the empty-table assertion once real records exist and update schema assertions as migrations evolve. `node scripts/smoke-api.mjs` verifies a temporary compiled API and shuts it down. Neither script writes financial records.

## Configuration and health

`NODE_ENV` supports development/test/production; `PORT` defaults to 3000. Production requires exact `CORS_ORIGINS`, with no wildcards, URL credentials, paths, queries, or fragments. Cross-origin credentials remain disabled. Request validation uses `transform`, `whitelist`, and `forbidNonWhitelisted`. Future request DTOs must define validation decorators.

Health returns `{ "status": "ok", "application": "Together Finance" }`. It remains a liveness response, not a continuous database readiness check, though startup now requires a database connection. Full local and hosting instructions are in the [root README](../README.md).

## Dependencies and audit

Added exact versions: `prisma`, `@prisma/client`, and `@prisma/adapter-pg` **7.10.1**; `pg` and `@types/pg` **8.23.1**; `dotenv` **18.0.9**. The generator uses `prisma-client`, explicit output, ESM, and `.js` imports; no obsolete schema datasource URL fields are used.

The audit still reports **two moderate entries** for one underlying development-tool issue: Nest CLI 12.0.11 depends on minimatch 10.2.6 ([GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)). Malicious glob patterns can cause excessive CPU/memory use. Runtime-only audit reports **zero vulnerabilities**. No forced upgrade, downgrade, or major transitive override was applied.

Pinned pg 8 prints a TLS compatibility notice for the existing Neon `sslmode=require`; current behavior verifies certificates fully. Certificate verification was not disabled and the `.env` was not changed. Revisit SSL semantics before upgrading to pg 9.
