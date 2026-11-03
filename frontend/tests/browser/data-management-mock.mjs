import { installDebtMock } from './debt-mock.mjs'
import { debtIds as ids, paymentRecord } from '../debt-fixtures.mjs'
import { exampleRecord } from '../finance-fixtures.mjs'

// All financial reads and mutations in the browser check stay inside these synthetic fixtures.
export async function installDataManagementMock(context, existingFinance) {
  const finance = existingFinance ?? (await installDebtMock(context))
  const state = {
    finance,
    requests: [],
    expenseDeleted: true,
    failExport: 0,
    failBin: 0,
    delayExport: 0,
  }
  finance.debts[0].deletedAt = '2026-11-01T12:00:00.000Z'
  finance.payments.push(
    paymentRecord({ deletedAt: '2026-11-01T13:00:00.000Z' }),
  )
  const person = (id, role) => ({
    id,
    name: finance.people.find((p) => p.id === id).name,
    role,
  })
  function rows() {
    return [
      ...(state.expenseDeleted
        ? [
            {
              kind: 'expense',
              id: ids.expense,
              description: 'Consumo sintético, con "detalle"',
              amount: '100.01',
              currency: 'PEN',
              transactionDate: '2026-10-30',
              deletedAt: '2026-11-01T14:00:00.000Z',
              people: [
                person(ids.marco, 'Financiador'),
                person(ids.antonella, 'Beneficiario'),
              ],
              morePeople: 0,
              parent: null,
              canRestore: true,
            },
          ]
        : []),
      ...finance.debts
        .filter((d) => d.deletedAt)
        .map((d) => ({
          kind: 'loan',
          id: d.id,
          description: d.description,
          amount: d.originalAmount,
          currency: 'PEN',
          transactionDate: d.incurredOn,
          deletedAt: d.deletedAt,
          people: [
            person(d.debtorPersonId, 'Deudor'),
            person(d.creditorPersonId, 'Acreedor'),
          ],
          morePeople: 0,
          parent: null,
          canRestore: true,
        })),
      ...finance.payments
        .filter((p) => p.deletedAt)
        .map((p) => {
          const debt = finance.debts.find((d) => d.id === p.debtId)
          return {
            kind: 'repayment',
            id: p.id,
            description: p.description,
            amount: p.amount,
            currency: 'PEN',
            transactionDate: p.paidOn,
            deletedAt: p.deletedAt,
            people: [
              person(debt.debtorPersonId, 'Deudor'),
              person(debt.creditorPersonId, 'Acreedor'),
            ],
            morePeople: 0,
            parent: { kind: 'loan', id: debt.id, active: !debt.deletedAt },
            canRestore: !debt.deletedAt,
          }
        }),
    ].sort((a, b) => b.deletedAt.localeCompare(a.deletedAt))
  }
  await context.route('**/api/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname.slice(5)
    if (!url.pathname.startsWith('/api/')) return route.fallback()
    const known =
      path.startsWith('exports/') ||
      path === 'recycle-bin' ||
      path === 'data-management/people' ||
      path === `expenses/${ids.expense}/restore`
    if (!known) return route.fallback()
    state.requests.push({
      path,
      method: request.method(),
      query: Object.fromEntries(url.searchParams),
      csrf: request.headers()['x-csrf-token'],
    })
    const json = (body, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
      })
    if (!finance.authenticated) return json({}, 401)
    if (path === 'data-management/people')
      return json({
        data: finance.people,
        total: finance.people.length,
        page: 1,
        pageSize: 100,
      })
    if (path === 'recycle-bin') {
      if (state.failBin) {
        const status = state.failBin
        state.failBin = 0
        if (status === 401) finance.authenticated = false
        return json({}, status)
      }
      const query = url.searchParams,
        page = Number(query.get('page') || 1),
        pageSize = Number(query.get('pageSize') || 20)
      const data = rows().filter(
        (r) =>
          (!query.get('type') || r.kind === query.get('type')) &&
          (!query.get('deletedFrom') ||
            r.deletedAt.slice(0, 10) >= query.get('deletedFrom')) &&
          (!query.get('deletedTo') ||
            r.deletedAt.slice(0, 10) <= query.get('deletedTo')),
      )
      return json({
        data: data.slice((page - 1) * pageSize, page * pageSize),
        total: data.length,
        page,
        pageSize,
      })
    }
    if (path.startsWith('exports/')) {
      if (state.delayExport) {
        const ms = state.delayExport
        state.delayExport = 0
        await new Promise((resolve) => setTimeout(resolve, ms))
      }
      if (state.failExport) {
        const status = state.failExport
        state.failExport = 0
        return status === -1 ? route.abort() : json({}, status)
      }
      return route.fulfill({
        contentType: 'text/csv; charset=utf-8',
        headers: {
          'Content-Disposition':
            'attachment; filename="together-finance-consumos-ejemplo.csv"',
        },
        body:
          '\ufeff"Consumo ID","Importe","Lugar"\r\n"' +
          ids.expense +
          '","100.01","\t=1+2"\r\n',
      })
    }
    if (request.method() === 'POST' && path.endsWith('/restore')) {
      if (finance.rejectNextWrite) {
        const status = finance.rejectNextWrite
        finance.rejectNextWrite = 0
        return json({}, status)
      }
      if (request.headers()['x-csrf-token'] !== 'T'.repeat(43))
        return json({}, 403)
      state.expenseDeleted = false
      return json(exampleRecord())
    }
    return json({}, 404)
  })
  return state
}
