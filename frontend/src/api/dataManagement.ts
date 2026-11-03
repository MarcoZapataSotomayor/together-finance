import { ApiError, apiRead, apiRequest } from './client.ts'
import { uuidPattern } from './finance.ts'
import type { NamedRecord, Page } from './types.ts'

export type ExportDataset =
  'expenses' | 'allocations' | 'debts' | 'loans' | 'repayments'
export type RecordKind = 'expense' | 'loan' | 'repayment'
export interface ExportFilters {
  from: string
  to: string
  scope: 'active' | 'deleted' | 'all'
  personId?: string
}
export interface BinFilters {
  type?: RecordKind
  deletedFrom?: string
  deletedTo?: string
}
export interface DeletedRecord {
  kind: RecordKind
  id: string
  description: string | null
  amount: string
  currency: 'PEN'
  transactionDate: string
  deletedAt: string
  people: (NamedRecord & { role: string })[]
  morePeople: number
  parent: { kind: 'expense' | 'loan'; id: string; active: boolean } | null
  canRestore: boolean
}
export type ExportPerson = NamedRecord & { isActive: boolean }
export const exportLabels: Record<ExportDataset, string> = {
  expenses: 'Consumos',
  allocations: 'Asignaciones de consumos',
  debts: 'Deudas',
  loans: 'Préstamos independientes',
  repayments: 'Pagos de deudas',
}
export const recordLabels: Record<RecordKind, string> = {
  expense: 'Consumo',
  loan: 'Préstamo',
  repayment: 'Pago',
}
const maximumBytes = 8 * 1024 * 1024
const datasetNames = {
  expenses: 'consumos',
  allocations: 'asignaciones',
  debts: 'deudas',
  loans: 'prestamos',
  repayments: 'pagos',
}
const scopeNames = { active: 'activos', deleted: 'eliminados', all: 'todos' }
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const named = (value: unknown) =>
  object(value) &&
  typeof value.id === 'string' &&
  uuidPattern.test(value.id) &&
  typeof value.name === 'string'
export function deletedRecord(value: unknown): value is DeletedRecord {
  return (
    object(value) &&
    typeof value.kind === 'string' &&
    ['expense', 'loan', 'repayment'].includes(value.kind) &&
    typeof value.id === 'string' &&
    uuidPattern.test(value.id) &&
    (value.description === null || typeof value.description === 'string') &&
    typeof value.amount === 'string' &&
    /^\d+\.\d{2}$/.test(value.amount) &&
    value.currency === 'PEN' &&
    typeof value.transactionDate === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value.transactionDate) &&
    typeof value.deletedAt === 'string' &&
    Number.isFinite(Date.parse(value.deletedAt)) &&
    typeof value.canRestore === 'boolean' &&
    Number.isSafeInteger(value.morePeople) &&
    Number(value.morePeople) >= 0 &&
    Array.isArray(value.people) &&
    value.people.every(
      (p) => named(p) && object(p) && typeof p.role === 'string',
    ) &&
    (value.parent === null ||
      (object(value.parent) &&
        ['expense', 'loan'].includes(String(value.parent.kind)) &&
        typeof value.parent.id === 'string' &&
        uuidPattern.test(value.parent.id) &&
        typeof value.parent.active === 'boolean'))
  )
}
function page<T>(value: unknown, check: (row: unknown) => boolean): Page<T> {
  if (
    !object(value) ||
    !Array.isArray(value.data) ||
    value.data.length > 100 ||
    !value.data.every(check) ||
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
function query(filters: object) {
  return new URLSearchParams(
    Object.entries(filters)
      .filter(([, v]) => v !== '' && v !== undefined)
      .map(([k, v]) => [k, String(v)]),
  ).toString()
}
export async function csvBlob(response: Response, signal?: AbortSignal) {
  if (!/^text\/csv\b/i.test(response.headers.get('Content-Type') ?? '')) {
    await response.body?.cancel()
    throw new ApiError(502)
  }
  if (Number(response.headers.get('Content-Length') ?? 0) > maximumBytes) {
    await response.body?.cancel()
    throw new ApiError(413)
  }
  const reader = response.body?.getReader()
  if (!reader) throw new ApiError(502)
  const chunks: ArrayBuffer[] = []
  let bytes = 0
  const cancel = () => {
    void reader.cancel().catch(() => undefined)
  }
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    for (;;) {
      signal?.throwIfAborted()
      const { done, value } = await reader.read()
      signal?.throwIfAborted()
      if (done) break
      bytes += value.byteLength
      if (bytes > maximumBytes) throw new ApiError(413)
      chunks.push(value.slice().buffer)
    }
    return new Blob(chunks, { type: 'text/csv;charset=utf-8' })
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    if (signal?.aborted) throw signal.reason
    throw error instanceof ApiError ? error : new ApiError(0)
  } finally {
    signal?.removeEventListener('abort', cancel)
    reader.releaseLock()
  }
}
export function createDataManagementApi(
  baseUrl: string,
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
  return {
    export: (
      dataset: ExportDataset,
      filters: ExportFilters,
      signal?: AbortSignal,
    ) =>
      guard(async () => {
        const response = await apiRequest<Response>(
          baseUrl,
          `exports/${dataset}.csv?${query(filters)}`,
          { signal, timeoutMs: 60000, responseType: 'response' },
          fetcher,
        )
        const blob = await csvBlob(response, signal)
        const supplied = /filename="([a-z0-9.-]+)"/i.exec(
          response.headers.get('Content-Disposition') ?? '',
        )?.[1]
        const filename =
          supplied?.startsWith('together-finance-') && supplied.endsWith('.csv')
            ? supplied
            : `together-finance-${datasetNames[dataset]}-${scopeNames[filters.scope]}-${filters.from}-a-${filters.to}.csv`
        return { blob, filename }
      }),
    list: (filters: BinFilters, number = 1, signal?: AbortSignal) =>
      guard(async () =>
        page<DeletedRecord>(
          await apiRead<unknown>(
            baseUrl,
            `recycle-bin?${query({ ...filters, page: number, pageSize: 20 })}`,
            signal,
            fetcher,
          ),
          deletedRecord,
        ),
      ),
    people: (signal?: AbortSignal) =>
      guard(async () => {
        const rows: ExportPerson[] = []
        for (let number = 1; number <= 100; number++) {
          const result = page<ExportPerson>(
            await apiRead<unknown>(
              baseUrl,
              `data-management/people?page=${number}&pageSize=100`,
              signal,
              fetcher,
            ),
            (v) => named(v) && object(v) && typeof v.isActive === 'boolean',
          )
          rows.push(...result.data)
          if (number * result.pageSize >= result.total) return rows
          if (!result.data.length) throw new ApiError(502)
        }
        throw new ApiError(413)
      }),
  }
}
export type DataManagementApi = ReturnType<typeof createDataManagementApi>
