import { ApiError, apiRead } from './client.ts'
import { uuidPattern } from './finance.ts'
import type { NamedRecord } from './types.ts'

export interface SpendingFilters {
  from: string
  to: string
  personId?: string
}
export interface SpendingTotals {
  amount: string
  personalAmount: string
  sharedAmount: string
  expenseCount: number
  fundedAmount: string
  fundedExpenseCount: number
}
export interface SpendingReport {
  currency: 'PEN'
  period: { from: string; to: string }
  basis: 'ALLOCATION' | 'EXPENSE_TOTAL'
  person: NamedRecord | null
  people: (NamedRecord & { isActive: boolean })[]
  totals: SpendingTotals
  monthly: (SpendingTotals & { month: string })[]
  categories: { category: NamedRecord; amount: string; expenseCount: number }[]
  byPerson: {
    person: NamedRecord
    allocatedAmount: string
    fundedAmount: string
  }[]
  recentExpenses: {
    id: string
    merchant: string
    purchasedOn: string
    classification: 'PERSONAL' | 'SHARED'
    category: NamedRecord
    fundedBy: NamedRecord
    expenseAmount: string
    attributedAmount: string
  }[]
}
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const amount = (value: unknown) =>
  typeof value === 'string' && /^\d+\.\d{2}$/.test(value)
const named = (value: unknown) =>
  object(value) &&
  typeof value.id === 'string' &&
  uuidPattern.test(value.id) &&
  typeof value.name === 'string'
const count = (value: unknown) =>
  Number.isSafeInteger(value) && Number(value) >= 0
function totals(value: unknown): boolean {
  return (
    object(value) &&
    ['amount', 'personalAmount', 'sharedAmount', 'fundedAmount'].every((key) =>
      amount(value[key]),
    ) &&
    count(value.expenseCount) &&
    count(value.fundedExpenseCount)
  )
}
export function isSpendingReport(value: unknown): value is SpendingReport {
  return (
    object(value) &&
    value.currency === 'PEN' &&
    object(value.period) &&
    typeof value.period.from === 'string' &&
    typeof value.period.to === 'string' &&
    ['ALLOCATION', 'EXPENSE_TOTAL'].includes(String(value.basis)) &&
    (value.person === null || named(value.person)) &&
    Array.isArray(value.people) &&
    value.people.every(
      (row) => named(row) && object(row) && typeof row.isActive === 'boolean',
    ) &&
    totals(value.totals) &&
    Array.isArray(value.monthly) &&
    value.monthly.length >= 1 &&
    value.monthly.length <= 24 &&
    value.monthly.every(
      (row) =>
        object(row) &&
        totals(row) &&
        typeof row.month === 'string' &&
        /^\d{4}-\d{2}$/.test(row.month),
    ) &&
    Array.isArray(value.categories) &&
    value.categories.every(
      (row) =>
        object(row) &&
        named(row.category) &&
        amount(row.amount) &&
        count(row.expenseCount),
    ) &&
    Array.isArray(value.byPerson) &&
    value.byPerson.every(
      (row) =>
        object(row) &&
        named(row.person) &&
        amount(row.allocatedAmount) &&
        amount(row.fundedAmount),
    ) &&
    Array.isArray(value.recentExpenses) &&
    value.recentExpenses.length <= 5 &&
    value.recentExpenses.every(
      (row) =>
        object(row) &&
        typeof row.id === 'string' &&
        uuidPattern.test(row.id) &&
        typeof row.merchant === 'string' &&
        typeof row.purchasedOn === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(row.purchasedOn) &&
        ['PERSONAL', 'SHARED'].includes(String(row.classification)) &&
        named(row.category) &&
        named(row.fundedBy) &&
        amount(row.expenseAmount) &&
        amount(row.attributedAmount),
    )
  )
}
export function createAnalyticsApi(
  baseUrl: string,
  onUnauthorized: () => void,
  fetcher: typeof fetch = fetch,
) {
  return {
    async spending(
      filters: SpendingFilters,
      signal?: AbortSignal,
    ): Promise<SpendingReport> {
      const query = new URLSearchParams({ from: filters.from, to: filters.to })
      if (filters.personId) query.set('personId', filters.personId)
      try {
        const value = await apiRead<unknown>(
          baseUrl,
          `analytics/spending?${query}`,
          signal,
          fetcher,
        )
        if (
          !isSpendingReport(value) ||
          value.period.from !== filters.from ||
          value.period.to !== filters.to ||
          (filters.personId
            ? value.person?.id !== filters.personId ||
              value.basis !== 'ALLOCATION'
            : value.person !== null || value.basis !== 'EXPENSE_TOTAL')
        )
          throw new ApiError(502)
        return value
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) onUnauthorized()
        throw error
      }
    },
  }
}
export type AnalyticsApi = ReturnType<typeof createAnalyticsApi>
