export type Person = 'antonella' | 'marco'
export type PaymentKind = 'card' | 'cash' | 'transfer' | 'wallet'
export interface PaymentMethod { id: string; label: string; kind: PaymentKind }

export interface ExpenseValues {
  place: string
  amount: string
  date: string
  description: string
  category: string
  paymentMethodId: string
  cardType: '' | 'credit' | 'debit'
  payer: '' | Person
  expenseType: '' | 'personal' | 'shared'
  owner: '' | Person
  splitMode: '' | 'equal' | 'custom'
  antonellaPercentage: string
  marcoPercentage: string
}

export type ExpenseErrors = Partial<Record<keyof ExpenseValues | 'allocation', string>>

export const initialPaymentMethods: PaymentMethod[] = [
  { id: 'card', label: 'Tarjeta', kind: 'card' },
  { id: 'cash', label: 'Efectivo', kind: 'cash' },
  { id: 'transfer', label: 'Transferencia', kind: 'transfer' },
  { id: 'wallet', label: 'Yape / Plin', kind: 'wallet' },
]

export const categories = ['Supermercado', 'Comida y bebidas', 'Transporte', 'Hogar', 'Salud', 'Ocio', 'Otros']
export const personLabels: Record<Person, string> = { antonella: 'Antonella', marco: 'Marco' }
export const penFormatter = new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' })

export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function createInitialValues(): ExpenseValues {
  return {
    place: '', amount: '', date: localDate(), description: '', category: '',
    paymentMethodId: '', cardType: '', payer: '', expenseType: '', owner: '',
    splitMode: '', antonellaPercentage: '', marcoPercentage: '',
  }
}

export function amountInCents(value: string): number | null {
  const normalized = value.trim().replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null
  const [whole, fraction = ''] = normalized.split('.')
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(cents) && cents > 0 && cents <= 9999999999 ? cents : null
}

function percentage(value: string): number | null {
  const normalized = value.trim().replace(',', '.')
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(normalized)) return null
  const result = Number(normalized)
  return result >= 0 && result <= 100 ? result : null
}

export function allocationInCents(values: ExpenseValues): Record<Person, number> | null {
  const amount = amountInCents(values.amount)
  if (amount === null) return null
  if (values.expenseType === 'personal' && values.owner) {
    return { antonella: values.owner === 'antonella' ? amount : 0, marco: values.owner === 'marco' ? amount : 0 }
  }
  if (values.expenseType !== 'shared' || !values.splitMode) return null
  const antonella = values.splitMode === 'equal' ? 50 : percentage(values.antonellaPercentage)
  const marco = values.splitMode === 'equal' ? 50 : percentage(values.marcoPercentage)
  if (antonella === null || marco === null || Math.abs(antonella + marco - 100) > .00001) return null
  const antonellaCents = Math.round(amount * antonella / 100)
  // Allocate the remaining cents to keep the total exact, including odd cents.
  return { antonella: antonellaCents, marco: amount - antonellaCents }
}

export function validateExpense(values: ExpenseValues, methods: PaymentMethod[]): ExpenseErrors {
  const errors: ExpenseErrors = {}
  if (values.place.trim().length < 2 || values.place.trim().length > 80) errors.place = 'Escribe un lugar de compra de 2 a 80 caracteres.'
  if (amountInCents(values.amount) === null) errors.amount = 'Ingresa un monto entre S/ 0.01 y S/ 99,999,999.99, con hasta 2 decimales.'
  const date = new Date(`${values.date}T12:00:00`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.date) || !Number.isFinite(date.getTime()) || localDate(date) !== values.date) errors.date = 'Selecciona una fecha válida.'
  if (values.description.trim().length > 240) errors.description = 'Usa un máximo de 240 caracteres.'
  if (!categories.includes(values.category)) errors.category = 'Selecciona una categoría.'
  const method = methods.find(item => item.id === values.paymentMethodId)
  if (!method) errors.paymentMethodId = 'Selecciona un medio de pago.'
  if (method?.kind === 'card' && !['credit', 'debit'].includes(values.cardType)) errors.cardType = 'Elige crédito o débito.'
  if (!Object.hasOwn(personLabels, values.payer)) errors.payer = 'Selecciona quién aporta el dinero.'
  if (!['personal', 'shared'].includes(values.expenseType)) errors.expenseType = 'Elige si el consumo es personal o compartido.'
  if (values.expenseType === 'personal' && !Object.hasOwn(personLabels, values.owner)) errors.owner = 'Selecciona a quién pertenece el consumo.'
  if (values.expenseType === 'shared') {
    if (!['equal', 'custom'].includes(values.splitMode)) errors.splitMode = 'Elige cómo dividir el consumo.'
    if (values.splitMode === 'custom') {
      const antonella = percentage(values.antonellaPercentage)
      const marco = percentage(values.marcoPercentage)
      if (antonella === null) errors.antonellaPercentage = 'Usa un porcentaje entre 0 y 100.'
      if (marco === null) errors.marcoPercentage = 'Usa un porcentaje entre 0 y 100.'
      if (antonella !== null && marco !== null && Math.abs(antonella + marco - 100) > .00001) errors.allocation = 'Los dos porcentajes deben sumar 100 %.'
    }
  }
  return errors
}
