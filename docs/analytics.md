# Financial dashboard and spending analytics

The authenticated home screen is now `#/dashboard`. It replaces the dormant design-system financial examples with real API-backed spending, category analysis, monthly trends, funding/responsibility, recent expenses and current obligations. No income, savings, available cash or bank balance is invented. Currency is PEN throughout.

## Spending endpoint

`GET /api/analytics/spending?from=2026-11-01&to=2026-11-30&personId=00000000-0000-4000-8000-000000000001`

`SpendingQueryDto` requires `from` and `to`: valid Gregorian date-only strings in `YYYY-MM-DD`, years 0001–9999, inclusive and ordered. A request may span at most **24 calendar months**, including both boundary months. `personId` is an optional UUID v4 for an existing financial person, including an inactive historical person. Omission means the complete shared ledger. IDs are normalized to lowercase. Unknown query properties, including POV, currency and pagination, are rejected by the existing global whitelist validation.

The route inherits the shared-session guard and `Cache-Control: no-store`. It is read-only and introduces no mutation route. Existing financial mutations retain their existing CSRF, JSON and Origin checks. Safe database exception handling is reused; no connection values or financial request bodies are logged.

Response properties:

| Property | Meaning |
| --- | --- |
| `currency` | PEN |
| `period` | Actual inclusive `from` / `to` filters |
| `basis` | EXPENSE_TOTAL globally, ALLOCATION for a selected person |
| `person` | Selected `{ id, name }`, or null |
| `people` | Complete compact `{ id, name, isActive }` catalog for safe read-view mapping, including inactive people; no notes or credentials |
| `totals` | `amount`, `personalAmount`, `sharedAmount`, `expenseCount`, `fundedAmount`, `fundedExpenseCount` |
| `monthly` | Every covered calendar month, ascending, with the same metrics and `month: YYYY-MM`; missing months are zero-filled |
| `categories` | `{ category: { id, name }, amount, expenseCount }`, descending amount then stable category ID |
| `byPerson` | `{ person: { id, name }, allocatedAmount, fundedAmount }`, grouped by stable person ID |
| `recentExpenses` | Up to five scoped expenses, purchase date descending then UUID descending |

Recent expense entries contain `id`, `merchant`, `purchasedOn`, `classification`, `category`, `fundedBy`, `expenseAmount` and `attributedAmount`. They deliberately distinguish the original purchase amount from the selected person's share. No historical allocation/payment rows are returned here.

Selected response fields for a **synthetic** S/ 100.01 shared purchase with a stored S/ 50.01 allocation to the selected person, paid entirely by someone else:

```json
{
  "currency": "PEN",
  "period": { "from": "2026-11-01", "to": "2026-11-30" },
  "basis": "ALLOCATION",
  "person": { "id": "00000000-0000-4000-8000-000000000001", "name": "Example beneficiary" },
  "totals": {
    "amount": "50.01",
    "personalAmount": "0.00",
    "sharedAmount": "50.01",
    "expenseCount": 1,
    "fundedAmount": "0.00",
    "fundedExpenseCount": 0
  },
  "monthly": [
    {
      "month": "2026-11",
      "amount": "50.01",
      "personalAmount": "0.00",
      "sharedAmount": "50.01",
      "expenseCount": 1,
      "fundedAmount": "0.00",
      "fundedExpenseCount": 0
    }
  ]
}
```

All monetary fields are exact two-decimal **strings**, including zero and aggregates larger than one stored Decimal(14,2) column. Counts are nonnegative numbers. An empty period has real zero totals, zero-filled month rows, and empty categories/person contributions/recent expenses. A valid selected person remains identified even without activity.

Errors: 400 for malformed dates/IDs, missing filters, unknown people, reversed/excessive ranges or extra properties; 401 for missing/expired/revoked authentication; 409 for inconsistent active allocation data or exhausted serialization retries; safe 500/503 for internal/temporary database failures. Failed reads never become successful zero reports.

## Exact financial rules

