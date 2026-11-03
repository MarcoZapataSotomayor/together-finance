import type {
  DebtFilters,
  DebtRecord,
  DebtRepayment,
  LoanPayload,
  RepaymentPayload,
} from '../../api/debts.ts'
import type { NamedRecord } from '../../api/types.ts'
import type { Pov } from '../../theme/themes.ts'

export function moneyUnits(value: string, allowZero = false): bigint | null {
  const normalized = value.trim().replace(',', '.')
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(normalized)) return null
  const [whole, fraction = ''] = normalized.split('.')
  const result = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
  return result <= 99999999999999n && (allowZero ? result >= 0n : result > 0n)
    ? result
    : null
}
export function canonicalMoney(value: string): string {
  const units = moneyUnits(value)
  if (units === null) throw new Error('Invalid monetary input')
  return `${units / 100n}.${(units % 100n).toString().padStart(2, '0')}`
}
export function formatPen(value: string): string {
  if (!/^\d+\.\d{2}$/.test(value))
    throw new Error('Invalid server monetary value')
  const [whole, fraction] = value.split('.')
  return `S/ ${BigInt(whole).toLocaleString('es-PE')}.${fraction}`
}
export function validDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00Z`)
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !value.startsWith('0000') &&
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  )
}
export const formatDebtDate = (value: string) =>
  new Intl.DateTimeFormat('es-PE', {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`))
const text = (value: string) => value.trim().normalize('NFKC') || null

export interface LoanValues {
  debtorPersonId: string
  creditorPersonId: string
  amount: string
  incurredOn: string
  dueOn: string
  description: string
}
export interface RepaymentValues {
  payer: string
  recipient: string
  amount: string
  paidOn: string
  description: string
}
export type FieldErrors<T> = Partial<Record<keyof T, string>>
export function validateLoan(
  values: LoanValues,
  people: NamedRecord[],
): FieldErrors<LoanValues> {
  const errors: FieldErrors<LoanValues> = {}
  if (!people.some((row) => row.id === values.debtorPersonId))
    errors.debtorPersonId = 'Selecciona quién debe el dinero.'
  if (!people.some((row) => row.id === values.creditorPersonId))
    errors.creditorPersonId = 'Selecciona quién presta el dinero.'
  if (
    values.debtorPersonId &&
    values.debtorPersonId === values.creditorPersonId
  )
    errors.creditorPersonId = 'Elige dos personas distintas.'
  if (moneyUnits(values.amount) === null)
    errors.amount =
      'Usa un monto positivo de hasta S/ 999,999,999,999.99 y máximo 2 decimales.'
  if (!validDate(values.incurredOn))
    errors.incurredOn = 'Selecciona una fecha de préstamo válida.'
  if (
    values.dueOn &&
    (!validDate(values.dueOn) || values.dueOn < values.incurredOn)
  )
    errors.dueOn =
      'El vencimiento debe ser una fecha válida desde el día del préstamo.'
  if ((text(values.description)?.length ?? 0) > 2000)
    errors.description = 'Usa un máximo de 2000 caracteres.'
  return errors
}
export function loanPayload(values: LoanValues): LoanPayload {
  return {
    debtorPersonId: values.debtorPersonId,
    creditorPersonId: values.creditorPersonId,
    amount: canonicalMoney(values.amount),
    incurredOn: values.incurredOn,
    dueOn: values.dueOn || null,
    description: text(values.description),
  }
}
export function loanValues(record: DebtRecord): LoanValues {
  return {
    debtorPersonId: record.debtorPersonId,
    creditorPersonId: record.creditorPersonId,
    amount: record.originalAmount,
    incurredOn: record.incurredOn,
    dueOn: record.dueOn ?? '',
    description: record.description ?? '',
  }
}
export function loanChanges(
  values: LoanValues,
  record: DebtRecord,
): Partial<LoanPayload> {
  const previous = loanPayload(loanValues(record)),
    next = loanPayload(values)
  return Object.fromEntries(
    Object.entries(next).filter(
      ([key, value]) => value !== previous[key as keyof LoanPayload],
    ),
  )
}
export function validatePayment(
  values: RepaymentValues,
  debt: DebtRecord,
): FieldErrors<RepaymentValues> {
  const errors: FieldErrors<RepaymentValues> = {}
  if (values.payer !== debt.debtorPersonId)
    errors.payer = 'Confirma la persona que paga esta deuda.'
  if (values.recipient !== debt.creditorPersonId)
    errors.recipient = 'Confirma la persona que recibe este pago.'
  const amount = moneyUnits(values.amount),
    remaining = moneyUnits(debt.outstandingAmount, true)
  if (amount === null)
    errors.amount = 'Ingresa un monto positivo con máximo 2 decimales.'
  else if (remaining === null || amount > remaining)
    errors.amount =
      'El pago supera el pendiente actual. Revisa el detalle antes de guardar.'
  if (!validDate(values.paidOn) || values.paidOn < debt.incurredOn)
    errors.paidOn = 'Selecciona una fecha válida desde el día de la deuda.'
  if ((text(values.description)?.length ?? 0) > 2000)
    errors.description = 'Usa un máximo de 2000 caracteres.'
  return errors
}
export function repaymentPayload(values: RepaymentValues): RepaymentPayload {
  return {
    amount: canonicalMoney(values.amount),
    paidOn: values.paidOn,
    description: text(values.description),
  }
}
export function matchesLoan(record: DebtRecord, payload: LoanPayload): boolean {
  return (
    record.active &&
    record.origin === 'LOAN' &&
    record.originalAmount === payload.amount &&
    record.debtorPersonId === payload.debtorPersonId &&
    record.creditorPersonId === payload.creditorPersonId &&
    record.incurredOn === payload.incurredOn &&
    record.dueOn === payload.dueOn &&
    record.description === payload.description
  )
}
export function matchesPayment(
  record: DebtRepayment,
  payload: RepaymentPayload,
  debtId: string,
): boolean {
  return (
    record.active &&
    record.debtId === debtId &&
    record.amount === payload.amount &&
    record.paidOn === payload.paidOn &&
    record.description === payload.description
  )
}
export function resolvePovPerson(
  pov: Pov,
  people: NamedRecord[],
  mappedId = '',
): NamedRecord | undefined {
  if (pov === 'shared') return undefined
  if (mappedId) return people.find((row) => row.id === mappedId)
  const matches = people.filter(
    (row) =>
      row.name.trim().normalize('NFKC').toLocaleLowerCase('es-PE') === pov,
  )
  return matches.length === 1 ? matches[0] : undefined
}
export type Direction = 'both' | 'owed' | 'receivable'
export function directionalFilters(
  personId: string,
  direction: Direction,
  filters: DebtFilters,
): { key: string; filters: DebtFilters }[] {
  if (!personId) return [{ key: 'all', filters }]
  const rows = []
  if (direction !== 'receivable')
    rows.push({
      key: 'owed',
      filters: { ...filters, debtorPersonId: personId },
    })
  if (direction !== 'owed')
    rows.push({
      key: 'receivable',
      filters: { ...filters, creditorPersonId: personId },
    })
  return rows
}
