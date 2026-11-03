# CSV export and centralized recycle bin

Together Finance provides authenticated CSV downloads and a unified recovery screen. There are no new financial models, schema changes, migrations, dependencies, permanent-deletion endpoints or background retention jobs.

## API contract

All paths below include the global `/api` prefix and require the existing shared session. GET requests are read-only. Existing restoration endpoints remain responsible for CSRF and financial validation; POV is never an authorization mechanism.

| GET endpoint | One CSV row represents | Date filter | Optional person matches |
| --- | --- | --- | --- |
| `/api/exports/expenses.csv` | One expense, once | Purchase date | Funder or beneficiary |
| `/api/exports/allocations.csv` | One allocation, with its own amount and percentage | Parent purchase date | That beneficiary or the parent funder |
| `/api/exports/debts.csv` | One debt, including expense and loan origins | Incurred date | Debtor or creditor |
| `/api/exports/loans.csv` | One independent loan; the same record as a loan-origin debt | Incurred date | Debtor or creditor |
| `/api/exports/repayments.csv` | One repayment | Payment date | Parent debt's debtor or creditor |

Every export requires `from=YYYY-MM-DD&to=YYYY-MM-DD`. Dates must be real, ordered calendar dates spanning at most 24 calendar months, inclusively. They use the existing PostgreSQL `date` convention, represented as UTC midnight without shifting the purchase/payment day to a browser timezone. `personId` is an optional actual UUID, not a POV name. Inactive historical people remain selectable. Missing or unknown IDs never trigger name-based guesses or financial reassignment.

`scope=active|deleted|all` defaults to `active` and is explicit in the download form and filename:

- An expense is active when its own `deletedAt` is null.
- An allocation also requires its parent expense to be active.
- An expense debt requires the debt, source allocation and source expense to be active. A loan requires its own flag only.
- A repayment also requires its complete debt/source chain to be active.
- `deleted` selects the complement of effective activity, including inherited inactivity. `all` includes both. Separate timestamp columns distinguish direct deletion from inactive ancestry.
- The expense person filter uses active allocations in active scope; deleted/all scope also considers historical allocation participants. Allocation exports always match the beneficiary on that row or the expense funder.

Example (authenticated browser/API client): `/api/exports/expenses.csv?from=2026-11-01&to=2026-11-30&scope=active`. Unknown filters, invalid dates, invalid UUIDs or invalid scopes return 400. Unsupported datasets return 404. Authentication failures return 401; oversized exports return 413. Internal database errors use the existing redacted error filter.

## CSV format and financial meaning

