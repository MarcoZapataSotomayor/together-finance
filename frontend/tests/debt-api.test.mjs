import test from 'node:test'
import assert from 'node:assert/strict'
import { createDebtApi } from '../src/api/debts.ts'
import { ApiError } from '../src/api/client.ts'
import {
  debtIds as ids,
  debtRecord,
  loanInput,
  paymentInput,
  paymentRecord,
  summaryRecord,
  pageRecord,
} from './debt-fixtures.mjs'

test('loads debts with the real filters, summary without pagination and loan-only list', async () => {
  const requests = []
  const api = createDebtApi(
    '/api',
    'test-csrf',
    () => {},
    async (url, options) => {
      requests.push({ url, options })
      return Response.json(
        url.includes('summary')
          ? summaryRecord()
          : pageRecord([debtRecord()], 2, 10),
      )
    },
  )
  const filters = {
    debtorPersonId: ids.antonella,
    creditorPersonId: ids.marco,
    origin: 'LOAN',
    status: 'pending',
    deletionState: 'active',
    incurredFrom: '2026-10-01',
    incurredTo: '2026-10-31',
  }
  await api.list(filters, 2, 10)
  await api.summary(filters)
  await api.list({ origin: 'LOAN' }, 2, 10, undefined, true)
  const query = new URL(requests[0].url, 'http://example.invalid').searchParams
  for (const [key, value] of Object.entries(filters))
    assert.equal(query.get(key), value)
  assert.equal(query.get('page'), '2')
  assert.ok(!requests[1].url.includes('page='))
  assert.ok(requests[2].url.startsWith('/api/loans?'))
  assert.equal(requests[0].options.credentials, 'include')
})

test('uses every actual loan/repayment mutation with credentials, CSRF and exact DTOs', async () => {
  const requests = []
  const api = createDebtApi(
    '/api',
    'test-csrf',
    () => {},
    async (url, options) => {
      requests.push({ url, options })
      if (options.method === 'DELETE')
        return new Response(null, { status: 204 })
      return Response.json(
        url.includes('repayments') ? paymentRecord() : debtRecord(),
      )
    },
  )
  await api.createLoan(ids.loan, loanInput())
  await api.updateLoan(ids.loan, { description: 'Cambio' })
  await api.deleteLoan(ids.loan)
  await api.restoreLoan(ids.loan)
  await api.createRepayment(ids.loan, ids.payment, paymentInput())
  await api.deleteRepayment(ids.payment)
  await api.restoreRepayment(ids.payment)
  assert.equal(requests.length, 7)
  for (const { options } of requests) {
    assert.equal(options.credentials, 'include')
    assert.equal(options.headers['X-CSRF-Token'], 'test-csrf')
    assert.equal(options.headers['Content-Type'], 'application/json')
    assert.equal(Object.hasOwn(JSON.parse(options.body), 'pov'), false)
  }
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    ...loanInput(),
    id: ids.loan,
  })
  assert.deepEqual(JSON.parse(requests[4].options.body), {
    ...paymentInput(),
    id: ids.payment,
  })
  for (const index of [2, 3, 5, 6])
    assert.deepEqual(JSON.parse(requests[index].options.body), {})
})

test('reads detail, paginated payment history and payment detail with the actual response shapes', async () => {
  const api = createDebtApi(
    '/api',
    '',
    () => {},
    async (url) =>
      Response.json(
        url.includes('?')
          ? pageRecord([paymentRecord()])
          : url.includes('/repayments/')
            ? { ...paymentRecord(), debt: debtRecord() }
            : debtRecord(),
      ),
  )
  assert.equal((await api.get(ids.loan)).originalAmount, '100.00')
  assert.equal((await api.repayments(ids.loan, 'deleted')).total, 1)
  assert.equal(
    (await api.getRepayment(ids.payment)).debt.outstandingAmount,
    '100.00',
  )
})

test('expires authentication on 401 and surfaces 403/409 without automatic mutation retries', async () => {
  for (const status of [401, 403, 409]) {
    let calls = 0,
      expired = 0
    const api = createDebtApi(
      '/api',
      '',
      () => expired++,
      async () => {
        calls++
        return Response.json({}, { status })
      },
    )
    await assert.rejects(
      api.createRepayment(ids.loan, ids.payment, paymentInput()),
      (error) => error instanceof ApiError && error.status === status,
    )
    assert.equal(calls, 1)
    assert.equal(expired, status === 401 ? 1 : 0)
  }
})

test('leaves network mutation retries to the UUID controller and rejects malformed balances', async () => {
  let calls = 0
  const offline = createDebtApi(
    '/api',
    '',
    () => {},
    async () => {
      calls++
      throw new Error('Synthetic offline failure')
    },
  )
  await assert.rejects(
    offline.createLoan(ids.loan, loanInput()),
    (error) => error.status === 0,
  )
  assert.equal(calls, 1)
  const invalid = createDebtApi(
    '/api',
    '',
    () => {},
    async () => Response.json(debtRecord({ outstandingAmount: 100 })),
  )
  await assert.rejects(invalid.get(ids.loan), (error) => error.status === 502)
})

test('rejects malformed summaries and mismatched repayment links instead of showing invented totals', async () => {
  const malformed = createDebtApi(
    '/api',
    '',
    () => {},
    async () =>
      Response.json(summaryRecord({ totals: { outstandingAmount: '100.00' } })),
  )
  await assert.rejects(malformed.summary({}), (error) => error.status === 502)
  const mismatched = createDebtApi(
    '/api',
    '',
    () => {},
    async () =>
      Response.json(
        debtRecord({ repayments: [paymentRecord({ debtId: ids.other })] }),
      ),
  )
  await assert.rejects(
    mismatched.get(ids.loan),
    (error) => error.status === 502,
  )
})
