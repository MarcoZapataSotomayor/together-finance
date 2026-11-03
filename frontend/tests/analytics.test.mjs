import test from 'node:test'
import assert from 'node:assert/strict'
import { createAnalyticsApi } from '../src/api/analytics.ts'
import { ApiError } from '../src/api/client.ts'
import {
  monthRange,
  trendRange,
  validatePeriod,
  barPercent,
  barHeight,
  maximumAmount,
} from '../src/features/dashboard/dashboardModel.ts'
import { resolvePovPerson } from '../src/features/debts/debtModel.ts'
import {
  spendingReport,
  spendingTotals,
  analyticsIds as ids,
} from './analytics-fixtures.mjs'

test('month selection follows Gregorian calendar dates, leap years and year boundaries', () => {
  assert.deepEqual(monthRange('2024-02'), {
    from: '2024-02-01',
    to: '2024-02-29',
  })
  assert.equal(monthRange('2100-02').to, '2100-02-28')
  assert.equal(monthRange('0001-01').to, '0001-01-31')
  assert.throws(() => monthRange('0000-01'))
  assert.throws(() => monthRange('2026-13'))
})
test('date ranges enforce real, ordered dates and at most 24 calendar months', () => {
  assert.equal(validatePeriod('2025-01-01', '2026-12-31'), '')
  assert.notEqual(validatePeriod('2024-12-31', '2026-12-31'), '')
  assert.notEqual(validatePeriod('2026-02-30', '2026-03-01'), '')
  assert.notEqual(validatePeriod('2026-11-30', '2026-11-01'), '')
})
test('monthly trends include six calendar months ending at the selected range end, retaining longer ranges', () => {
  assert.deepEqual(
    trendRange({
      from: '2026-01-01',
      to: '2026-01-31',
      personId: ids.antonella,
    }),
    { from: '2025-08-01', to: '2026-01-31', personId: ids.antonella },
  )
  assert.deepEqual(trendRange({ from: '2026-01-01', to: '2026-12-31' }), {
    from: '2026-01-01',
    to: '2026-12-31',
  })
  assert.equal(trendRange(monthRange('0001-01')).from, '0001-01-01')
})
test('chart geometry uses bounded integer ratios without changing exact monetary values', () => {
  assert.equal(barPercent('0.01', '0.03'), '33.33%')
  assert.equal(barPercent('1000000000000.00', '2000000000000.00'), '50.00%')
  assert.equal(barHeight('1000000000000.00', '2000000000000.00'), 70)
  assert.equal(barHeight('0.00', '0.00'), 0)
  assert.equal(
    maximumAmount(['0.10', '0.20', '9007199254740993.01']),
    '9007199254740993.01',
  )
})
test('loads real scoped analytics with cookies, dates and person IDs, without mutation/authentication fields', async () => {
  const filters = { ...monthRange('2026-11'), personId: ids.antonella }
  let request
  const api = createAnalyticsApi(
    '/api',
    () => {},
    async (url, options) => {
      request = { url, options }
      return Response.json(spendingReport(filters))
    },
  )
  const result = await api.spending(filters)
  const query = new URL(request.url, 'http://example.invalid').searchParams
  assert.equal(query.get('personId'), ids.antonella)
  assert.equal(query.get('from'), '2026-11-01')
  assert.equal(request.options.credentials, 'include')
  assert.equal(request.options.cache, 'no-store')
  assert.equal(request.options.body, undefined)
  assert.equal(query.has('pov'), false)
  assert.equal(result.basis, 'ALLOCATION')
})
test('zero reports remain genuinely empty and do not invent financial categories or recent expenses', async () => {
  const range = monthRange('2026-11')
  const api = createAnalyticsApi(
    '/api',
    () => {},
    async () => Response.json(spendingReport(range)),
  )
  const result = await api.spending(range)
  assert.deepEqual(result.totals, spendingTotals())
  assert.deepEqual(result.categories, [])
  assert.deepEqual(result.recentExpenses, [])
})
test('POV defaults reuse exact, unambiguous database record mappings', () => {
  const people = spendingReport().people
  assert.equal(resolvePovPerson('antonella', people)?.id, ids.antonella)
  assert.equal(resolvePovPerson('marco', people)?.id, ids.marco)
  assert.equal(resolvePovPerson('shared', people), undefined)
  assert.equal(
    resolvePovPerson('antonella', [
      ...people,
      { id: ids.category, name: 'Antonella' },
    ]),
    undefined,
  )
})
test('rejects mismatched scope, malformed amounts or wrong currencies instead of showing false totals', async () => {
  const range = monthRange('2026-11')
  for (const overrides of [
    { currency: 'COP' },
    { totals: spendingTotals({ amount: 100 }) },
    { basis: 'ALLOCATION' },
    { period: { from: '2026-10-01', to: '2026-10-31' } },
  ]) {
    const api = createAnalyticsApi(
      '/api',
      () => {},
      async () => Response.json(spendingReport(range, overrides)),
    )
    await assert.rejects(
      api.spending(range),
      (error) => error instanceof ApiError && error.status === 502,
    )
  }
})
test('session expiration invokes the existing expiry callback; authorization/conflict errors are surfaced', async () => {
  for (const status of [401, 403, 409]) {
    let expired = 0,
      calls = 0
    const api = createAnalyticsApi(
      '/api',
      () => expired++,
      async () => {
        calls++
        return Response.json({}, { status })
      },
    )
    await assert.rejects(
      api.spending(monthRange('2026-11')),
      (error) => error.status === status,
    )
    assert.equal(expired, status === 401 ? 1 : 0)
    assert.equal(calls, 1)
  }
})
