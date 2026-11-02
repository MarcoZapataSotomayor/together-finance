import type { SpendingFilters } from '../../api/analytics.ts'
import { validDate } from '../debts/debtModel.ts'

export function monthRange(month: string): SpendingFilters {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month.startsWith('0000'))
    throw new Error('Invalid calendar month')
  const year = Number(month.slice(0, 4)),
    number = Number(month.slice(5, 7))
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][
    number - 1
  ]
  return { from: `${month}-01`, to: `${month}-${days}` }
}
export function validatePeriod(from: string, to: string): string {
  if (!validDate(from) || !validDate(to) || from > to)
    return 'Usa fechas válidas y un inicio anterior o igual al fin.'
  const months =
    (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 +
    Number(to.slice(5, 7)) -
    Number(from.slice(5, 7)) +
    1
  return months > 24 ? 'Elige un período de hasta 24 meses calendario.' : ''
}
export function trendRange(period: SpendingFilters): SpendingFilters {
  const index =
    Number(period.to.slice(0, 4)) * 12 + Number(period.to.slice(5, 7)) - 1
  const start = Math.max(12, index - 5)
  const month = `${Math.floor(start / 12)
    .toString()
    .padStart(4, '0')}-${String((start % 12) + 1).padStart(2, '0')}`
  return {
    from: period.from < `${month}-01` ? period.from : `${month}-01`,
    to: period.to,
    ...(period.personId ? { personId: period.personId } : {}),
  }
}
const units = (value: string) => BigInt(value.replace('.', ''))
// Ratios are bounded integer geometry, never monetary totals or balances.
export function barPercent(value: string, maximum: string): string {
  const total = units(maximum)
  const scaled = total === 0n ? 0n : (units(value) * 10000n) / total
  return `${scaled / 100n}.${(scaled % 100n).toString().padStart(2, '0')}%`
}
export function barHeight(value: string, maximum: string): number {
  const total = units(maximum)
  return total === 0n ? 0 : Number((units(value) * 140n) / total)
}
export function maximumAmount(values: string[]): string {
  return values.reduce(
    (maximum, value) => (units(value) > units(maximum) ? value : maximum),
    '0.00',
  )
}
export function monthLabel(month: string, short = false): string {
  return new Intl.DateTimeFormat('es-PE', {
    month: short ? 'short' : 'long',
    year: short ? '2-digit' : 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${month}-01T00:00:00Z`))
}
