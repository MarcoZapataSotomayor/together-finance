export interface NamedRecord {
  id: string
  name: string
}
export interface PersonRecord extends NamedRecord {
  isActive: boolean
  notes: string | null
  createdAt: string
  updatedAt: string
}
export interface CategoryRecord extends NamedRecord {
  isActive: boolean
  description: string | null
  createdAt: string
  updatedAt: string
}
export type PaymentMethodType =
  'CASH' | 'BANK_TRANSFER' | 'CREDIT_CARD' | 'DEBIT_CARD' | 'OTHER'
export interface PaymentMethodRecord extends CategoryRecord {
  type: PaymentMethodType
  ownerPersonId: string | null
}
export interface References {
  people: PersonRecord[]
  categories: CategoryRecord[]
  methods: PaymentMethodRecord[]
}
export interface Page<T> {
  data: T[]
  total: number
  page: number
  pageSize: number
}
export interface ExpensePayload {
  amount: string
  purchasedOn: string
  merchant: string
  description: string | null
  categoryId: string
  paymentMethodId: string
  fundedByPersonId: string
  classification: 'PERSONAL' | 'SHARED'
  allocations: { personId: string; percentage: string }[]
}
export interface RepaymentRecord {
  id: string
  amount: string
  paidOn: string
  description: string | null
  active: boolean
  deletedAt: string | null
}
export interface ExpenseDebt {
  id: string
  origin: 'EXPENSE'
  debtorPersonId: string
  creditorPersonId: string
  currency: 'PEN'
  incurredOn: string
  originalAmount: string
  repaidAmount: string
  outstandingAmount: string
  status: 'OPEN' | 'PARTIALLY_REPAID' | 'PAID' | 'INACTIVE'
  deletedAt: string | null
  repayments: RepaymentRecord[]
}
export interface ExpenseRecord extends ExpensePayload {
  id: string
  currency: 'PEN'
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  category: NamedRecord
  paymentMethod: NamedRecord & {
    type: PaymentMethodType
    ownerPersonId: string | null
  }
  fundedBy: NamedRecord
  allocations: {
    id: string
    personId: string
    person: NamedRecord
    percentage: string
    amount: string
    active: boolean
    deletedAt: string | null
    debt: ExpenseDebt | null
  }[]
}
export interface ExpenseFilters {
  deletionState?: 'active' | 'deleted'
  purchasedFrom?: string
  purchasedTo?: string
  categoryId?: string
  beneficiaryPersonId?: string
  fundedByPersonId?: string
  classification?: '' | 'PERSONAL' | 'SHARED'
}
export const methodLabels: Record<PaymentMethodType, string> = {
  CASH: 'Efectivo',
  BANK_TRANSFER: 'Transferencia',
  CREDIT_CARD: 'Tarjeta de crédito',
  DEBIT_CARD: 'Tarjeta de débito',
  OTHER: 'Otro / billetera digital',
}
export const debtLabels: Record<ExpenseDebt['status'], string> = {
  OPEN: 'Pendiente',
  PARTIALLY_REPAID: 'Pago parcial',
  PAID: 'Pagado',
  INACTIVE: 'Inactivo',
}
export const emptyReferences: References = {
  people: [],
  categories: [],
  methods: [],
}
