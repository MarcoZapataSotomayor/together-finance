# Frontend debts, loans and repayments

The financial workspace now includes Deudas, Préstamos and Pagos alongside the existing expense form/history. It consumes the actual [debt API](debts-api.md) without changing backend endpoints, financial schema, dependencies or authentication. All interface text is Spanish; implementation and documentation use English.

## Routes and screens

| Hash route | Screen |
| --- | --- |
| `#/debts` | Debt overview, directional totals, breakdowns and filters |
| `#/loans` | Independent loan overview, including pending, settled and deleted loans |
| `#/loans/new` | Explicit debtor/creditor, positive PEN amount, date, optional due date and description |
| `#/loans/:id` | Loan details, balances, editing, confirmed soft deletion and restoration |
| `#/loans/:id/edit` | Existing loan fields; history-protected terms are disabled |
| `#/debts/:id` | Either debt origin, balances, source expense and repayment history |
| `#/debts/:id/pay` | Partial/full repayment with explicit payer/recipient confirmation |
| `#/debts/:id/repayments` | Paginated history for the selected debt, including inactive/deleted payments |
| `#/repayments` | Choose a debt whose repayment history should be opened |
| `#/repayments/:id` | Payment details, confirmed deletion/restoration and current underlying debt |

There is no backend endpoint for a global repayment list, so the Pagos entry explicitly asks users to select a debt. Expense debt summaries link to their new debt details; debt details link back to the source expense. Expense ownership/editing/deletion remain with the expense service. No unsupported debt mutation or allocation-restoration endpoint is invented.

The existing hash navigation, browser back/forward, skip link, authentication gate and expense draft provider are retained. The shell adds debt/loan/payment navigation. Original expense layouts, theme tokens, locally bundled fonts and SVG artwork remain unchanged.

## POV defaults and explicit financial parties

Shared initially shows all people, with a server-provided overall pending amount and debtor/creditor breakdowns. Antonella and Marco initially show obligations involving the corresponding database person. Matching is case-insensitive after trimming/NFKC normalization and requires exactly one complete name match. It never uses hardcoded database IDs, prefixes or approximate names.

Active people come from the existing reference API. Historical counterparties from the authenticated debt summary are merged by ID so inactive historical people can still be filtered. If a POV name is missing or ambiguous, no default financial person is guessed: the screen asks for an explicit association, or users can explicitly choose Todas las personas. Associations live only in memory and reset on logout/reload. Only POV remains in localStorage.

The API supports debtor and creditor filters combined with AND, not an involving-person OR filter. An involving-person view therefore renders **two independent scopes**: Lo que debe and Lo que le deben. Each has its own server summary, pagination and list. Direction filters can show either scope. No opposite obligations are netted, and their totals are not added together in the client. Switching POV visibly resets the overview to its default filters; overrides remain clearly labeled in the perspective notice.

Loan creation always starts with blank debtor/creditor fields, regardless of POV, mapping or current filters. Repayment parties are fixed by the explicitly selected debt; the form requires users to confirm the payer and recipient through two initially blank selections. Those confirmations are checked against that debt, and only the actual repayment DTO fields are sent. POV never authorizes access or supplies mutation counterparties.

## API and financial behavior

`src/api/debts.ts` models the actual debt, loan, repayment, page and summary responses. It validates received response shapes, precise money strings, resource IDs and linked repayments before showing success or balances. Requests reuse `apiRequest`/`apiRead`: credentialed cookies, no-store reads, JSON/CSRF mutations and a 401 callback that expires the shared session. The existing Vite `/api` proxy and optional public `VITE_API_URL` are reused. No database credentials or browser bearer tokens are introduced.

Overview filters include person, direction, origin, pending/settled, effective active/deleted state and inclusive incurrence dates. Returned totals, origin breakdowns and counterparties cover the complete server-filtered set, not just the current page. Native disclosure controls keep advanced filters and breakdowns compact on mobile, while identifying applied origin/state/status filters in their summary.

All new money input parsing, comparisons and canonicalization use **BigInt cents**. Display formats the exact server string using BigInt grouping; no monetary balance is calculated with floating-point arithmetic. The full-payment action copies `outstandingAmount` from the server into the input; it does not create a payment until users submit. No expense/spending record is created by loans or repayments.

Loan PATCH sends only changed fields. Any repayment history, including deleted rows, disables principal, counterparties and incurrence date. Description and valid due dates remain editable. Existing inactive counterparties are preserved for historical display; the backend still requires active people for amendments, and the form explains this limitation. New people can be explicitly created through the reused reference editor without selecting them automatically in financial fields.

Deletion asks for inline confirmation and supports cancellation with focus returning to its trigger. Loan deletion/restoration follows the existing parent-only lifecycle. Payment deletion/restoration uses the repayment endpoints and preserves independent flags. The UI updates balances only after a successful mutation and a fresh server read. Inactive expense debts link to their source; unsupported independent source corrections remain a backend limitation.

## Retry, errors and session recovery

Each intended creation receives one UUID on its first valid submit. `CreationSubmission` prevents concurrent/confirmed duplicate submissions and retains that UUID and a cloned payload. Ordinary retries reuse both. No financial mutation is automatically retried. An uncertain result initially locks fields and offers a GET inspection, retry or link to review that identifier. Only a matching, active, same-ID record confirms the submitted intent.

Users may explicitly choose Corregir datos conservando el identificador. This allows corrections while retaining the reserved UUID, even if an earlier request could still commit. A later definite error does not erase earlier uncertainty. If the original payload already persisted, the backend rejects different content under that UUID. After inspection finds an existing record, users can explicitly open it and close the review without claiming their corrections were saved. This avoids both duplicate payments and a permanently uneditable overpayment-conflict form.

