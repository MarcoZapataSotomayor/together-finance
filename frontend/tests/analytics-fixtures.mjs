import { debtPeople, debtIds } from './debt-fixtures.mjs'
export const analyticsIds = {
  ...debtIds,
  category: '00000000-0000-4000-8000-000000000010',
}
export const spendingTotals = (overrides = {}) => ({
  amount: '0.00',
  personalAmount: '0.00',
  sharedAmount: '0.00',
  expenseCount: 0,
  fundedAmount: '0.00',
  fundedExpenseCount: 0,
  ...overrides,
})
export function spendingReport(
  filters = { from: '2026-11-01', to: '2026-11-30' },
  overrides = {},
) {
  return {
    currency: 'PEN',
    period: { from: filters.from, to: filters.to },
    basis: filters.personId ? 'ALLOCATION' : 'EXPENSE_TOTAL',
    person: filters.personId
      ? debtPeople.find((row) => row.id === filters.personId)
      : null,
    people: debtPeople.map(({ id, name, isActive }) => ({
      id,
      name,
      isActive,
    })),
    totals: spendingTotals(),
    monthly: [{ month: filters.from.slice(0, 7), ...spendingTotals() }],
    categories: [],
    byPerson: [],
    recentExpenses: [],
    ...overrides,
  }
}
