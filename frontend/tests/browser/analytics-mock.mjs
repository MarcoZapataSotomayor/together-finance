import { randomUUID } from 'node:crypto'
import { AnalyticsService } from '../../../backend/dist/analytics/analytics.service.js'
import { Prisma } from '../../../backend/dist/generated/prisma/client.js'
import { installDebtMock } from './debt-mock.mjs'
import { analyticsIds as ids } from '../analytics-fixtures.mjs'
import {
  monthRange,
  trendRange,
} from '../../src/features/dashboard/dashboardModel.ts'

// Executes the built production analytics service against a read-only synthetic adapter.
// No PrismaService, database connection, credential or environment file is instantiated.
export async function installAnalyticsMock(context, month) {
  const finance = await installDebtMock(context)
  const current = monthRange(month),
    trend = trendRange(current)
  const category = (id, name) => ({ id, name })
  const categories = [
    category(ids.category, 'Alimentación'),
    category('00000000-0000-4000-8000-000000000011', 'Transporte'),
    category('00000000-0000-4000-8000-000000000012', 'Hogar'),
  ]
  const person = (id) => {
    const row = finance.people.find((person) => person.id === id)
    return { id, name: row.name }
  }
  function expense(
    amount,
    shares,
    funder,
    category,
    purchasedOn,
    merchant,
    deletedAt = null,
  ) {
    return {
      id: randomUUID(),
      amount: new Prisma.Decimal(amount),
      currency: 'PEN',
      purchasedOn: new Date(`${purchasedOn}T00:00:00Z`),
      merchant,
      classification: shares.length === 1 ? 'PERSONAL' : 'SHARED',
      deletedAt,
      category,
      fundedByPersonId: funder,
      fundedBy: person(funder),
      allocations: shares.map(([id, amount]) => ({
        personId: id,
        person: person(id),
        amount: new Prisma.Decimal(amount),
        percentage: new Prisma.Decimal(shares.length === 1 ? '100' : '50'),
        deletedAt: null,
      })),
    }
  }
  const state = {
    finance,
    fail: 0,
    expireNext: false,
    delayUntil: 0,
    reads: [],
    rows: [
      expense(
        '100.01',
        [
          [ids.antonella, '50.01'],
          [ids.marco, '50.00'],
        ],
        ids.marco,
        categories[0],
        current.from,
        'Compra compartida sintética',
      ),
      expense(
        '20.00',
        [[ids.antonella, '20.00']],
        ids.relative,
        categories[1],
        current.from,
        'Traslado sintético',
      ),
      expense(
        '40.00',
        [[ids.marco, '40.00']],
        ids.antonella,
        categories[2],
        current.from,
        'Compra personal sintética',
      ),
      expense(
        '60.00',
        [
          [ids.antonella, '30.00'],
          [ids.marco, '30.00'],
        ],
        ids.marco,
        categories[0],
        trend.from,
        'Compra histórica sintética',
      ),
      expense(
        '900.00',
        [[ids.antonella, '900.00']],
        ids.marco,
        categories[0],
        current.from,
        'Registro eliminado sintético',
        new Date(),
      ),
    ],
  }
  const adapter = {
    person: {
      findMany: async () =>
        finance.people.map(({ id, name, isActive }) => ({
          id,
          name,
          isActive,
        })),
    },
    expense: {
      findMany: async ({ where, skip, take }) =>
        state.rows
          .filter(
            (row) =>
              !row.deletedAt &&
              row.purchasedOn >= where.purchasedOn.gte &&
              row.purchasedOn <= where.purchasedOn.lte,
          )
          .sort(
            (a, b) =>
              b.purchasedOn.getTime() - a.purchasedOn.getTime() ||
              b.id.localeCompare(a.id),
          )
          .slice(skip, skip + take),
    },
    $transaction: async (work) => work(adapter),
  }
  const service = new AnalyticsService(adapter)
  await context.route('**/api/analytics/**', async (route) => {
    const url = new URL(route.request().url())
    if (!url.pathname.startsWith('/api/analytics/')) return route.fallback()
    state.reads.push(Object.fromEntries(url.searchParams))
    const respond = (value, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(value),
      })
    if (state.expireNext) {
      state.expireNext = false
      finance.authenticated = false
    }
    if (!finance.authenticated) return respond({}, 401)
    if (state.delayUntil > Date.now())
      await new Promise((resolve) =>
        setTimeout(resolve, state.delayUntil - Date.now()),
      )
    if (state.fail) return respond({}, state.fail)
    try {
      return respond(
        await service.spending(Object.fromEntries(url.searchParams)),
      )
    } catch (error) {
      return respond(
        { message: 'Synthetic analytics failure' },
        typeof error.getStatus === 'function' ? error.getStatus() : 500,
      )
    }
  })
  return state
}
