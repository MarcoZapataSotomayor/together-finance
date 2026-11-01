// Synthetic API-shaped fixtures. They are never sent to a live financial database.
export const debtIds = {
  antonella: '00000000-0000-4000-8000-000000000001',
  marco: '00000000-0000-4000-8000-000000000002',
  relative: '00000000-0000-4000-8000-000000000003',
  loan: '00000000-0000-4000-8000-000000000040',
  other: '00000000-0000-4000-8000-000000000041',
  payment: '00000000-0000-4000-8000-000000000050',
  expense: '00000000-0000-4000-8000-000000000030',
  allocation: '00000000-0000-4000-8000-000000000060',
}
export const audit = {
  createdAt: '2026-10-31T12:00:00.000Z',
  updatedAt: '2026-10-31T12:00:00.000Z',
}
export const debtPeople = [
  { id: debtIds.antonella, name: 'Antonella' },
  { id: debtIds.marco, name: 'Marco' },
  { id: debtIds.relative, name: 'Familiar de ejemplo' },
].map((row) => ({ ...row, isActive: true, notes: null, ...audit }))
export function loanInput(overrides = {}) {
  return {
    debtorPersonId: debtIds.antonella,
    creditorPersonId: debtIds.marco,
    amount: '100.00',
    incurredOn: '2026-10-30',
    dueOn: null,
    description: 'Préstamo sintético',
    ...overrides,
  }
}
export function paymentInput(overrides = {}) {
  return {
    amount: '30.00',
    paidOn: '2026-10-31',
    description: 'Pago sintético',
    ...overrides,
  }
}
export function paymentRecord(overrides = {}) {
  return {
    ...paymentInput(),
    id: debtIds.payment,
    debtId: debtIds.loan,
    currency: 'PEN',
    active: true,
    deletedAt: null,
    ...audit,
    ...overrides,
  }
}
export function debtRecord(overrides = {}) {
  const input = loanInput()
  return {
    id: debtIds.loan,
    origin: 'LOAN',
    currency: 'PEN',
    debtorPersonId: input.debtorPersonId,
    creditorPersonId: input.creditorPersonId,
    debtor: { id: debtPeople[0].id, name: debtPeople[0].name },
    creditor: { id: debtPeople[1].id, name: debtPeople[1].name },
    originalAmount: input.amount,
    repaidAmount: '0.00',
    outstandingAmount: input.amount,
    incurredOn: input.incurredOn,
    dueOn: input.dueOn,
    description: input.description,
    status: 'OPEN',
    active: true,
    deletedAt: null,
    source: null,
    expenseAllocationId: null,
    repayments: [],
    ...audit,
    ...overrides,
  }
}
export function emptyTotals(overrides = {}) {
  return {
    originalAmount: '0.00',
    repaidAmount: '0.00',
    outstandingAmount: '0.00',
    activeCount: 0,
    pendingCount: 0,
    settledCount: 0,
    inactiveCount: 0,
    ...overrides,
  }
}
export function summaryRecord(overrides = {}) {
  return {
    currency: 'PEN',
    totals: emptyTotals(),
    byOrigin: { EXPENSE: emptyTotals(), LOAN: emptyTotals() },
    byPerson: [],
    byDebtor: [],
    byCreditor: [],
    ...overrides,
  }
}
export const pageRecord = (
  data,
  page = 1,
  pageSize = 20,
  total = data.length,
) => ({ data, total, page, pageSize })
