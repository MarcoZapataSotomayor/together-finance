# Debts, independent loans and repayments API

This backend uses the existing `Debt` and `Repayment` models. A loan is one `Debt(origin=LOAN)` with no allocation source. Expense debts remain owned by the expense service. No schema, migration, dependency or frontend change is needed.

## Authentication and request conventions

Every route below requires the existing shared authenticated session. Mutations also require JSON, an allowed `Origin` and the session's `X-CSRF-Token`. Use credentialed requests and the existing session bootstrap/login flow in [authentication.md](authentication.md). Responses inherit `Cache-Control: no-store`. POV is neither accepted as an identity field nor used for authorization or counterparties. No new public routes are introduced.

Validation uses the existing global whitelist and `forbidNonWhitelisted`. Unexpected body/query properties are rejected. UUID v4 inputs are normalized to lowercase. Date-only strings must be real Gregorian dates in `YYYY-MM-DD`, years 0001–9999, and are converted at UTC midnight. Amount inputs must be positive decimal **strings** with a dot, at most 12 integral and two fractional digits, maximum `999999999999.99`. Numbers, exponent notation, commas, negatives, zero and excess precision are rejected. Currency is always PEN and is not an input property. Optional descriptions are trimmed, NFKC-normalized, limited to 2000 characters and become null when blank.

## Endpoints

All paths include the global `/api` prefix. `{}` is the body for delete/restore requests.

| Method and route | Success | Behavior |
| --- | --- | --- |
| `GET /api/debts` | 200 | Paginated expense debts and independent loans |
| `GET /api/debts/summary` | 200 | Directional totals for the complete filtered set |
| `GET /api/debts/:id` | 200 | Debt, counterparties, effective balance, source and repayment history |
| `POST /api/loans` | 201 | Create or safely replay an independent loan |
| `GET /api/loans` | 200 | Paginated loans only |
| `GET /api/loans/:id` | 200 | Same debt representation, restricted to origin LOAN |
| `PATCH /api/loans/:id` | 200 | Amend an active loan within history restrictions |
| `DELETE /api/loans/:id` | 204 | Soft-delete only the loan parent |
| `POST /api/loans/:id/restore` | 200 | Revalidate and restore the loan |
| `POST /api/debts/:id/repayments` | 201 | Create or safely replay a repayment against either origin |
| `GET /api/debts/:id/repayments` | 200 | Paginated repayment history for one debt |
| `GET /api/repayments/:id` | 200 | Repayment plus current debt details without nested repayment history |
| `DELETE /api/repayments/:id` | 204 | Soft-delete only that repayment |
| `POST /api/repayments/:id/restore` | 200 | Restore only if current source and balance permit it |

`/debts/summary` is declared before `/:id` and cannot be parsed as a UUID. Loan routes return 404 for expense-origin debts; amend/delete/restore those through the existing expense endpoints. No generic debt mutation, hard deletion, repayment amendment, settlement/netting, or correction-ledger endpoint is added.

## DTOs and examples

All examples use synthetic identifiers and data. They are documentation, not seed instructions. Use explicitly selected real person IDs only after verifying the development target.

### Create and update a loan

`CreateLoanDto` requires `id`, `debtorPersonId`, `creditorPersonId`, `amount` and `incurredOn`. Optional `dueOn` and `description` accept null. The due date must not precede incurrence. Debtor and creditor must be distinct, existing and active people. Their payment methods, POV and authentication never supply these roles.

`POST /api/loans`:

```json
{
  "id": "00000000-0000-4000-8000-000000000040",
  "debtorPersonId": "00000000-0000-4000-8000-000000000001",
  "creditorPersonId": "00000000-0000-4000-8000-000000000002",
  "amount": "100.00",
  "incurredOn": "2026-10-30",
  "dueOn": "2026-11-30",
  "description": "Synthetic independent loan"
}
```

Example response before repayments (the same shape is used in debt details and list items):