1. Only active expenses within the purchase-date range contribute. A shared expense is counted **once**, using its original amount in the unfiltered ledger.
2. Person-scoped spending is the sum of that person's **active stored allocation amounts**, not the amounts they funded. Personal/shared classification comes from the source expense; a person's portion of a shared bill remains shared spending.
3. Funding is independently the original amount of active expenses whose explicit `fundedByPersonId` matches the selected person. Someone can have zero attributed spending and positive funding for another person's purchase. Funding is not limited to expenses in which the funder has an allocation.
4. `byPerson` contains all contributing funders/beneficiaries globally, or only the selected person's metrics when scoped. Names/POV/payment-method owners never supply financial roles. Inactive reference records retain their historical contributions.
5. Soft-deleted parents and archived allocations do not contribute. Active source allocations are checked with the existing financial-domain validation. If independent child deletion leaves a malformed active expense, the API returns 409 instead of inventing unassigned totals. Normal expense amendments archive obsolete allocations while retaining a valid replacement set.
6. Stored allocation rounding is preserved exactly. The existing largest-remainder policy is validated; analytics does not recompute shares for display or redistribute cents. After per-record Decimal validation, all cross-record financial addition uses **BigInt integer cents**, then serializes back to decimal strings. No floating-point financial arithmetic is used.
7. Categories, monthly totals, classifications and recent entries all use the same scoped responsibility amount. Funding has its own metrics. Zero-cent allocations can still identify an expense in a person's count; counts describe records, not another monetary total.
8. Loans, debts and repayments are never queried as spending sources. No loan disbursement or repayment increases expenses or gets added to category totals.
9. Monthly grouping uses the existing PostgreSQL DATE convention: Prisma UTC-midnight dates become `YYYY-MM-DD`, and the first seven characters identify the calendar month. No audit timestamp or local timezone shifts a purchase into another month.

## Debt summaries and time semantics

The dashboard reuses `GET /api/debts/summary` and its existing financial helpers. It does not implement another balance engine. Personal views show payable and receivable separately; Shared shows each outstanding obligation once and per-person directions. Opposite directions are never automatically netted or added together as spending.

The debt section explicitly covers **current active obligations across all dates**, with current active repayments deducted. Spending date filters do not pretend to create historical/as-of debt balances. These semantics are labeled in the interface. For date-cohort debt filtering or individual records, use the existing [debt screens/API](debts-api.md).

## Dashboard behavior and charts

The default period is the current calendar month on the viewer's device. Users can choose another month or a custom range; Este mes restores the current month. Partial custom periods are labeled with their actual boundaries. Month selection follows Gregorian leap-year rules, including year boundaries.

Antonella and Marco reuse the existing exact, unique name resolver and explicit mapping context. The new endpoint's complete person catalog prevents inactive historical people or out-of-period records from being silently missed. Missing/ambiguous names require explicit mapping or an explicit choice of all people. Manual read-scope overrides are preserved per POV across period updates/refreshes and remain visibly labeled. POV is never authentication and does not change financial forms or records.

The dashboard uses the approved semantic tokens, decorated frame, original SVG ornaments, locally bundled headings, controls, feedback and focus styles. It adds no chart dependency:

- Personal/shared distribution: two CSS segments with exact labeled amounts.
- Category analysis: horizontal bars for up to eight categories, with a complete exact-value disclosure when more categories exist.
- Monthly trend: CSS columns, a keyboard-focusable horizontally scrollable region and exact monthly values in a native disclosure. Empty months remain explicit. Zero amounts do not draw positive-height bars.
- Contribution and obligation ledgers: names and independently labeled responsibility/funding or payable/receivable columns.
- Recent purchases: actual API records linked to existing details, with the full purchase and allocated portion distinguished for personal views.

Trend history covers at least six calendar months ending on the selected end date, or the full selected range when longer. It uses the same endpoint with the wider range and the same person scope; if the ranges coincide, the response is reused. The chart labels its actual range, which may begin before the category/recent-expense period. Integer-scaled chart geometry can round visual widths/heights; exact monetary labels remain unchanged.

