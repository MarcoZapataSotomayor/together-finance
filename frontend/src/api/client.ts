export class ApiError extends Error {
  readonly status: number
  readonly fields: string[]
  constructor(status: number, fields: string[] = []) {
    super('API request failed')
    this.status = status
    this.fields = fields
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  csrfToken?: string
  body?: unknown
  signal?: AbortSignal
  timeoutMs?: number
  responseType?: 'response'
}

export async function apiRequest<T>(
  baseUrl: string,
  path: string,
  options: RequestOptions = {},
  fetcher: typeof fetch = fetch,
): Promise<T> {
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 30000)
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeout])
    : timeout
  const mutation = !!options.method && options.method !== 'GET'
  try {
    const response = await fetcher(`${baseUrl.replace(/\/$/, '')}/${path}`, {
      method: options.method ?? 'GET',
      credentials: 'include',
      cache: 'no-store',
      redirect: 'error',
      signal,
      headers: {
        ...(mutation ? { 'Content-Type': 'application/json' } : {}),
        ...(options.csrfToken ? { 'X-CSRF-Token': options.csrfToken } : {}),
      },
      ...(options.body !== undefined
        ? { body: JSON.stringify(options.body) }
        : {}),
    })
    if (!response.ok) {
      const fields: string[] = []
      if (response.status === 400) {
        try {
          const error = (await response.json()) as { message?: unknown }
          if (Array.isArray(error.message))
            for (const message of error.message) {
              const field =
                typeof message === 'string'
                  ? /^(amount|purchasedOn|merchant|description|categoryId|paymentMethodId|fundedByPersonId|classification|allocations|id|name|type|ownerPersonId|debtorPersonId|creditorPersonId|incurredOn|dueOn|paidOn)\b/.exec(
                      message,
                    )?.[1]
                  : undefined
              if (field && !fields.includes(field)) fields.push(field)
            }
        } catch {
          /* Do not retain server error bodies or driver details. */
        }
      }
      throw new ApiError(response.status, fields)
    }
    if (response.status === 204) return undefined as T
    if (options.responseType === 'response') return response as T
    return (await response.json()) as T
  } catch (error) {
    if (options.signal?.aborted) throw options.signal.reason
    if (error instanceof ApiError) throw error
    throw new ApiError(0)
  }
}

export async function apiRead<T>(
  baseUrl: string,
  path: string,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
  timing: { timeoutMs?: number; retryDelayMs?: number } = {},
): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await apiRequest<T>(
        baseUrl,
        path,
        { signal, timeoutMs: timing.timeoutMs },
        fetcher,
      )
    } catch (error) {
      if (
        signal?.aborted ||
        attempt === 1 ||
        !(error instanceof ApiError) ||
        ![0, 502, 503, 504].includes(error.status)
      )
        throw error
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          signal?.removeEventListener('abort', cancel)
          resolve()
        }, timing.retryDelayMs ?? 1000)
        function cancel() {
          clearTimeout(timer)
          reject(signal?.reason)
        }
        signal?.addEventListener('abort', cancel, { once: true })
        if (signal?.aborted) cancel()
      })
    }
  }
  throw new ApiError(0)
}