Files use UTF-8 with a BOM, comma separators, Spanish headers, CRLF records and double-quoted cells. Embedded double quotes are doubled; commas and meaningful multiline descriptions stay inside their cells. Null fields are empty. These conventions follow [RFC 4180](https://www.rfc-editor.org/rfc/rfc4180).

Money is serialized directly from Prisma Decimal using `toFixed(2)`; allocation percentages use four decimal places. No financial total passes through a JavaScript floating-point number. Currency is PEN. Identifiers are stable database UUIDs. Financial dates are `YYYY-MM-DD`; deletion timestamps are ISO 8601 UTC. Spreadsheet software can infer its own display types: use its text/CSV import settings to preserve decimal strings, trailing zeros and dates exactly.

| File | Main column groups |
| --- | --- |
| Expenses | Expense ID, purchase date, merchant, description, amount/currency, classification, category ID/name, payment method ID/name, funder ID/name, effective state, deletion timestamp |
| Allocations | Allocation/expense IDs, purchase date, beneficiary ID/name, percentage, allocation amount/currency, funder ID/name, effective state, allocation/expense deletion timestamps |
| Debts and loans | Debt ID/origin, source allocation/expense IDs when applicable, incurred/due dates, description, original principal/currency, debtor/creditor IDs/names, effective state, debt/source deletion timestamps |
| Repayments | Payment/debt IDs, debt origin, source expense ID, payment date, description, amount/currency, debtor/creditor IDs/names, effective state and payment/debt/source deletion timestamps |

Expenses and allocations are separate files so allocation rows cannot repeat the full expense amount. The allocation file contains responsibility, while the expense file identifies who funded the purchase. Loans are a subset of debts, not additional obligations. Debt/loan principal is historical original principal, **not current outstanding balance**; use existing debt summaries for current obligations. Repayments and loan disbursements are not new spending. Files contain no mixed financial grand total and must not be added together as spending.

Empty exports are valid header-only files. No sample financial values appear in the production screens.

## Security and resource limits

CSV quotation does not itself prevent spreadsheet formulas. Before quoting, unsafe nonprinting controls are removed; formula inspection uses Unicode compatibility normalization and recognizes leading formula operators, full-width variants, leading whitespace/invisible separators and leading tab/line breaks. Risky cells receive a leading tab inside the quoted field for Excel's text-cell handling, following [OWASP CSV injection guidance](https://owasp.org/www-community/attacks/CSV_Injection). This deliberately changes risky text for spreadsheet viewing; it is not a lossless data interchange format. Do not strip protective prefixes or enable untrusted formulas. Spreadsheet behavior varies, and external editing/re-export is outside the application's control; actual Excel/LibreOffice release checks remain necessary.

Only useful selected columns are fetched. Person notes, authentication configuration, cookies, CSRF/session tokens and database URLs are never exported. Responses use `text/csv; charset=utf-8`, a fixed descriptive attachment filename, `Content-Length`, `X-Content-Type-Options: nosniff` and `Cache-Control: private, no-store`. Existing exact-origin credentialed CORS now exposes only the additional `Content-Disposition` header. It does not allow new origins or weaken CSRF.

Each request reads UUID-keyset pages of 100 rows inside the existing Serializable transaction policy (10-second transaction timeout, at most three conflict attempts). It does not hydrate entire repayment histories. Output is capped at **10,000 data rows and 8 MiB including headers/BOM**. Narrow filters when a cap or server timeout is reached.

A generated private temporary directory/file spools the bounded snapshot before HTTP headers are sent. Serialization retries truncate and restart it. The database transaction finishes before the client receives the file, so slow downloads do not hold a database transaction. Files are removed after stream closure, disconnect or generation failure. Permissions request owner-only access on POSIX; Windows ACLs follow the host's temporary-directory policy. A process crash can interrupt cleanup: deploy on private ephemeral storage, keep sufficient disk space and manage host-level temporary-file hygiene. This is file cleanup, not financial-record retention. There is no public file URL or download cache.

The frontend accepts only CSV responses, bounds received bytes, aborts requests on cancellation/unmount, prevents simultaneous submissions and revokes object URLs on replacement/unmount. Exports are explicit GET operations with no automatic retry; ordinary bin/catalog reads reuse the bounded cold-start retry helper. Session expiration returns to the existing login gate. No financial file, auth token or expense data is written to localStorage.

## Central recycle bin

`GET /api/recycle-bin` returns `{ data, total, page, pageSize }`. Parameters:

- `type=expense|loan|repayment` (optional).
- `deletedFrom`, `deletedTo`: optional valid `YYYY-MM-DD` dates filtering the **direct deletion timestamp's UTC calendar day**, inclusively. Both boundaries are optional; reversed bounds return 400.
- `page`: 1–100,000, default 1; `pageSize`: 1–100, default 20.

A parameterized PostgreSQL `UNION ALL` combines directly deleted expenses, loan-origin debts and repayments. One global `deleted_at DESC, id DESC, kind ASC` order and LIMIT/OFFSET provide deterministic combined pagination. Count and record details use the same transaction snapshot, with at most three bounded hydration queries for a page rather than a query per item. Existing deletion indexes are retained. Expense beneficiaries are limited to 20 (the form's maximum), with a remaining-count disclosure if older/imported records exceed that; full history remains in the existing detail screen.

Each item includes `kind`, UUID, description/reference, exact amount/currency, original date, deletion timestamp, relevant people with roles, `morePeople`, optional parent reference and `canRestore`. The parent object identifies an expense or loan to inspect when a repayment's source is inactive. `canRestore` checks parent activity only; it is **not a guarantee** that financial validation will accept restoration.

Only records with their own deletion timestamp appear here. Child payments made inactive solely by a deleted parent do not acquire invented deletion dates or separate restoration actions. Their history remains in the parent detail. Expense-generated debts are recovered through the expense, not presented as independent loans.

`GET /api/data-management/people?page=1&pageSize=100` supplies a paginated, protected historical-person catalog: only ID, name and `isActive`, including inactive people. The export screen caps catalog loading at 100 pages (10,000 people).

### User recovery flow

Open **Eliminados**, choose type/deletion dates and apply filters. Inspect the detail if needed, then choose **Restaurar**. The action dispatches to the existing API:

- `POST /api/expenses/:id/restore`
- `POST /api/loans/:id/restore`
- `POST /api/repayments/:id/restore`

Each requires the existing session, allowed Origin, JSON content and CSRF header. No new restore rules bypass existing services. Restore requests are not automatically repeated, and a synchronous submission lock prevents duplicates. Success refreshes the bin and workspace data; failures keep the row and offer the existing manual access revalidation where applicable. A failed read is not rendered as an empty dataset.

A parent must be active before a deleted repayment can be restored. Replaced allocations, inconsistent source terms, repayment dates or overpayment can still produce 409. Independently deleted child flags remain deleted when restoring a parent. Restoration is not a destructive operation; existing soft-delete controls retain their explicit confirmation flow.

## Permanent deletion is intentionally unavailable

All existing financial foreign keys use `Restrict`, not cascade. Repayment history, including deleted payments, deliberately protects original principal, counterparties and dates. Hard-deleting a repayment could unlock protected edits; deleting an expense/allocation/debt could destroy obligation history. Even a childless loan reserves its creation UUID for idempotency, which physical deletion would lose. There is no immutable audit/tombstone ledger to preserve those guarantees.

Consequently this task introduces **no permanent-deletion endpoint or delete-forever control**, including for apparently isolated records. Unsupported permanent-deletion paths return 404 and do not alter records. There is no automatic expiry. A future implementation needs an explicitly reviewed audit/tombstone and dependency-safe correction design before any schema change or migration, plus authenticated, CSRF-protected, confirmed destructive actions. Do not repurpose the existing DELETE endpoints: they remain soft deletion.

## CSV is not a PostgreSQL backup

CSV is a filtered, human-readable financial extract. It omits application configuration, constraints, indexes, full audit timestamps and potentially historical rows outside the scope. Formula neutralization can change text. There is no CSV import/restore feature. Downloading all five files does not create a mutually atomic backup; each file has its own snapshot.

PostgreSQL backups/Neon recovery preserve database-level structure and recovery semantics. Use a separately reviewed backup and recovery procedure with protected storage, access controls and a restore drill against an isolated target. This feature does not run `pg_dump`, migrations, seeds, resets or live database writes during validation.

## Files and structure

- `backend/src/data-management/`: module/controller, validated export/bin DTOs, bounded CSV serializer/spool, read-only export service, recycle-bin service, focused unit tests. The app imports this module; CORS exposes the attachment filename.
- `backend/test/data-management-store.ts`, `data-management.e2e-spec.ts`: isolated query fixture and authenticated API/security/restore tests.
- `frontend/src/api/dataManagement.ts`: checked bin/catalog responses, exact CSV bytes and bounded download transport; shared `client.ts` adds opt-in raw responses without changing default JSON behavior.
- `frontend/src/features/data-management/`: export and recycle-bin screens and API hook. They reuse `DebtFrame`, form fields, buttons, badges, feedback, focus styling, ornaments, existing auth and restore clients.
- `frontend/src/styles/data-management.css`: scoped layouts using existing theme tokens; workspace navigation and CSS imports register the new screens. Existing approved forms, themes and business behavior are preserved.
- `frontend/tests/data-management.test.mjs`, `tests/browser/data-management-mock.mjs`, `scripts/check-data-management-browser.mjs`: transport/security tests and repeatable, entirely mocked browser checks.
- Root, frontend and backend READMEs link this document.

## Validation

Current complete results: **169 backend unit tests, 178 backend API tests, 72 frontend Node tests**, both lint checks and production builds, plus Prisma schema validation. Added tests cover quoting/newlines, Unicode/formula protection, exact cents and maximum decimal precision, date/person/deletion filters, separate record meanings, paging/retry reset, byte/row caps, temporary-file cleanup, inherited inactivity, empty results, 401/logout, CORS, CSRF, restore success/overpayment conflicts, unsupported permanent deletion, malformed responses, network failures and cancellation.

Commands from `backend/`: `npm run lint`, `npm test`, `npm run test:e2e`, `npm run build`, `npm run prisma:validate`. From `frontend/`: `npm run lint`, `node --test tests/*.test.mjs`, `npm run build`. Existing CI already discovers the new suites; it needs no workflow change or credentials. Formatting was limited to new feature files using the installed Prettier. No package installation was necessary.

Optional browser check, using an already available Playwright installation and browser (no app dependency):

```powershell
$env:PLAYWRIGHT_MODULE_PATH = '<path-to-playwright-module>'
$env:BROWSER_EXECUTABLE = '<path-to-browser-executable>'
cd frontend
node scripts/check-data-management-browser.mjs
```

Headless Edge passed **30 screen/theme/width combinations**: both screens, Antonella/Shared/Marco, 320/375/390/768/1440 px. Checks include actual browser download bytes/BOM, download cancellation, filters, empty/conflict/success/expiry states, parent-first restoration, CSRF dispatch, keyboard focus, labels, tap targets, duplicate IDs, localStorage and horizontal overflow. Representative mobile and desktop screenshots were inspected. Fixtures intercept all API requests; no financial request reaches Neon. The theme detector reported no findings for the new screens/styles.

Release checklist: open both routes on a phone and desktop; switch all POVs; download each scope/type and import as UTF-8/comma/text in Excel; verify exact amounts and formula-neutralized text; filter deletion dates in UTC; restore an independent child only after its parent; confirm a conflicting restore retains history; expire/logout the session during reads/downloads. Use isolated development fixtures for these writes.

At the data-management stage, API tests used an in-memory query double. The subsequent [production-readiness stage](production-readiness.md) now tests the recycle-bin UNION and financial concurrency against actual disposable PostgreSQL, including a real backup/restore drill. Browser tests still use synthetic API responses; physical devices, Safari/Firefox, screen readers, actual Excel/LibreOffice and production cookie/CORS deployment remain release checks. Resource caps intentionally reject broad exports rather than generating background jobs. **No live Neon data was modified.**