Loading and cold-start notices, at most two safe-read attempts, manual refresh, 401 expiry and 403 revalidation reuse the current API/auth architecture. Malformed response shapes, currencies, amounts or scopes are rejected. Session expiry removes the dashboard DOM through the existing gate. No financial records/tokens are stored in localStorage; only the pre-existing POV preference is persisted there. No mutation or optimistic balance update is performed by the dashboard.

## Architecture, changed files and limits

- New backend `src/analytics/`: DTO, protected controller/module, read service, exact accumulator and unit tests. `AppModule` registers it.
- The read service scans minimal expense/category/funder/allocation projections in batches of 100 inside one existing Serializable transaction, including catalog lookup, aggregation and recent selection. Each retry creates a fresh accumulator. Existing `(deletedAt, purchasedOn)` and reference indexes support the query; no schema/index migration was introduced.
- New `backend/test/analytics.e2e-spec.ts`; the existing transaction-aware test double now correctly treats a reference `findMany` without `take` as unbounded, matching Prisma semantics.
- New frontend `src/api/analytics.ts` and `src/features/dashboard/`: response models/checks, exact date/chart helpers, dashboard composition and accessible CSS charts.
- New `src/styles/dashboard.css`; small changes to shell/default navigation and the stylesheet entry point.
- The two unused design-system showcase files containing fictitious COP income/balance examples were removed. Reusable components and all approved theme tokens/expense/debt screens were preserved.
- New native Node tests and optional `tests/browser/analytics-mock.mjs` / `scripts/check-dashboard-browser.mjs`; root/frontend/backend READMEs link this guide.

The date range is bounded, but computational work still grows with matching expenses and allocations. Batches limit transient row memory; category/person accumulators and the complete person catalog are not paginated. Read transactions use the existing five-second max wait, ten-second timeout and three-attempt retry policy. Measure against representative isolated data before larger-scale aggregation/index work.

Spending, trend and debt HTTP calls are separate snapshots. Concurrent writes can briefly produce differences until refresh; there is no cross-endpoint snapshot or historical/as-of debt ledger. Application validation detects malformed source allocations, but direct database writers can still violate cross-row invariants. Physical devices, screen readers, Safari/Firefox, real PostgreSQL concurrency/load, live Neon integration and production cookie deployment remain release checks.

## Validation

From `backend/`: `npm run lint`, `npm test`, `npm run test:e2e`, `npm run build`, `npm run prisma:validate`.

From `frontend/`: `npm run lint`, `node --test tests/*.test.mjs`, `npm run build`.

All passed: **149 backend unit tests, 161 backend API tests, and 61 frontend tests**. Coverage includes shared totals, person attribution/funding, multiple categories, exact odd/maximal cents, Gregorian monthly boundaries and gaps, deleted parents/archived allocations, inconsistent active records, non-expense loans/repayments, safe scope resolution, empty responses, failed reads, private-route/revoked-session behavior and unchanged existing suites. The existing GitHub Actions commands discover these files automatically; workflow execution on GitHub was not triggered.

Optional browser check: build the backend first, provide an existing external Playwright installation through `PLAYWRIGHT_MODULE_PATH` if needed and optionally `BROWSER_EXECUTABLE`, then run `node scripts/check-dashboard-browser.mjs` from `frontend/`.

The script imports the **built production AnalyticsService** with a read-only synthetic adapter. It starts an ephemeral loopback Vite server with environment-file loading disabled, forces `/api`, intercepts all financial/auth requests, and closes browser/server afterward. It never constructs a database connection. Screenshots contain only synthetic data and are written under ignored `node_modules/.cache/dashboard-review/`.

Headless Edge passed POV/mapping, person/period preservation, exact allocation/funding display, category/recent records, empty states, API failures, session recovery, cold-start feedback and no-financial-write checks. All **15 combinations** of three POV themes and 320/375/390/768/1440px passed page-overflow, label, duplicate-ID and 44px-control checks. The design detector returned no findings. This is not a complete screen-reader/accessibility certification.

**No live database connection or data modification was performed.** No secrets were printed, dependencies upgraded/installed, migrations applied, commits/pushes made or branches switched.
