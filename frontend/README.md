# Together Finance frontend

React, TypeScript, Vite, and Tailwind CSS v4. Shared-password login protects the financial dashboard, expenses, debts, independent loans and repayments. Antonella, Marco, and Shared retain the approved fonts, tokens, ornate/comic frames, and lightweight SVG artwork. See [DESIGN.md](../DESIGN.md) for the visual contract.

## Run and validate

Use Node 24.x. Start the configured backend separately, then run from frontend/:

```sh
npm run dev
npm run lint
node --test tests/*.test.mjs
npm run build
```

The existing development proxy sends /api to localhost:3000. VITE_API_URL can specify only a public API base URL; never put credentials in frontend variables. Production cookie/CORS requirements are documented in [authentication.md](../docs/authentication.md).

## Expense flow

Nuevo consumo loads real people, categories, and payment methods. Empty-state controls explicitly create the required references through the API; no people, database IDs, or sample expenses are seeded. Personal/shared ownership and funding are explicit and independent of POV or method ownership. Credit/debit type is metadata of the selected stored method.

The form supports 50/50 and custom allocations with exact-cent previews, decimal-string payloads, stable creation UUIDs, duplicate-submit locking, and server-confirmed success. Draft input and an uncertain request ID survive session expiration in memory so reauthentication can resume safely. Explicit logout and full reload clear draft memory; only POV uses localStorage.

Historial supports pagination, all financial filters, Activos / Eliminados, details, editing, confirmed soft deletion, and restoration after refresh. Existing payment history remains visible and cannot be bypassed by frontend edits. Typed requests reuse session cookies and CSRF headers, with Spanish errors and bounded server-waking feedback.

## Structure and details

Resumen (`#/dashboard`) is the default home. It displays exact server-provided monthly/range spending, category and monthly charts, personal/shared distribution, allocation/funding contributions, recent purchases and separately labeled current obligations. Native CSS charts have exact-value disclosures and need no chart library. POVs reuse safe database-person mappings; financial forms are unchanged. The dormant financial showcase with fictitious income/COP balances was removed. See [analytics.md](../docs/analytics.md).

Deudas shows server-confirmed directional totals, origin/status/person/date filters, debtor/creditor breakdowns and details. Préstamos supports explicit-party creation, editing, confirmed soft deletion and restoration. Pagos opens each debt's partial/full payment flow and paginated active/deleted history. New financial forms never infer parties from POV. Ambiguous POV-to-person matches require explicit mapping. See [frontend-debts.md](../docs/frontend-debts.md) for all routes, exact-money handling, retry recovery and limitations.

- src/api/: shared transport, actual API types, finance operations, and error mapping.
- src/auth/: login/session/logout, CSRF refresh, expiry handling, and draft reset signaling.
- src/features/expenses/: workspace, existing form composition, reference editor, history/details, exact mapping, submission controller, and memory-only draft provider.
- src/features/debts/: overview, loan/debt/payment details, forms/history, exact mapping, POV filters, confirmed actions and memory-only UUID/draft recovery.
- src/theme/, src/components/ui/, and src/components/decorations/: preserved POV system, reusable controls, and original SVG ornaments.
- src/styles/workspace.css: scoped integration styling; original expense.css and theme tokens remain unchanged.
- src/styles/debts.css: scoped debt layouts, reused theme geometry and wrapped financial navigation.
- src/features/dashboard/, src/api/analytics.ts, src/styles/dashboard.css: authenticated dashboard, typed analytics, scoped themed charts and period/POV helpers.
- src/features/data-management/, src/api/dataManagement.ts, src/styles/data-management.css: themed CSV downloads and the unified recycle bin with existing validated restoration.
- tests/: 72 native Node tests for auth/client behavior, exact mapping, analytics, data-management transport/security, POV defaults, reference loading, financial operations, validation, UUID reuse/correction, and error recovery.

Read [frontend-expenses.md](../docs/frontend-expenses.md) for architecture, endpoint mapping, retry/draft behavior, limitations, and the manual release checklist. [expenses-api.md](../docs/expenses-api.md) documents the backend contract. Locally bundled heading fonts retain their existing SIL licenses.

## Validation

Frontend lint, 72 tests, and production build pass. Expense-stage headless Edge checks covered empty setup, CRUD, restoration after reload, keyboard behavior, 403 revalidation and cold starts. Debt-stage browser validation passed 90 surface/theme/width combinations and loan/payment flows; see [debt validation instructions](../docs/frontend-debts.md#validation). Dashboard validation uses the built backend analytics service with a read-only test adapter and passed 15 theme/width combinations plus scopes, dates, exact values, empty/error/expiry/cold-start states; see [analytics validation](../docs/analytics.md#validation). Data-management browser checks passed 30 layouts and download/filter/restore/conflict/expiry/accessibility flows. No live Neon data was modified. Physical devices, Safari/Firefox, screen readers, actual Neon persistence, and deployment cookie behavior still need release validation.

**Exportar** (`#/exports`) offers five CSV datasets with date, person and active/deleted/all scope filters, cancellation and bounded downloads. **Eliminados** (`#/recycle-bin`) provides type/deletion-date filters, parent guidance and existing CSRF-protected restore actions. Neither screen infers a financial party from POV or offers permanent deletion. Read [data-management.md](../docs/data-management.md) for formats, limits, safety, browser-check instructions and release checks.

For future Vercel deployment, prefer `VITE_API_URL=/api` with the reviewed same-origin proxy described in [production-readiness.md](../docs/production-readiness.md). The inactive [configuration example](../docs/deployment/vercel.example.json) requires a real reviewed destination and preview testing. No deployment or approved visual design change is included in that preparation stage.

Motion refinement uses shared CSS tokens and a server-confirmed checkmark, with reduced-motion alternatives and focus-safe inline panels. It preserves financial text/geometry and all three themes. Frontend lint, 72 Node tests and build pass; optional headless Edge motion checks cover 150 surface/theme/width/preference combinations. See [motion-design.md](../docs/motion-design.md) for the audit, implementation and limitations.