```json
{
  "id": "00000000-0000-4000-8000-000000000040",
  "origin": "LOAN",
  "currency": "PEN",
  "debtorPersonId": "00000000-0000-4000-8000-000000000001",
  "creditorPersonId": "00000000-0000-4000-8000-000000000002",
  "debtor": { "id": "00000000-0000-4000-8000-000000000001", "name": "Example borrower" },
  "creditor": { "id": "00000000-0000-4000-8000-000000000002", "name": "Example lender" },
  "originalAmount": "100.00",
  "repaidAmount": "0.00",
  "outstandingAmount": "100.00",
  "status": "OPEN",
  "active": true,
  "incurredOn": "2026-10-30",
  "dueOn": "2026-11-30",
  "description": "Synthetic independent loan",
  "expenseAllocationId": null,
  "source": null,
  "createdAt": "2026-10-31T12:00:00.000Z",
  "updatedAt": "2026-10-31T12:00:00.000Z",
  "deletedAt": null,
  "repayments": []
}
```

For origin EXPENSE, `source` contains `allocationId`, `expenseId`, `merchant`, `purchasedOn`, `allocationDeletedAt` and `expenseDeletedAt`. The debt's debtor, creditor, principal, currency and incurred date must agree with its active allocation and source expense. Details retain archived history; do not sum every returned historical record as active money.

`UpdateLoanDto` accepts the creation fields except `id`; all are optional but at least one must be supplied. Omission preserves a field. Null clears only `dueOn` or `description`. Example `PATCH /api/loans/:id`:

```json
{ "description": "Synthetic updated note", "dueOn": null }
```

Before any repayment exists, principal, counterparties and incurred date may change after validation. Once **any repayment history exists, including deleted repayments**, those financial terms are frozen. Description and a valid due date can still change. Selected people must be active for amendments, matching the expense API's selection policy. Restoring historical records and repaying existing obligations allow existing inactive people; deactivation does not erase historical balances.

### Create a repayment

`CreateRepaymentDto` requires `id`, `amount` and `paidOn`, with optional nullable `description`. The debt ID comes only from the route. `paidOn` must not precede incurrence; this API does not impose a due-date or today's-date cutoff. The debtor and creditor come from that explicit debt, never from POV.

`POST /api/debts/00000000-0000-4000-8000-000000000040/repayments`:

```json
{
  "id": "00000000-0000-4000-8000-000000000050",
  "amount": "30.00",
  "paidOn": "2026-10-31",
  "description": "Synthetic partial repayment"
}
```

Example response:

```json
{
  "id": "00000000-0000-4000-8000-000000000050",
  "debtId": "00000000-0000-4000-8000-000000000040",
  "amount": "30.00",
  "currency": "PEN",
  "paidOn": "2026-10-31",
  "description": "Synthetic partial repayment",
  "active": true,
  "createdAt": "2026-10-31T12:00:00.000Z",
  "updatedAt": "2026-10-31T12:00:00.000Z",
  "deletedAt": null
}
```

The debt now has `repaidAmount="30.00"`, `outstandingAmount="70.00"` and `status="PARTIALLY_REPAID"`. A subsequent distinct repayment of `"70.00"` settles it; `"70.01"` conflicts. GET repayment details adds a `debt` object with the current debt representation minus its `repayments` array. Creation/restore responses and repayment list items use the repayment representation above.

### Creation retry contract

Create one client-generated UUID for each intended loan or repayment and keep the same UUID and payload after a timeout or uncertain response. Equivalent decimal representations such as `"30"` and `"30.00"` match. An identical active existing record returns its current representation without a second insert, including after repayments settle the loan. Changed fields, another repayment debt, an expense occupying a loan ID, or a deleted existing record return 409. Deleted records require explicit restoration; POST never silently revives them. A new UUID is a new intended transaction. There is no extra idempotency table or immutable original-request log, so loan replay matching uses its current terms, as expense creation already does.

## Listing and filters

Debt and loan lists return `{ "data": [], "total": 0, "page": 1, "pageSize": 20 }`. `page` is 1–100000 and `pageSize` 1–100. Results are ordered by stable UUID ascending. Count and page come from one serializable snapshot; separate requests can shift after concurrent changes.

| Debt filter | Values / interpretation |
| --- | --- |
| `debtorPersonId`, `creditorPersonId` | Explicit UUID v4, combined with AND |
| `origin` | EXPENSE or LOAN; loan lists reject EXPENSE |
| `status` | `pending` = OPEN/PARTIALLY_REPAID; `settled` = PAID; omission includes every matching status |
| `incurredFrom`, `incurredTo` | Inclusive date range; start cannot exceed end |
| `deletionState` | `active` (default) or `deleted`, using effective source-chain activity |

