import { randomUUID } from 'node:crypto'
import { references, exampleRecord } from '../finance-fixtures.mjs'
import {
  audit,
  debtIds as ids,
  debtPeople,
  debtRecord,
  emptyTotals,
  pageRecord,
} from '../debt-fixtures.mjs'

const units = (value) => BigInt(value.replace('.', ''))
const decimal = (value) =>
  `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`
const timestamp = '2026-11-01T12:00:00.000Z'
const totals = (rows) =>
  rows.reduce((sum, row) => {
    if (!row.active) {
      sum.inactiveCount++
      return sum
    }
    for (const field of ['originalAmount', 'repaidAmount', 'outstandingAmount'])
      sum[field] = decimal(units(sum[field]) + units(row[field]))
    sum.activeCount++
    if (row.status === 'PAID') sum.settledCount++
    else sum.pendingCount++
    return sum
  }, emptyTotals())

// Browser-only API double. Every /api request is intercepted before it reaches Vite's proxy.
export async function installDebtMock(context) {
  const state = {
    people: structuredClone(debtPeople),
    authenticated: true,
    requests: [],
    lostNextCreation: false,
    rejectNextWrite: 0,
    expireNextRead: false,
    delayNextSummary: 0,
    debts: [
      debtRecord(),
      debtRecord({
        id: ids.other,
        debtorPersonId: ids.marco,
        creditorPersonId: ids.antonella,
        debtor: debtPeople[1],
        creditor: debtPeople[0],
        originalAmount: '30.00',
        outstandingAmount: '30.00',
        description: 'Compromiso sintético inverso',
      }),
    ],
    payments: [],
  }
  function view(row) {
    const history = state.payments.filter(
      (payment) => payment.debtId === row.id,
    )
    const paid = row.deletedAt
      ? 0n
      : history
          .filter((payment) => !payment.deletedAt)
          .reduce((sum, payment) => sum + units(payment.amount), 0n)
    const active = !row.deletedAt
    const outstanding = active ? units(row.originalAmount) - paid : 0n
    const person = (id) => {
      const entry = state.people.find((person) => person.id === id)
      return { id, name: entry?.name ?? 'Persona histórica' }
    }
    return {
      ...row,
      debtor: person(row.debtorPersonId),
      creditor: person(row.creditorPersonId),
      active,
      repaidAmount: decimal(paid),
      outstandingAmount: decimal(outstanding),
      status: !active
        ? 'INACTIVE'
        : outstanding === 0n
          ? 'PAID'
          : paid
            ? 'PARTIALLY_REPAID'
            : 'OPEN',
      repayments: history.map((payment) => ({
        ...payment,
        active: active && !payment.deletedAt,
      })),
    }
  }
  function filter(query) {
    return state.debts
      .map(view)
      .filter(
        (row) =>
          ((query.get('deletionState') ?? 'active') === 'deleted'
            ? !row.active
            : row.active) &&
          (!query.get('origin') || row.origin === query.get('origin')) &&
          (!query.get('debtorPersonId') ||
            row.debtorPersonId === query.get('debtorPersonId')) &&
          (!query.get('creditorPersonId') ||
            row.creditorPersonId === query.get('creditorPersonId')) &&
          (!query.get('status') ||
            (query.get('status') === 'settled'
              ? row.status === 'PAID'
              : ['OPEN', 'PARTIALLY_REPAID'].includes(row.status))) &&
          (!query.get('incurredFrom') ||
            row.incurredOn >= query.get('incurredFrom')) &&
          (!query.get('incurredTo') ||
            row.incurredOn <= query.get('incurredTo')),
      )
      .sort((a, b) => a.id.localeCompare(b.id))
  }
  function summary(rows) {
    const participants = state.people.filter((person) =>
      rows.some(
        (row) =>
          row.debtorPersonId === person.id ||
          row.creditorPersonId === person.id,
      ),
    )
    const byPerson = participants.map((person) => ({
      person: { id: person.id, name: person.name },
      owed: totals(rows.filter((row) => row.debtorPersonId === person.id)),
      receivable: totals(
        rows.filter((row) => row.creditorPersonId === person.id),
      ),
    }))
    return {
      currency: 'PEN',
      totals: totals(rows),
      byOrigin: {
        EXPENSE: totals(rows.filter((row) => row.origin === 'EXPENSE')),
        LOAN: totals(rows.filter((row) => row.origin === 'LOAN')),
      },
      byPerson,
      byDebtor: byPerson
        .filter((row) => row.owed.activeCount || row.owed.inactiveCount)
        .map((row) => ({ person: row.person, ...row.owed })),
      byCreditor: byPerson
        .filter(
          (row) => row.receivable.activeCount || row.receivable.inactiveCount,
        )
        .map((row) => ({ person: row.person, ...row.receivable })),
    }
  }
  await context.route('**/api/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url())
    if (!url.pathname.startsWith('/api/')) return route.continue()
    const path = url.pathname.slice(5),
      method = request.method(),
      query = url.searchParams
    const write = method !== 'GET'
    const body = write ? request.postDataJSON() : null
    // Do not retain even synthetic login passwords in the diagnostic request collection.
    if (!path.startsWith('auth/'))
      state.requests.push({
        path,
        method,
        query: Object.fromEntries(query),
        body,
        csrf: request.headers()['x-csrf-token'],
      })
    const respond = (value, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(value),
      })
    if (path === 'auth/session')
      return respond({
        authenticated: state.authenticated,
        csrfToken: 'T'.repeat(43),
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      })
    if (path === 'auth/login') {
      state.authenticated = true
      return respond({
        authenticated: true,
        csrfToken: 'T'.repeat(43),
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      })
    }
    if (path === 'auth/logout') {
      state.authenticated = false
      return respond({
        authenticated: false,
        csrfToken: 'T'.repeat(43),
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      })
    }
    if (state.expireNextRead && !write) {
      state.expireNextRead = false
      state.authenticated = false
      return respond({}, 401)
    }
    if (!state.authenticated) return respond({}, 401)
    if (write && request.headers()['x-csrf-token'] !== 'T'.repeat(43))
      return respond({}, 403)
    if (write && state.rejectNextWrite) {
      const status = state.rejectNextWrite
      state.rejectNextWrite = 0
      if (status === 401) state.authenticated = false
      return respond({}, status)
    }
    if (path === 'people' && method === 'POST') {
      const person = {
        id: randomUUID(),
        name: body.name,
        isActive: true,
        notes: null,
        ...audit,
      }
      state.people.push(person)
      return respond(person, 201)
    }
    const reference = {
      people: state.people,
      categories: references.categories,
      'payment-methods': references.methods,
    }[path]
    if (reference && !write)
      return respond(
        pageRecord(
          reference,
          Number(query.get('page') || 1),
          Number(query.get('pageSize') || 100),
        ),
      )
    if (path === 'expenses' && !write) return respond(pageRecord([]))
    if (path.startsWith('expenses/') && !write) return respond(exampleRecord())
    if (path === 'debts/summary') {
      if (state.delayNextSummary) {
        const delay = state.delayNextSummary
        state.delayNextSummary = 0
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
      return respond(summary(filter(query)))
    }
    if (['debts', 'loans'].includes(path) && !write) {
      if (path === 'loans') query.set('origin', 'LOAN')
      const rows = filter(query),
        number = Number(query.get('page') || 1),
        size = Number(query.get('pageSize') || 20)
      return respond(
        pageRecord(
          rows.slice((number - 1) * size, number * size),
          number,
          size,
          rows.length,
        ),
      )
    }
    if (path === 'loans' && method === 'POST') {
      const existing = state.debts.find((row) => row.id === body.id)
      if (existing) {
        const same =
          !existing.deletedAt &&
          existing.debtorPersonId === body.debtorPersonId &&
          existing.creditorPersonId === body.creditorPersonId &&
          existing.originalAmount === body.amount &&
          existing.incurredOn === body.incurredOn &&
          existing.description === body.description &&
          existing.dueOn === body.dueOn
        return respond(same ? view(existing) : {}, same ? 201 : 409)
      }
      const row = debtRecord({
        ...body,
        originalAmount: body.amount,
        repayments: [],
      })
      delete row.amount
      state.debts.push(row)
      if (state.lostNextCreation) {
        state.lostNextCreation = false
        return route.abort('failed')
      }
      return respond(view(row), 201)
    }
    const debtPath =
      /^(?:debts|loans)\/([^/]+)(?:\/(repayments|restore))?$/.exec(path)
    if (debtPath) {
      const row = state.debts.find((row) => row.id === debtPath[1])
      if (!row || (path.startsWith('loans/') && row.origin !== 'LOAN'))
        return respond({}, 404)
      if (debtPath[2] === 'repayments') {
        if (!write) {
          const rows = view(row)
            .repayments.filter((payment) =>
              query.get('deletionState') === 'active'
                ? payment.active
                : query.get('deletionState') === 'deleted'
                  ? !payment.active
                  : true,
            )
            .sort(
              (a, b) =>
                b.paidOn.localeCompare(a.paidOn) || b.id.localeCompare(a.id),
            )
          const number = Number(query.get('page') || 1),
            size = Number(query.get('pageSize') || 20)
          return respond(
            pageRecord(
              rows.slice((number - 1) * size, number * size),
              number,
              size,
              rows.length,
            ),
          )
        }
        const existing = state.payments.find(
          (payment) => payment.id === body.id,
        )
        if (existing) {
          const same =
            !existing.deletedAt &&
            !row.deletedAt &&
            existing.debtId === row.id &&
            existing.amount === body.amount &&
            existing.paidOn === body.paidOn &&
            existing.description === body.description
          return respond(
            same ? { ...existing, active: true } : {},
            same ? 201 : 409,
          )
        }
        if (
          row.deletedAt ||
          units(body.amount) > units(view(row).outstandingAmount)
        )
          return respond({}, 409)
        const payment = {
          ...body,
          debtId: row.id,
          currency: 'PEN',
          active: true,
          deletedAt: null,
          ...audit,
        }
        state.payments.push(payment)
        if (state.lostNextCreation) {
          state.lostNextCreation = false
          return route.abort('failed')
        }
        return respond(payment, 201)
      }
      if (method === 'PATCH') {
        if (
          state.payments.some((payment) => payment.debtId === row.id) &&
          ['amount', 'debtorPersonId', 'creditorPersonId', 'incurredOn'].some(
            (key) => Object.hasOwn(body, key),
          )
        )
          return respond({}, 409)
        Object.assign(row, body)
        if (body.amount) {
          row.originalAmount = body.amount
          delete row.amount
        }
      }
      if (method === 'DELETE') {
        row.deletedAt = timestamp
        return route.fulfill({ status: 204 })
      }
      if (debtPath[2] === 'restore') row.deletedAt = null
      return respond(view(row))
    }
    const paymentPath = /^repayments\/([^/]+)(?:\/(restore))?$/.exec(path)
    if (paymentPath) {
      const payment = state.payments.find((row) => row.id === paymentPath[1])
      if (!payment) return respond({}, 404)
      const debt = state.debts.find((row) => row.id === payment.debtId)
      if (method === 'DELETE') {
        payment.deletedAt = timestamp
        return route.fulfill({ status: 204 })
      }
      if (paymentPath[2]) {
        if (
          debt.deletedAt ||
          (payment.deletedAt &&
            units(payment.amount) > units(view(debt).outstandingAmount))
        )
          return respond({}, 409)
        payment.deletedAt = null
      }
      const { repayments: _history, ...debtView } = view(debt)
      const result = {
        ...payment,
        active: !payment.deletedAt && !debt.deletedAt,
      }
      return respond(paymentPath[2] ? result : { ...result, debt: debtView })
    }
    return respond({}, 404)
  })
  return state
}
