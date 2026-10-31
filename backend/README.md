# Together Finance API

NestJS 12 with TypeScript, the Express HTTP adapter, and npm. The only application endpoint is `GET /api/health`. This stage has no database, Prisma, authentication, or financial business logic.

## Run locally

Use Node 24.x. From `backend/`, run `npm ci`, copy `.env.example` to `.env` on first setup without replacing an existing file, then run `npm run start:dev`.

The server defaults to port 3000. `npm run build` compiles to `dist/`; `npm run start:prod` starts the compiled application. Production must supply an explicit allowed frontend origin list. Full local and hosting instructions are in the [root README](../README.md).

## File structure

```text
src/
  main.ts                  Bootstrap, configured port, shutdown hooks, host binding
  app.module.ts            Root module importing configuration and health
  configure-app.ts         Global API prefix, validation pipe, and CORS
  config/
    environment.ts         Validates runtime mode, port, and allowed origins
    environment.spec.ts    Configuration behavior tests
  health/
    health.module.ts       Health feature boundary
    health.controller.ts   GET /health, under the global /api prefix
    health.service.ts      Status and application-name response

test/
  health.e2e-spec.ts        Real HTTP tests using Supertest and Nest's test app
```

`nest-cli.json`, TypeScript configurations, Vitest configurations, `.oxlintrc.json`, and `.prettierrc` supply the standard Nest build/test workflow. `package-lock.json` records the installed dependency graph. The scaffold's deployment-service and telemetry setup suggestions were omitted; no telemetry service or deployment integration is configured.

## Configuration behavior

- `NODE_ENV` defaults to `development`; `test` and `production` are also supported.
- `PORT` defaults to 3000 and must be an integer from 1 through 65535.
- `CORS_ORIGINS` accepts comma-separated exact HTTP(S) origins. Development/test defaults allow `http://localhost:5173` and `http://127.0.0.1:5173`. Production has no fallback.
- Wildcards, credentials, paths, queries, fragments, and malformed/empty origins cause startup to fail. A trailing slash is normalized and duplicate origins are removed.
- CORS credentials are disabled. Unlisted origins receive no permission header; CORS is not a substitute for future authentication.
- Configuration comes from `.env` and process variables, with process variables taking precedence. No real `.env` is created or committed by this setup.

The global `ValidationPipe` uses `transform: true`, `whitelist: true`, and `forbidNonWhitelisted: true`. Future DTOs must use class-validator decorators. Tests register a DTO probe controller only inside the test application to verify valid input transformation and rejection of extra properties or invalid values. No probe route exists in production.

## Health response

```json
{
  "status": "ok",
  "application": "Together Finance"
}
```

This endpoint confirms the API process responds; it does not assert database availability.

## Checks

```sh
npm run build
npm run lint
npm test
npm run test:e2e
npm audit
npm audit --omit=dev
```

Tests cover default/custom environment values, production configuration requirements, invalid ports/origins, the prefixed health route, allowed and unlisted origins, browser preflight, and global request validation. Oxlint runs with type-aware checks, as provided by the NestJS 12 scaffold.

## Dependency audit

At setup, `npm audit` reported **two moderate entries** for one underlying issue: `@nestjs/cli@12.0.11` depends on `minimatch@10.2.6`, affected by [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249). Malicious glob patterns can amplify preprocessing and exhaust CPU/memory. This dependency is development/build tooling; `npm audit --omit=dev` reported **zero vulnerabilities**.

The installed CLI requires that minimatch version, while the advisory identifies 11.0.1 as patched. `npm audit fix --dry-run --json` proposed no compatible changes and suggested a breaking CLI downgrade for the full fix. No forced downgrade, major-version override, `--force`, or `--legacy-peer-deps` was applied. Recheck when the Nest CLI publishes a compatible fix.
