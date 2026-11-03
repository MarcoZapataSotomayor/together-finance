import { ApiError, apiRead, apiRequest } from './client.ts'
import type {
  CategoryRecord,
  ExpenseFilters,
  ExpensePayload,
  ExpenseRecord,
  Page,
  PaymentMethodRecord,
  PaymentMethodType,
  PersonRecord,
  References,
} from './types.ts'

export const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
function named(value: unknown): boolean {
  return (
    record(value) &&
    typeof value.id === 'string' &&
    uuidPattern.test(value.id) &&
    typeof value.name === 'string'
  )
}
function expense(value: unknown): value is ExpenseRecord {
  if (
    !record(value) ||
    !named({ id: value.id, name: value.merchant }) ||
    typeof value.amount !== 'string' ||
    !/^\d+\.\d{2}$/.test(value.amount) ||
    typeof value.purchasedOn !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value.purchasedOn) ||
    !['PERSONAL', 'SHARED'].includes(String(value.classification)) ||
    value.currency !== 'PEN' ||
    !named(value.category) ||
    !named(value.paymentMethod) ||
    !named(value.fundedBy) ||
    !Array.isArray(value.allocations)
  )
    return false
  return value.allocations.every(
    (row) =>
      record(row) &&
      typeof row.personId === 'string' &&
      named(row.person) &&
      typeof row.amount === 'string' &&
      /^\d+\.\d{2}$/.test(row.amount) &&
      typeof row.percentage === 'string' &&
      typeof row.active === 'boolean' &&
      (row.debt === null ||
        (record(row.debt) &&
          typeof row.debt.originalAmount === 'string' &&
          typeof row.debt.outstandingAmount === 'string' &&
          ['OPEN', 'PARTIALLY_REPAID', 'PAID', 'INACTIVE'].includes(
            String(row.debt.status),
          ) &&
          Array.isArray(row.debt.repayments))),
  )
}
function page<T>(value: unknown, validate: (row: unknown) => boolean): Page<T> {
  if (
    !record(value) ||
    !Array.isArray(value.data) ||
    !value.data.every(validate) ||
    !Number.isSafeInteger(value.total) ||
    Number(value.total) < 0 ||
    !Number.isSafeInteger(value.page) ||
    Number(value.page) < 1 ||
    !Number.isSafeInteger(value.pageSize) ||
    Number(value.pageSize) < 1
  )
    throw new ApiError(502)
  return value as unknown as Page<T>
}
function checkedExpense(value: unknown): ExpenseRecord {
  if (!expense(value)) throw new ApiError(502)
  return value
}
const reference = (value: unknown) =>
  named(value) && record(value) && typeof value.isActive === 'boolean'
function checkedReference<T>(value: unknown): T {
  if (!reference(value)) throw new ApiError(502)
  return value as T
}

