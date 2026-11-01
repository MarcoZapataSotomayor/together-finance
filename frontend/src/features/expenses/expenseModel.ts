import type {
  ExpensePayload,
  ExpenseRecord,
  References,
} from '../../api/types.ts'

export interface ExpenseValues {
  place: string
  amount: string
  date: string
  description: string
  category: string
  paymentMethodId: string
  payer: string
  expenseType: '' | 'personal' | 'shared'
  owner: string
  splitMode: '' | 'equal' | 'custom'
  shares: { personId: string; percentage: string }[]
}
export type ExpenseErrors = Partial<
  Record<keyof ExpenseValues | 'allocation', string>
>
export const penFormatter = new Intl.NumberFormat('es-PE', {
  style: 'currency',
  currency: 'PEN',
})
export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
export function createInitialValues(): ExpenseValues {
  return {
    place: '',
    amount: '',
    date: localDate(),
    description: '',
    category: '',
    paymentMethodId: '',
    payer: '',
    expenseType: '',
    owner: '',
    splitMode: '',
    shares: [
      { personId: '', percentage: '' },
      { personId: '', percentage: '' },
    ],
  }
}
export function valuesFromExpense(expense: ExpenseRecord): ExpenseValues {
  const shares = expense.allocations
    .filter((row) => row.active)
    .map((row) => ({ personId: row.personId, percentage: row.percentage }))
  return {
    place: expense.merchant,
    amount: expense.amount,
    date: expense.purchasedOn,
    description: expense.description ?? '',
    category: expense.categoryId,
    paymentMethodId: expense.paymentMethodId,
    payer: expense.fundedByPersonId,
    expenseType: expense.classification === 'PERSONAL' ? 'personal' : 'shared',
    owner:
      expense.classification === 'PERSONAL' ? (shares[0]?.personId ?? '') : '',
    splitMode:
      shares.length === 2 &&
      shares.every((row) => percentageUnits(row.percentage) === 500000n)
        ? 'equal'
        : 'custom',
    shares:
      expense.classification === 'PERSONAL'
        ? createInitialValues().shares
        : shares,
  }
}
export function amountInCents(value: string): number | null {
  const normalized = value.trim().replace(',', '.')
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(normalized)) return null
  const [whole, fraction = ''] = normalized.split('.')
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
  return cents > 0n && cents <= 99999999999999n ? Number(cents) : null
}
export function percentageUnits(value: string): bigint | null {
  const normalized = value.trim().replace(',', '.')
  if (!/^\d{1,3}(\.\d{1,4})?$/.test(normalized)) return null
  const [whole, fraction = ''] = normalized.split('.')
  const units = BigInt(whole) * 10000n + BigInt(fraction.padEnd(4, '0'))
  return units > 0n && units <= 1000000n ? units : null
}
export function declaredShares(
  values: ExpenseValues,
): { personId: string; percentage: string }[] {
  if (values.expenseType === 'personal')
    return [{ personId: values.owner, percentage: '100' }]
  return values.shares.map((row) => ({
    personId: row.personId,
    percentage:
      values.splitMode === 'equal'
        ? '50'
        : row.percentage.trim().replace(',', '.'),
  }))
}
export function allocationInCents(
  values: ExpenseValues,
): { personId: string; cents: number }[] | null {
  const amount = amountInCents(values.amount)
  if (
    amount === null ||
    !values.expenseType ||
    (values.expenseType === 'shared' && !values.splitMode)
  )
    return null
  const shares = declaredShares(values)
  if (
    shares.some((row) => !row.personId) ||
    new Set(shares.map((row) => row.personId)).size !== shares.length ||
    (values.expenseType === 'shared' &&
      (shares.length < 2 ||
        shares.length > 20 ||
        (values.splitMode === 'equal' && shares.length !== 2)))
  )
    return null
  const rows = shares.map((row) => ({
    personId: row.personId,
    units: percentageUnits(row.percentage),
  }))
  if (
    rows.some((row) => row.units === null) ||
    rows.reduce((sum, row) => sum + (row.units ?? 0n), 0n) !== 1000000n
  )
    return null
  const exact = rows.map((row) => {
    const value = BigInt(amount) * row.units!
    return {
      personId: row.personId,
      cents: value / 1000000n,
      remainder: value % 1000000n,
    }
  })
  const ranked = [...exact].sort((a, b) =>
    a.remainder !== b.remainder
      ? a.remainder > b.remainder
        ? -1
        : 1
      : a.personId < b.personId
        ? -1
        : 1,
  )
  const left = Number(
    BigInt(amount) - exact.reduce((sum, row) => sum + row.cents, 0n),
  )
  for (let index = 0; index < left; index++) ranked[index].cents++
  return exact.map((row) => ({
    personId: row.personId,
    cents: Number(row.cents),
  }))
}
export function validateExpense(
  values: ExpenseValues,
  references: References,
): ExpenseErrors {
  const errors: ExpenseErrors = {}
  if (
    !values.place.trim() ||
    values.place.trim().normalize('NFKC').length > 200
  )
    errors.place = 'Escribe un lugar de compra de hasta 200 caracteres.'
  if (amountInCents(values.amount) === null)
    errors.amount =
      'Ingresa un monto positivo, de hasta S/ 999,999,999,999.99 y con 2 decimales como máximo.'
  const date = new Date(`${values.date}T00:00:00Z`)
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(values.date) ||
    values.date.startsWith('0000') ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== values.date
  )
    errors.date = 'Selecciona una fecha válida.'
  if (values.description.trim().normalize('NFKC').length > 2000)
    errors.description = 'Usa un máximo de 2000 caracteres.'
  if (
    !references.categories.some(
      (row) => row.id === values.category && row.isActive,
    )
  )
    errors.category = 'Selecciona una categoría activa.'
  if (
    !references.methods.some(
      (row) => row.id === values.paymentMethodId && row.isActive,
    )
  )
    errors.paymentMethodId = 'Selecciona un medio de pago activo.'
  const validPerson = (id: string) =>
    references.people.some((row) => row.id === id && row.isActive)
  if (!validPerson(values.payer))
    errors.payer = 'Selecciona quién aporta el dinero.'
  if (!values.expenseType)
    errors.expenseType = 'Elige si el consumo es personal o compartido.'
  if (values.expenseType === 'personal' && !validPerson(values.owner))
    errors.owner = 'Selecciona a quién pertenece el consumo.'
  if (values.expenseType === 'shared') {
    if (!values.splitMode) errors.splitMode = 'Elige cómo dividir el consumo.'
    const shares = declaredShares(values)
    if (
      shares.length < 2 ||
      shares.length > 20 ||
      shares.some((row) => !validPerson(row.personId)) ||
      new Set(shares.map((row) => row.personId)).size !== shares.length
    )
      errors.allocation =
        'Selecciona de 2 a 20 personas activas, sin repetirlas.'
    else if (
      shares.some((row) => percentageUnits(row.percentage) === null) ||
      shares.reduce(
        (sum, row) => sum + (percentageUnits(row.percentage) ?? 0n),
        0n,
      ) !== 1000000n ||
      (values.splitMode === 'equal' && shares.length !== 2)
    )
      errors.allocation =
        'Usa porcentajes positivos, con hasta 4 decimales, que sumen exactamente 100 %. El reparto 50/50 requiere dos personas.'
  }
  return errors
}
export function expensePayload(values: ExpenseValues): ExpensePayload {
  const cents = amountInCents(values.amount)
  if (cents === null) throw new Error('Invalid amount')
  const digits = String(cents).padStart(3, '0')
  return {
    amount: `${digits.slice(0, -2)}.${digits.slice(-2)}`,
    purchasedOn: values.date,
    merchant: values.place.trim().normalize('NFKC'),
    description: values.description.trim().normalize('NFKC') || null,
    categoryId: values.category,
    paymentMethodId: values.paymentMethodId,
    fundedByPersonId: values.payer,
    classification: values.expenseType === 'personal' ? 'PERSONAL' : 'SHARED',
    allocations: declaredShares(values).map((row) => {
      const units = percentageUnits(row.percentage)
      if (units === null) throw new Error('Invalid percentage')
      const fraction = (units % 10000n)
        .toString()
        .padStart(4, '0')
        .replace(/0+$/, '')
      return {
        personId: row.personId,
        percentage: `${units / 10000n}${fraction ? `.${fraction}` : ''}`,
      }
    }),
  }
}
