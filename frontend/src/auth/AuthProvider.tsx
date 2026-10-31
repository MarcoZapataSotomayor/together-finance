import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { AuthContext } from './AuthContext'
import type { AuthState } from './AuthContext'
import { AuthRequestError, authErrorMessage, authRequest, fetchSession } from './api-client'
import type { SessionResponse } from './api-client'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<AuthState['phase']>('checking')
  const [session, setSession] = useState<SessionResponse | null>(null)
  const [operation, setOperation] = useState<AuthState['operation']>(null)
  const [waking, setWaking] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [attempt, setAttempt] = useState(0)

  function accept(next: SessionResponse) {
    setSession(next)
    setPhase(next.authenticated ? 'authenticated' : 'anonymous')
  }

  function reconnect() {
    setPhase('checking'); setSession(null); setWaking(false); setError(''); setAttempt(value => value + 1)
  }

  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(() => setWaking(true), 3000)
    fetchSession(apiUrl, controller.signal).then(next => { if (!controller.signal.aborted) accept(next) }).catch(() => {
      if (!controller.signal.aborted) { setError('No pudimos abrir la conexión. El servidor puede estar despertando. Vuelve a conectar para intentarlo de nuevo.'); setPhase('error') }
    }).finally(() => { clearTimeout(timer); if (!controller.signal.aborted) setWaking(false) })
    return () => { controller.abort(); clearTimeout(timer) }
  }, [attempt])

  useEffect(() => {
    if (!session?.authenticated) return
    const timer = setTimeout(() => {
      setNotice('Tu sesión terminó. Ingresa de nuevo para continuar.')
      setSession(null); setPhase('checking'); setAttempt(value => value + 1)
    }, Math.max(0, Date.parse(session.expiresAt) - Date.now()))
    return () => clearTimeout(timer)
  }, [session])

  async function login(password: string) {
    if (!session || operation) return
    setOperation('login'); setError(''); setNotice('')
    const timer = setTimeout(() => setWaking(true), 3000)
    try {
      await authRequest<SessionResponse>(apiUrl, 'login', { method: 'POST', csrfToken: session.csrfToken, body: { password } })
      // Confirm the rotated cookie was accepted; cross-site browsers may block it.
      const confirmed = await fetchSession(apiUrl)
      if (!confirmed.authenticated) throw new AuthRequestError(403)
      accept(confirmed)
    } catch (failure) {
      setError(authErrorMessage(failure))
      if (failure instanceof AuthRequestError && failure.status === 403) { setSession(null); setPhase('error') }
    } finally { clearTimeout(timer); setWaking(false); setOperation(null) }
  }

  async function logout() {
    if (!session || operation) return
    setOperation('logout'); setError('')
    try {
      await authRequest<void>(apiUrl, 'logout', { method: 'POST', csrfToken: session.csrfToken, body: {} })
      setNotice('Cerraste el acceso. Tus preferencias de estilo se mantienen.')
      reconnect()
    } catch (failure) {
      if (failure instanceof AuthRequestError && failure.status === 401) { setNotice('Tu sesión ya terminó.'); reconnect() }
      else setError('No pudimos cerrar la sesión. La conexión falló; inténtalo de nuevo.')
    } finally { setOperation(null) }
  }

  return <AuthContext.Provider value={{ phase, session, operation, waking, error, notice, login, logout, reconnect }}>{children}</AuthContext.Provider>
}
