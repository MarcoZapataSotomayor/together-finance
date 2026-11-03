import { ApiError, apiRead, apiRequest } from './client.ts'
import { uuidPattern } from './finance.ts'
import type { NamedRecord, Page } from './types.ts'

export type DebtStatus = 'OPEN' | 'PARTIALLY_REPAID' | 'PAID' | 'INACTIVE'
export interface DebtFilters {
  debtorPersonId?: string
  creditorPersonId?: string
  origin?: 'EXPENSE' | 'LOAN'
  status?: 'pending' | 'settled'
  deletionState?: 'active' | 'deleted'
  incurredFrom?: string
  incurredTo?: string
}
export interface LoanPayload {
  debtorPersonId: string
  creditorPersonId: string
  amount: string
  incurredOn: string
  dueOn: string | null
  description: string | null
}
export interface RepaymentPayload {
  amount: string
  paidOn: string
  description: string | null
}
export interface DebtRepayment extends RepaymentPayload {
  id: string
  debtId: string
  currency: 'PEN'
  active: boolean
  deletedAt: string | null
  createdAt: string
  updatedAt: string
}
export interface DebtRecord {
  id: string
  origin: 'EXPENSE' | 'LOAN'
  currency: 'PEN'
  debtorPersonId: string
  creditorPersonId: string
  debtor: NamedRecord
  creditor: NamedRecord
  originalAmount: string
  repaidAmount: string
  outstandingAmount: string
  status: DebtStatus
  active: boolean
  incurredOn: string
  dueOn: string | null
  description: string | null
  expenseAllocationId: string | null
  source: {
    allocationId: string
    expenseId: string
    merchant: string
    purchasedOn: string
    allocationDeletedAt: string | null
    expenseDeletedAt: string | null
  } | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  repayments: DebtRepayment[]
}
export interface RepaymentDetail extends DebtRepayment {
  debt: Omit<DebtRecord, 'repayments'>
}
export interface DebtTotals {
  originalAmount: string
  repaidAmount: string
  outstandingAmount: string
  activeCount: number
  pendingCount: number
  settledCount: number
  inactiveCount: number
}
export interface DebtSummary {
  currency: 'PEN'
  totals: DebtTotals
  byOrigin: Record<'EXPENSE' | 'LOAN', DebtTotals>
  byPerson: { person: NamedRecord; owed: DebtTotals; receivable: DebtTotals }[]
  byDebtor: (DebtTotals & { person: NamedRecord })[]
  byCreditor: (DebtTotals & { person: NamedRecord })[]
}

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const identifier = (value: unknown): value is string =>
  typeof value === 'string' && uuidPattern.test(value)
const decimal = (value: unknown): value is string =>
  typeof value === 'string' && /^\d+\.\d{2}$/.test(value)
const date = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
const nullableDate = (value: unknown) =>
  value === null || typeof value === 'string'
const named = (value: unknown) =>
  object(value) && identifier(value.id) && typeof value.name === 'string'
function repayment(value: unknown): value is DebtRepayment {
  return (
    object(value) &&
    identifier(value.id) &&
    identifier(value.debtId) &&
    decimal(value.amount) &&
    date(value.paidOn) &&
    (value.description === null || typeof value.description === 'string') &&
    value.currency === 'PEN' &&
    typeof value.active === 'boolean' &&
    nullableDate(value.deletedAt) &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string'
  )
}
function debt(value: unknown, history = true): value is DebtRecord {
  return (
    object(value) &&
    identifier(value.id) &&
    ['EXPENSE', 'LOAN'].includes(String(value.origin)) &&
    value.currency === 'PEN' &&
    named(value.debtor) &&
    named(value.creditor) &&
    object(value.debtor) &&
    value.debtor.id === value.debtorPersonId &&
    object(value.creditor) &&
    value.creditor.id === value.creditorPersonId &&
    decimal(value.originalAmount) &&
    decimal(value.repaidAmount) &&
    decimal(value.outstandingAmount) &&
    ['OPEN', 'PARTIALLY_REPAID', 'PAID', 'INACTIVE'].includes(
      String(value.status),
    ) &&
    typeof value.active === 'boolean' &&
    date(value.incurredOn) &&
    (value.dueOn === null || date(value.dueOn)) &&
    (value.description === null || typeof value.description === 'string') &&
    nullableDate(value.deletedAt) &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string' &&
    (value.origin === 'LOAN'
      ? value.source === null && value.expenseAllocationId === null
      : object(value.source) &&
        identifier(value.source.expenseId) &&
        identifier(value.source.allocationId) &&
        value.source.allocationId === value.expenseAllocationId &&
        typeof value.source.merchant === 'string' &&
        date(value.source.purchasedOn) &&
        nullableDate(value.source.allocationDeletedAt) &&
        nullableDate(value.source.expenseDeletedAt)) &&
    (!history ||
      (Array.isArray(value.repayments) &&
        value.repayments.every(
          (row) => repayment(row) && row.debtId === value.id,
        )))
  )
}
function totals(value: unknown): value is DebtTotals {
  return (
    object(value) &&
    ['originalAmount', 'repaidAmount', 'outstandingAmount'].every((key) =>
      decimal(value[key]),
    ) &&
    ['activeCount', 'pendingCount', 'settledCount', 'inactiveCount'].every(
      (key) => Number.isSafeInteger(value[key]) && Number(value[key]) >= 0,
    )
  )
}
function summary(value: unknown): value is DebtSummary {
  return (
    object(value) &&
    value.currency === 'PEN' &&
    totals(value.totals) &&
    object(value.byOrigin) &&
    totals(value.byOrigin.EXPENSE) &&
    totals(value.byOrigin.LOAN) &&
    Array.isArray(value.byPerson) &&
    value.byPerson.every(
      (row) =>
        object(row) &&
        named(row.person) &&
        totals(row.owed) &&
        totals(row.receivable),
    ) &&
    ['byDebtor', 'byCreditor'].every(
      (key) =>
        Array.isArray(value[key]) &&
        value[key].every(
          (row) => object(row) && named(row.person) && totals(row),
        ),
    )
  )
}
function checked<T>(value: unknown, valid: (value: unknown) => value is T): T {
  if (!valid(value)) throw new ApiError(502)
  return value
}
function checkedId<T extends { id: string }>(
  value: unknown,
  valid: (value: unknown) => value is T,
  id: string,
): T {
  const result = checked(value, valid)
  if (result.id !== id.toLowerCase()) throw new ApiError(502)
  return result
}
function page<T>(
  value: unknown,
  valid: (value: unknown) => value is T,
): Page<T> {
  if (
    !object(value) ||
    !Array.isArray(value.data) ||
    !value.data.every(valid) ||
    !Number.isSafeInteger(value.total) ||
    Number(value.total) < 0 ||
    !Number.isSafeInteger(value.page) ||
    Number(value.page) < 1 ||
    !Number.isSafeInteger(value.pageSize) ||
    Number(value.pageSize) < 1 ||
    Number(value.pageSize) > 100
  )
    throw new ApiError(502)
  return value as unknown as Page<T>
}
function query(filters: object, number?: number, pageSize?: number) {
  const values = new URLSearchParams()
  for (const [key, value] of Object.entries(filters))
    if (value) values.set(key, value)
  if (number !== undefined) values.set('page', String(number))
  if (pageSize !== undefined) values.set('pageSize', String(pageSize))
  return values.toString()
}