Example: `GET /api/debts?creditorPersonId=00000000-0000-4000-8000-000000000002&origin=LOAN&status=pending&incurredFrom=2026-10-01&pageSize=20`.

Deleted debts include those inactive through a deleted source expense/allocation, even if the debt's own `deletedAt` is null. They have status INACTIVE, so combining `deletionState=deleted` with pending/settled returns no matches. Inspect the source and restore the parent through its own endpoint.

Repayment lists use `RepaymentQueryDto`: the same pagination limits plus `deletionState=all` (default), `active` or `deleted`. They are ordered by payment date descending then UUID descending. Activity includes the parent chain; a repayment on a deleted loan belongs to the inactive/deleted view even when its own deletion timestamp is null. Debt detail history includes every repayment in ascending payment-date/UUID order.

## Balances and summaries

For an effectively active debt, exact Prisma Decimal arithmetic computes:

`outstandingAmount = originalAmount - sum(repayments whose deletedAt is null)`

No mutable balance/status is stored. OPEN has no active repayments; PARTIALLY_REPAID has a positive outstanding amount after repayments; PAID has zero outstanding. Inactive debts preserve original principal and all history, but contribute zero active repaid/outstanding amount. Invalid source terms or an overpaid active debt return 409 instead of a fabricated balance.

`GET /api/debts/summary` accepts `DebtFiltersDto`, exactly the filters above, without pagination. It summarizes the **whole filtered set**, not a page. Its response contains:

- `currency` and `totals`: active principal, active repayments, outstanding amount, `activeCount`, `pendingCount`, `settledCount`, `inactiveCount`.
- `byOrigin.EXPENSE` and `byOrigin.LOAN`: the same totals separated by origin.
- `byPerson`: `{ person, owed, receivable }`, with independent totals in each direction.
- `byDebtor` and `byCreditor`: `{ person, ...totals }` views of those directions.

All money fields are two-decimal strings, including aggregates exceeding one record's Decimal(14,2) range. Counts are numbers. People appear only when represented in the filtered records. Deleted-mode summaries report inactive counts and zero financial contributions, including zero active principal. No net balance or automatic offset is produced. Owed and receivable describe the same obligations from opposite sides; do not add those directions together.

For synthetic debts A → B `"100.00"` and B → A `"30.00"`, total outstanding is `"130.00"`. A owes `"100.00"` and has `"30.00"` receivable. After A repays `"40.00"`, total outstanding is `"90.00"`, with directions `"60.00"` and `"30.00"` still separate. An active expense-origin debt contributes once; its allocation is never added again. Loans and repayments never create expenses or increase spending totals.

## Deletion, restoration and history

Deletion changes only the selected record's `deletedAt`, atomically in a transaction. Loan deletion leaves repayment flags/amounts unchanged but makes them effectively inactive. Expense deletion similarly inactivates its source debts. Repeated delete/restore calls are safe when current invariants permit them. Physical deletion is not implemented.

Loan restoration validates people, dates, source/origin consistency and all currently active repayments before clearing the parent flag. Separately deleted repayments stay deleted. Repayment restoration requires an active, consistent debt/source, excludes its own ID when calculating the proposed balance and rejects any overpayment before clearing its flag. Already-active restoration still revalidates. New repayments and restores against deleted debts/sources return 409. Repayments can be separately deleted while their parent is inactive, so parent restoration preserves that explicit choice.

All repayment records remain linked forever through restrictive foreign keys. Financial corrections after repayment history require a future reviewed correction/revision workflow. Soft deletion is not an immutable audit trail. Direct SQL can bypass these application checks; the schema has no cross-row overpayment trigger.

## Transactions, concurrency and scale

Every financial write reuses `financialTransaction`: interactive Prisma Serializable isolation, five-second max wait, ten-second timeout and at most three attempts. `P2034` retries reload the entire source/debt/repayment/reference state with 20/40 ms delays; creation also retries `P2002` races to recheck the supplied UUID. Exhaustion returns 409. Other failures roll back without automatic retry. There are no network calls inside transactions, in-process financial mutexes or session-level database locks.

