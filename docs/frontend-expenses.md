# Frontend expense integration

The existing themed React form now uses the NestJS API to create, retrieve, edit, soft-delete, and restore expenses. Production code has no seeded people, hardcoded database IDs, or sample expenses. POV changes presentation and field order only.

## Running locally

Use the existing backend environment and shared-password setup. Run `npm run start:dev` from `backend/` and `npm run dev` from `frontend/`. The existing Vite `/api` proxy targets port 3000. If Vite selects another frontend port, include its exact origin in backend `CORS_ORIGINS`.

Before manually saving real data, verify the intended Neon development branch in the console. No live database was used for this task's validation. No database setup, migration, reset, or seed is required by frontend integration.

Optional `VITE_API_URL` is only a public API base URL including `/api`; never put credentials in frontend configuration. Production must follow the cookie/CORS deployment guidance in [authentication.md](authentication.md). Use a modern browser with BigInt and AbortSignal support. Secure UUID generation requires HTTPS or a trustworthy local context; see [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID). Test a physical phone over HTTPS instead of assuming an HTTP LAN address behaves like localhost.

## Pages and reference setup

Native hash links support static hosting and browser back/forward without another routing dependency:

- `#/expenses/new`: new expense and reference creation.
- `#/expenses`: paginated history with Activos / Eliminados and filters.
- `#/expenses/:id`: details, allocations, debt/payment history, deletion, and restoration.
- `#/expenses/:id/edit`: the existing themed form populated from the API.

The skip link focuses content without changing the route. New/edit forms use distinct field IDs. Approved theme tokens, fonts, SVG ornaments, and original expense styling are preserved; new views reuse their frame and controls.

People, categories, and methods load from their paginated endpoints. Empty collections open **Personas y opciones del formulario**, where users explicitly create the records they need. Nothing is inserted automatically. Creation is confirmed by the API before an option is added/selected. Creating a person never selects a funder or beneficiary. **Actualizar opciones** refreshes choices changed elsewhere.

The client loads all reference pages, bounded to 100 pages of 100 records per collection. Larger catalogs need future server-side search. Current selection endpoints expose active choices only.

Payment method types use the actual backend enums. Credit/debit belongs to the selected stored method and is displayed read-only in the expense form; create/select another method to change its type. A registered method owner is metadata. **¿Quién aporta el dinero?** is always explicit and separate. Changing methods clears that selection.

## Financial mapping and saving

Personal expenses require one explicit beneficiary. Shared expenses support 50/50 between two selected people or custom positive percentages among 2–20 unique selected people. Percentages allow four fractional digits and must total exactly 100. IDs come from the API, never a name/POV mapping.

The mapper sends canonical decimal strings, date-only strings, merchant/description, category/method/funder IDs, classification, and percentage allocations. It never submits inferred ownership, computed allocation amounts, debt rows, currency, or POV. Amounts accept a dot/comma with at most two decimals within the backend's Decimal(14,2) range. BigInt cents and percentage units implement the same largest-remainder/UUID tie policy as the backend. Floating point is used for localized display, not allocation arithmetic. Stored API results remain authoritative.

Each intended new expense gets one UUID on its first valid submission. A synchronous lock prevents overlapping requests. The controller retains the UUID and payload for retries; a confirmed controller cannot submit again. **Registrar otro consumo** starts a new intended expense.

Mutations are never automatically retried. A lost response, timeout, server failure, or creation conflict can leave persistence uncertain. The form keeps its submitted fields protected and offers either a retry with the same UUID/payload or **Comprobar guardado**, a GET of that resource. A changed/deleted recovered record is not falsely confirmed; its detail link is provided for review. Definite validation/access failures allow correction without silently generating a new ID. Confirmation appears only after an API response establishes persistence.

Edits PATCH the existing record and retain fields on error. Repayment-protected financial changes produce a Spanish 409 explanation. No financial balance changes optimistically before server confirmation.

## Authentication, errors, and drafts

Auth and finance reuse `src/api/client.ts`: credentialed fetch, no-store, redirect rejection, request timeouts, JSON mutation bodies, and session-bound CSRF headers. Error objects retain status/known field names, not raw database/server messages. Spanish feedback handles validation, 401, 403, 404, 409, rate limits, and network/server failures.

