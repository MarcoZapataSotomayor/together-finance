export class AuthRequestError extends Error {
  readonly status: number
  constructor(status: number) { super('Authentication request failed'); this.status = status }
}

interface RequestOptions {
  method?: 'GET' | 'POST'
  csrfToken?: string
  body?: unknown
  signal?: AbortSignal
  timeoutMs?: number
}

export interface SessionResponse {
  authenticated: boolean
  csrfToken: string
  expiresAt: string
}

export async function authRequest<T>(baseUrl: string, path: string, options: RequestOptions = {}, fetcher: typeof fetch = fetch): Promise<T> {
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 30000)
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
  try {
    const response = await fetcher(`${baseUrl.replace(/\/$/, '')}/auth/${path}`, {
      method: options.method ?? 'GET',
      credentials: 'include',
      cache: 'no-store',
      redirect: 'error',
      signal,
      headers: { ...(options.method === 'POST' ? { 'Content-Type': 'application/json' } : {}), ...(options.csrfToken ? { 'X-CSRF-Token': options.csrfToken } : {}) },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    })
    if (!response.ok) throw new AuthRequestError(response.status)
    if (response.status === 204) return undefined as T
    return await response.json() as T
  } catch (error) {
    if (options.signal?.aborted) throw options.signal.reason
    if (error instanceof AuthRequestError) throw error
    throw new AuthRequestError(0)
  }
}

export function isSessionResponse(value: unknown): value is SessionResponse {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  const expiry = typeof item.expiresAt === 'string' ? Date.parse(item.expiresAt) : NaN
  return typeof item.authenticated === 'boolean' && typeof item.csrfToken === 'string' && /^[A-Za-z0-9_-]{43}$/.test(item.csrfToken) && Number.isFinite(expiry) && expiry > Date.now() && expiry <= Date.now() + 24 * 60 * 60 * 1000 + 300000
}

function waitForRetry(signal?: AbortSignal, delayMs = 1000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', cancel); resolve() }, delayMs)
    function cancel() { clearTimeout(timer); reject(signal?.reason) }
    signal?.addEventListener('abort', cancel, { once: true })
  })
}

export async function fetchSession(baseUrl: string, signal?: AbortSignal, fetcher: typeof fetch = fetch, timing: { timeoutMs?: number; retryDelayMs?: number } = {}): Promise<SessionResponse> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await authRequest<unknown>(baseUrl, 'session', { signal, timeoutMs: timing.timeoutMs }, fetcher)
      if (!isSessionResponse(result)) throw new AuthRequestError(502)
      return result
    } catch (error) {
      if (signal?.aborted || attempt === 1 || !(error instanceof AuthRequestError) || ![0, 502, 503, 504].includes(error.status)) throw error
      await waitForRetry(signal, timing.retryDelayMs)
    }
  }
  throw new AuthRequestError(0)
}

export function authErrorMessage(error: unknown): string {
  if (error instanceof AuthRequestError) {
    if (error.status === 401) return 'La contraseña no es correcta. Inténtalo de nuevo.'
    if (error.status === 403) return 'No pudimos verificar las cookies de acceso. Vuelve a conectar y comprueba que tu navegador las permita.'
    if (error.status === 429) return 'Hay demasiados intentos de acceso. Espera unos minutos antes de volver a intentarlo.'
  }
  return 'No pudimos conectar con el servidor. Puede estar despertando; vuelve a intentarlo en unos segundos.'
}
