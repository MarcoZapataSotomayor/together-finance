import { installAnalyticsMock } from './analytics-mock.mjs'
import { exampleRecord, references } from '../finance-fixtures.mjs'
import { debtIds as ids } from '../debt-fixtures.mjs'

export async function installMotionMock(context, month) {
  const analytics = await installAnalyticsMock(context, month)
  const person = (id) => analytics.finance.people.find((p) => p.id === id)
  const state = {
    analytics,
    expenseDelay: 0,
    repaymentDelay: 0,
    rejectExpense: 0,
    writes: [],
  }
  state.expense = exampleRecord({
    classification: 'PERSONAL',
    amount: '35.01',
    fundedByPersonId: ids.marco,
    fundedBy: person(ids.marco),
    allocations: [
      {
        ...exampleRecord().allocations[0],
        personId: ids.marco,
        person: person(ids.marco),
        percentage: '100.0000',
        amount: '35.01',
      },
    ],
  })
  // Every financial request is synthetic; unmatched routes fall back to the existing mocks.
  await context.route('**/api/**', async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname
    if (!path.startsWith('/api/')) return route.fallback()
    if (
      request.method() === 'POST' &&
      /^\/api\/debts\/[^/]+\/repayments$/.test(path) &&
      state.repaymentDelay
    ) {
      const delay = state.repaymentDelay
      state.repaymentDelay = 0
      await new Promise((resolve) => setTimeout(resolve, delay))
      return route.fallback()
    }
    if (!/^\/api\/expenses(?:\/[^/]+)?$/.test(path)) return route.fallback()
    if (!analytics.finance.authenticated)
      return route.fulfill({ status: 401, json: {} })
    if (request.method() === 'GET' && path !== '/api/expenses')
      return route.fulfill({ json: state.expense })
    if (!['POST', 'PATCH'].includes(request.method())) return route.fallback()
    const body = request.postDataJSON()
    state.writes.push({ method: request.method(), body })
    if (state.expenseDelay) {
      const delay = state.expenseDelay
      state.expenseDelay = 0
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
    if (state.rejectExpense) {
      const status = state.rejectExpense
      state.rejectExpense = 0
      return route.fulfill({ status, json: {} })
    }
    if (request.headers()['x-csrf-token'] !== 'T'.repeat(43))
      return route.fulfill({ status: 403, json: {} })
    const id = request.method() === 'POST' ? body.id : state.expense.id
    state.expense = exampleRecord({
      ...body,
      id,
      currency: 'PEN',
      fundedBy: person(body.fundedByPersonId),
      paymentMethod: references.methods[0],
      allocations: body.allocations.map((a, index) => ({
        id: `00000000-0000-4000-8000-00000000006${index}`,
        personId: a.personId,
        person: person(a.personId),
        percentage: '100.0000',
        amount: body.amount,
        active: true,
        deletedAt: null,
        debt: null,
      })),
    })
    return route.fulfill({
      json: state.expense,
      status: request.method() === 'POST' ? 201 : 200,
    })
  })
  return state
}