Repayment creation/restoration reads the current debt/source and repayment set before inserting/restoring. Source edits and parent deletion/restoration use the same transaction discipline. This design relies on PostgreSQL detecting conflicting Serializable transactions and Prisma reporting retryable errors. See [Prisma 7 transactions](https://www.prisma.io/docs/orm/v7/prisma-client/queries/transactions) and [PostgreSQL isolation](https://www.postgresql.org/docs/current/transaction-iso.html). Absolute-field amendments retain the existing last-successful-write behavior; there is no version/If-Match contract. A valid serialization order may place a repayment immediately before deletion; that payment remains recorded but inactive through the deleted parent.

The private-app implementation reuses the financial-domain helpers instead of maintaining a second SQL balance implementation. Lists/summaries scan filtered debts in cursor batches of 100 within one snapshot, derive statuses and retain only the requested page or summary accumulator. **Pagination bounds the returned page, not total computation.** Each batch includes repayment history, repayment lists load the selected debt's history, and details return full history. Large datasets can hit the transaction timeout and need measured query/aggregate/history-pagination work. No speculative indexes or dependency upgrades were added.

Tests use a transaction-aware Prisma double, including abort, rollback, duplicate-ID and simulated concurrent-winner scenarios. They verify application revalidation and retry bounds, **not actual PostgreSQL SSI, adapter contention mapping, or cross-process concurrency**. No isolated PostgreSQL server was available; no live Neon database was used as a test fixture. Genuine concurrency validation remains required on a verified disposable test database before claiming database-level contention testing.

## Errors

| HTTP status | Examples |
| --- | --- |
| 400 | Invalid/unknown fields, decimal/date/UUID/range errors, self-loan, missing/inactive selected people, empty PATCH, payment predating incurrence |
| 401 | Missing, expired or revoked shared session |
| 403 | Missing/forged CSRF, disallowed Origin, non-JSON mutation |
| 404 | Unknown debt/loan/repayment; expense debt accessed as a loan |
| 409 | Overpayment, frozen financial terms, reserved creation UUID, deleted debt/source, inconsistent restoration, exhausted transaction retries |
| 500 / 503 | Safe generic internal error / recognized database unavailability |

The existing database exception filter prevents driver details, SQL, stack traces and connection strings from reaching responses. No financial bodies, passwords, tokens, cookies or database URLs are logged by the new modules.

## Validation and manual integration checklist

From `backend/`:

```sh
npm run prisma:validate
npm run lint
npm test
npm run test:e2e
npm run build
```

Build regenerates Prisma Client 7.10.1. Validation passes **135 unit tests** and **147 API tests**, including all existing suites. New coverage includes filters, summaries, explicit roles, exact cents and maximum money, invalid/self loans, partial/full/overpayments, UUID replay conflicts, effective deletion/restoration, historical term freezes, every new route's authentication, CSRF, whitelist/nullability, transaction rollback/retry and simulated concurrent repayments.

Before live manual writes, match the configured endpoint to the **development** branch in the Neon console. URL shape, matching direct/pooled targets and the word `development` in local context cannot independently prove branch identity. This task only checked configuration shape/target agreement without printing values; it made no live connection and created **zero live Neon records**. Run financial fixture scenarios on a disposable test database, not production or the live development ledger:

1. Authenticate; verify every new route returns 401 without a session and mutations return 403 without CSRF.
2. Create a loan between two explicitly selected people. Retry the same UUID and payload, then a changed payload. Confirm one obligation, no expense/allocation and 409 for changed intent.
3. Repay partially and exactly in full. Verify balances, pending/settled filters, directions and origin summaries. Attempt one extra cent and a duplicate UUID.
4. Delete a repayment, add a replacement payment, then restore the original when it would overpay. Confirm 409 and unchanged deletion flag; delete the replacement and restore successfully.
5. Delete/restore the loan and an expense source. Confirm effective inactivity and preservation of independently deleted repayments. Attempt financial edits with deleted repayment history and verify 409.
6. From two independent database clients/processes, synchronize overlapping repayment attempts. Confirm only a serializable, non-overpaid outcome commits, and repeat with identical UUIDs, parent edits/deletion and repayment restoration. Exercise transaction retry exhaustion and inspect persisted state after every failure.

No migration, reset, seed, production write, branch switch, commit or push was performed. The approved frontend is unchanged. Authentication's existing single-instance session/rate-limit storage and cookie deployment limitations still apply.