400/404/409, overpayments, unavailable/deleted records and network failures produce Spanish recovery guidance without displaying raw backend error bodies. 403 reuses manual session revalidation and does not resend a mutation. Safe GET requests have at most two attempts; slow requests show the existing server-waking notice after three seconds. Unknown results never receive an optimistic success or balance change.

`DebtDraftProvider` sits outside the authentication gate. Only unsaved loan/payment input, pending controllers and read-view mappings remain in memory during expiry. Private financial DOM/history unmount on expiry; reauthentication restores draft fields and pending UUIDs. Confirmed save or explicit cancellation clears that draft. Logout remounts the provider and clears drafts/mappings; a full reload clears memory naturally. Do not reload to recover an uncertain write: inspect/retry its UUID first. After a reload, inspect actual history before manually creating another intended transaction.

## Files and reusable pieces

- `src/api/debts.ts`: typed operations, response validation and endpoint mapping.
- `src/features/debts/debtModel.ts`, `debtErrors.ts`, `creationSubmission.ts`: exact money, validation, POV resolution/directional filters, DTO mapping, localized errors and safe creation intents.
- `DebtDraftContext/Provider`, `useDebtApi`: memory-only recovery and authenticated API access.
- `DebtWorkspace`, `DebtOverview`, `DebtDetails`: route composition, overview/directional lists, loan/debt/payment details.
- `LoanForm`, `RepaymentForm`, `RepaymentHistory`: controlled mutations and paginated histories.
- `DebtUi`: shared decorated frame, badges, balances, facts, totals and confirmed record actions.
- `src/styles/debts.css`: scoped debt layouts and navigation wrapping. Original tokens and expense CSS are untouched.
- Small extensions to `App`, `ExpenseWorkspace`, `ExpenseSummary`, `ApiFeedback`, `ReferenceEditor`, `Button`, `api/client` and `index.css` provide composition, links, error override, unique editor IDs, React 19 button refs, recognized validation fields and styling. Login help now accurately describes POV as a view rather than identity.
- `tests/debt-*.test.mjs` and `debt-fixtures.mjs`: isolated model/API/submission tests and synthetic response fixtures.
- `tests/browser/debt-mock.mjs`, `scripts/check-debts-browser.mjs`: repeatable isolated browser scenarios, responsive checks and captures.

## Validation

From `frontend/`:

```sh
npm run lint
node --test tests/*.test.mjs
npm run build
```

All passed: **52 tests**, lint without errors and production build. The existing CI automatically discovers the new native Node tests. No backend compatibility change was needed, so backend validation was not rerun for this frontend task.

The optional browser script uses an externally available Playwright installation and browser; no project dependency was added. Supply `PLAYWRIGHT_MODULE_PATH` if it is outside normal module resolution and optionally `BROWSER_EXECUTABLE`, then run:

```sh
node scripts/check-debts-browser.mjs
```

It starts an ephemeral loopback Vite server with environment-file loading disabled and the API base forced to `/api`. It intercepts every `/api/` request with synthetic fixtures, uses a synthetic login password, closes browser/server on completion and writes screenshots only under ignored `node_modules/.cache/debt-review/`. It never starts the backend or forwards financial requests to the proxy. The script is optional and is not added to CI, which has no browser dependency.

Headless Edge validation passed create/edit/delete/restore flows, explicit roles across POV switches, ambiguous mapping, partial/full payments, overpayment rejection and restoration conflicts, lost-response retry/inspection, explicit correction with the same UUID, empty-person setup, 401 draft/UUID recovery, logout clearing and CSRF presence. All **90 combinations** of six debt surfaces, three themes and 320/375/390/768/1440px passed horizontal-overflow, unique-ID and 44px-control checks. Keyboard validation focuses the first invalid field, and confirmation cancellation returns focus. Native labels/errors, focus styles and disclosure semantics are reused. The mechanical design detector reported no findings. This is not a screen-reader or full accessibility audit.

## Manual release checks and limitations

1. On mobile and desktop, switch each POV, confirm the visible scope and direction, change filters, and verify totals/breakdowns and independent pagination. Exercise an ambiguous/missing POV name and explicit association.
2. Create an intended loan with explicit people; inspect it after refresh. Edit unpaid terms, then record a partial/full repayment and verify protected terms. Confirm money is absent from spending totals.
3. Delete/cancel/restore loans and payments. Delete one payment, create another, and verify restoring the first cannot overpay. Inspect inactive debts through a deleted expense source.
4. Simulate network loss after save, 403, 409 and expiry. Reauthenticate and inspect/retry the same UUID; verify no duplicate transaction, no automatic resend, and no financial data in localStorage. Verify logout clears drafts.
5. Test keyboard and a screen reader on target browsers and physical phones, including 320–390px layouts, long names/descriptions and large amounts. Verify session cookies and CORS on the actual HTTPS deployment.

Live Neon persistence, physical devices, Safari/Firefox, screen-reader behavior and production cookie deployment were not exercised. Overview list and summary calls are independent server snapshots, so concurrent writes can momentarily produce differences until refresh. The backend's candidate/history scan limits, lack of If-Match versions and lack of a financial correction ledger still apply. Independently removed expense source records need supported source/correction workflows; the frontend does not fabricate a generic debt restore operation. Read mappings and pending creation UUIDs intentionally do not survive a full reload.

**Zero live Neon data was modified.** No migration, reset, dependency installation/upgrade, commit, push or branch switch was performed.
