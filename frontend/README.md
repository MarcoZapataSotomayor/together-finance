# Together Finance frontend

React, TypeScript, Vite, and Tailwind CSS v4. Shared-password login protects the API-backed Nuevo consumo form and expense history. Antonella, Marco, and Shared retain the approved fonts, tokens, ornate/comic frames, and lightweight SVG artwork. See [DESIGN.md](../DESIGN.md) for the visual contract.

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

- src/api/: shared transport, actual API types, finance operations, and error mapping.
- src/auth/: login/session/logout, CSRF refresh, expiry handling, and draft reset signaling.
- src/features/expenses/: workspace, existing form composition, reference editor, history/details, exact mapping, submission controller, and memory-only draft provider.
- src/theme/, src/components/ui/, and src/components/decorations/: preserved POV system, reusable controls, and original SVG ornaments.
- src/styles/workspace.css: scoped integration styling; original expense.css and theme tokens remain unchanged.
- tests/: 31 native Node tests for auth/client behavior, exact mapping, reference loading, CRUD, validation, UUID reuse, and error recovery.

Read [frontend-expenses.md](../docs/frontend-expenses.md) for architecture, endpoint mapping, retry/draft behavior, limitations, and the manual release checklist. [expenses-api.md](../docs/expenses-api.md) documents the backend contract. Locally bundled heading fonts retain their existing SIL licenses.

## Validation

Frontend lint, 31 tests, and production build pass. Headless Edge checks with synthetic responses covered all themes at 320/375/390/768/1440 px, empty setup, CRUD, restoration after reload, financial-role preservation across POVs, keyboard behavior, 401 draft recovery, logout, 403/409 feedback, network failures, and cold starts. No live Neon records were created. Physical devices, Safari/Firefox, actual Neon persistence, and deployment cookie behavior still need release validation.