Safe GETs make at most two attempts, with a 30-second timeout per attempt and a one-second gap for temporary failures. Superseded/unmounted reads cancel. Loading text changes after three seconds to explain a server cold start. There is no unlimited polling or automatic financial mutation retry.

A 401 unmounts private views and requires login. Unsaved expense input and its pending request controller remain in a separate **memory-only** draft provider so the same fields/UUID resume after reauthentication. Server-loaded history/reference state is not rendered while unauthenticated. A 403 offers **Revalidar acceso**, which refreshes session/CSRF metadata without resubmitting or discarding the draft.

Confirmed saving, explicit edit cancellation, or explicit logout clears the corresponding draft. A full page reload/tab closure also clears memory, including an unresolved UUID. After a reload following an uncertain save, inspect history before manually creating another expense; no automatic resend occurs. Only POV is stored in localStorage. No authentication tokens or financial drafts/records are written there.

## History and restoration

History displays merchant, amount, date, category, funder, classification, and financial allocations. Available filters are inclusive date range, category, beneficiary, funder, and personal/shared classification, with pagination up to 100 records per page. Details include archived allocations and retained payment history with effective activity/debt status.

Deletion uses an inline confirmation with cancel/focus restoration. After a successful DELETE, details reload from the server. Restore uses the existing POST restore endpoint and displays its confirmed result. Permanent deletion is unavailable.

One necessary backend compatibility addition enables recovery after refresh: `GET /api/expenses?deletionState=deleted`. The default `active` mode remains unchanged. **Eliminados** loads deleted records directly from the authenticated API, so recovery needs neither a client-only deletion list nor a memorized UUID. Both modes retain existing filters, pagination, guards, and transaction-consistent page/count reads. No schema/migration change was needed.

Other browsers' changes require **Actualizar** / **Actualizar opciones**; this is not real-time synchronization. The existing backend has no If-Match/version contract, so concurrent edits follow its serializable transaction behavior. Inactive reference management and repayment corrections remain outside the current API.

## Structure and validation

- `src/api/{client,types,finance}.ts`: transport, actual API models, typed operations, reference pagination, response checks, and Spanish error mapping.
- `src/auth/`: existing session flow with refresh/expiry callbacks and explicit-logout draft reset signaling.
- `ExpenseWorkspace`, `ExpenseHistory`, `ExpenseDetailScreen`: navigation, loading, filtering, editing, deletion/restoration, and refresh coordination.
- `NewExpenseScreen`, `ExpenseDetailsFields`, `ReferenceEditor`: themed form and explicit persisted reference creation.
- `ExpenseFrameTitle`, `ExpenseSummary`, `ApiFeedback`: shared presentation and feedback.
- `expenseModel`, `expenseSubmission`, `ExpenseDraftContext/Provider`, `useResource`, `useFinanceApi`: exact mapping, request locking, memory-only recovery, and request lifecycle.
- `src/styles/workspace.css`: scoped navigation/history/reference styling.

Passed frontend commands: `npm run lint`, `node --test tests/*.test.mjs` (**31 tests**), and `npm run build`. The backend compatibility addition passes lint/build, **96 unit tests**, and **70 API tests**; prebuild generated Prisma Client 7.10.1. No dependency or migration changes were made. The existing CI discovers the new tests automatically.

Isolated headless Edge checks used synthetic API responses. They covered personal/shared/custom creation, independent funders/POV, empty reference setup, keyboard creation and skip navigation, UUID reuse after a lost response, edit conflicts, deletion cancellation, restoration after refresh, pagination/filters, 401 draft recovery, explicit logout, 403 revalidation without resubmission, bounded failures, and slow-server messaging. Form/history/detail layouts passed 320/375/390/768/1440 px checks across all themes without horizontal scrolling or runtime errors. No Playwright dependency was added to the project.

Manual release checks: verify the development database before intended writes; save/refresh/edit/delete/restore real intended records; exercise existing repayment conflicts; test expiration and lost responses; check every theme with keyboard and a physical phone; verify cookies on the actual HTTPS deployment and target browsers.

Live frontend-to-Neon persistence, physical devices, Safari/Firefox, and production origins were not exercised here. Real PostgreSQL contention remains subject to the backend's documented integration-test limitation. **Zero live Neon development or production records were created during validation.**