export function createFinanceApi(
  baseUrl: string,
  csrfToken: string,
  onUnauthorized: () => void,
  fetcher: typeof fetch = fetch,
) {
  async function guard<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work()
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) onUnauthorized()
      throw error
    }
  }
  function read(path: string, signal?: AbortSignal) {
    return guard(() => apiRead<unknown>(baseUrl, path, signal, fetcher))
  }
  function mutate(
    path: string,
    method: 'POST' | 'PATCH' | 'DELETE',
    body: unknown,
  ) {
    return guard(() =>
      apiRequest<unknown>(baseUrl, path, { method, body, csrfToken }, fetcher),
    )
  }
  async function all<T>(path: string, signal?: AbortSignal): Promise<T[]> {
    const rows: T[] = []
    for (let number = 1; number <= 100; number++) {
      const result = page<T>(
        await read(`${path}?page=${number}&pageSize=100`, signal),
        reference,
      )
      if (result.page !== number || result.pageSize !== 100)
        throw new ApiError(502)
      rows.push(...result.data)
      if (rows.length >= result.total) return rows
      if (!result.data.length) throw new ApiError(502)
    }
    throw new ApiError(502)
  }
  return {
    references: async (signal?: AbortSignal): Promise<References> => {
      const [people, categories, methods] = await Promise.all([
        all<PersonRecord>('people', signal),
        all<CategoryRecord>('categories', signal),
        all<PaymentMethodRecord>('payment-methods', signal),
      ])
      return { people, categories, methods }
    },
    list: async (
      filters: ExpenseFilters,
      number = 1,
      pageSize = 20,
      signal?: AbortSignal,
    ) => {
      const query = new URLSearchParams({
        page: String(number),
        pageSize: String(pageSize),
      })
      for (const [key, value] of Object.entries(filters))
        if (value) query.set(key, value)
      return page<ExpenseRecord>(
        await read(`expenses?${query}`, signal),
        expense,
      )
    },
    get: async (id: string, signal?: AbortSignal) =>
      checkedExpense(await read(`expenses/${encodeURIComponent(id)}`, signal)),
    create: async (id: string, input: ExpensePayload) =>
      checkedExpense(await mutate('expenses', 'POST', { ...input, id })),
    update: async (id: string, input: Partial<ExpensePayload>) =>
      checkedExpense(
        await mutate(`expenses/${encodeURIComponent(id)}`, 'PATCH', input),
      ),
    remove: async (id: string) => {
      await mutate(`expenses/${encodeURIComponent(id)}`, 'DELETE', {})
    },
    restore: async (id: string) =>
      checkedExpense(
        await mutate(`expenses/${encodeURIComponent(id)}/restore`, 'POST', {}),
      ),
    createPerson: async (name: string) =>
      checkedReference<PersonRecord>(await mutate('people', 'POST', { name })),
    createCategory: async (name: string) =>
      checkedReference<CategoryRecord>(
        await mutate('categories', 'POST', { name }),
      ),
    createMethod: async (
      name: string,
      type: PaymentMethodType,
      ownerPersonId: string | null,
    ) =>
      checkedReference<PaymentMethodRecord>(
        await mutate('payment-methods', 'POST', { name, type, ownerPersonId }),
      ),
  }
}
export type FinanceApi = ReturnType<typeof createFinanceApi>
export function financeError(
  error: unknown,
  context:
    'create' | 'edit' | 'reference' | 'read' | 'delete' | 'restore' = 'read',
): string {
  if (error instanceof ApiError) {
    if (error.status === 401)
      return 'Tu sesión terminó. Ingresa de nuevo para continuar.'
    if (error.status === 403)
      return 'No pudimos verificar el acceso. Revalida la sesión y vuelve a intentarlo; tus campos se conservan.'
    if (error.status === 400)
      return context === 'reference'
        ? 'Revisa el nombre, tipo y persona seleccionada. Usa un nombre de hasta 120 caracteres y una persona activa.'
        : context === 'read'
          ? 'Revisa las fechas, la página y los filtros seleccionados.'
          : 'Revisa los campos: usa opciones activas, montos válidos y porcentajes positivos que sumen 100 %. Puedes actualizar las opciones del formulario.'
    if (error.status === 404)
      return 'No encontramos este consumo. Revisa su identificador o actualiza el historial.'
    if (error.status === 409)
      return context === 'edit'
        ? 'No se pudo aplicar el cambio. Los pagos registrados protegen el monto de la deuda, sus personas y la fecha. También puede haber un cambio simultáneo; revisa el detalle antes de reintentar.'
        : context === 'reference'
          ? 'Puede existir una opción con ese nombre o haber un cambio simultáneo. Actualiza las opciones antes de reintentar.'
          : context === 'restore'
            ? 'No se puede restaurar: sus repartos o pagos requieren revisión.'
            : 'Hay un conflicto con este registro. Consulta su detalle antes de volver a guardar.'
    if (error.status === 429)
      return 'Hay demasiados intentos. Espera unos minutos antes de reintentar.'
  }
  return 'No pudimos confirmar la operación. El servidor puede estar despertando o la conexión falló. Reintenta cuando vuelva la conexión.'
}