export function createDebtApi(
  baseUrl: string,
  csrfToken: string,
  onUnauthorized: () => void,
  fetcher: typeof fetch = fetch,
) {
  async function guard<T>(work: () => Promise<T>) {
    try {
      return await work()
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) onUnauthorized()
      throw error
    }
  }
  const read = (path: string, signal?: AbortSignal) =>
    guard(() => apiRead<unknown>(baseUrl, path, signal, fetcher))
  const mutate = (
    path: string,
    method: 'POST' | 'PATCH' | 'DELETE',
    body: unknown,
  ) =>
    guard(() =>
      apiRequest<unknown>(baseUrl, path, { method, body, csrfToken }, fetcher),
    )
  return {
    list: async (
      filters: DebtFilters,
      number = 1,
      pageSize = 20,
      signal?: AbortSignal,
      loansOnly = false,
    ) =>
      page(
        await read(
          `${loansOnly ? 'loans' : 'debts'}?${query(filters, number, pageSize)}`,
          signal,
        ),
        debt,
      ),
    summary: async (filters: DebtFilters, signal?: AbortSignal) =>
      checked(await read(`debts/summary?${query(filters)}`, signal), summary),
    get: async (id: string, signal?: AbortSignal, loanOnly = false) =>
      checkedId(
        await read(
          `${loanOnly ? 'loans' : 'debts'}/${encodeURIComponent(id)}`,
          signal,
        ),
        debt,
        id,
      ),
    createLoan: async (id: string, input: LoanPayload) =>
      checkedId(await mutate('loans', 'POST', { ...input, id }), debt, id),
    updateLoan: async (id: string, input: Partial<LoanPayload>) =>
      checkedId(
        await mutate(`loans/${encodeURIComponent(id)}`, 'PATCH', input),
        debt,
        id,
      ),
    deleteLoan: async (id: string) => {
      await mutate(`loans/${encodeURIComponent(id)}`, 'DELETE', {})
    },
    restoreLoan: async (id: string) =>
      checkedId(
        await mutate(`loans/${encodeURIComponent(id)}/restore`, 'POST', {}),
        debt,
        id,
      ),
    repayments: async (
      id: string,
      deletionState: 'all' | 'active' | 'deleted' = 'all',
      number = 1,
      pageSize = 20,
      signal?: AbortSignal,
    ) =>
      page(
        await read(
          `debts/${encodeURIComponent(id)}/repayments?${query({ deletionState }, number, pageSize)}`,
          signal,
        ),
        repayment,
      ),
    getRepayment: async (id: string, signal?: AbortSignal) =>
      checked(
        await read(`repayments/${encodeURIComponent(id)}`, signal),
        (value): value is RepaymentDetail =>
          repayment(value) &&
          object(value) &&
          debt(value.debt, false) &&
          value.debt.id === value.debtId &&
          value.id === id.toLowerCase(),
      ),
    createRepayment: async (
      debtId: string,
      id: string,
      input: RepaymentPayload,
    ) =>
      checkedId(
        await mutate(`debts/${encodeURIComponent(debtId)}/repayments`, 'POST', {
          ...input,
          id,
        }),
        (value): value is DebtRepayment =>
          repayment(value) && value.debtId === debtId.toLowerCase(),
        id,
      ),
    deleteRepayment: async (id: string) => {
      await mutate(`repayments/${encodeURIComponent(id)}`, 'DELETE', {})
    },
    restoreRepayment: async (id: string) =>
      checkedId(
        await mutate(
          `repayments/${encodeURIComponent(id)}/restore`,
          'POST',
          {},
        ),
        repayment,
        id,
      ),
  }
}
export type DebtApi = ReturnType<typeof createDebtApi>
