import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../../api/client'
import { financeError } from '../../api/finance'
import { useAuth } from '../../auth/useAuth'
import { Button } from '../../components/ui/Button'
export function LoadingNotice({
  text = 'Cargando tus consumos…',
}: {
  text?: string
}) {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 3000)
    return () => clearTimeout(timer)
  }, [])
  return (
    <p className="workspace-notice" role="status">
      <span className="auth-spinner" aria-hidden="true" />
      {slow
        ? 'El servidor está despertando… El intento es limitado; no vuelvas a enviar el formulario.'
        : text}
    </p>
  )
}
export function ApiFeedback({
  error,
  context = 'read',
  onRetry,
  errorMessage,
}: {
  error: unknown
  context?: Parameters<typeof financeError>[1]
  onRetry?: () => void
  errorMessage?: string
}) {
  const { refreshSession } = useAuth()
  const lock = useRef(false)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  async function refresh() {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    try {
      await refreshSession()
      setMessage('Acceso actualizado. Puedes reintentar la operación.')
    } catch {
      setMessage(
        'No pudimos revalidar el acceso. Inténtalo cuando vuelva la conexión.',
      )
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  return (
    <div className="form-message error-summary workspace-error" role="alert">
      <p>{errorMessage ?? financeError(error, context)}</p>
      {message && <p>{message}</p>}
      <div className="workspace-actions">
        {error instanceof ApiError && error.status === 403 && (
          <Button onClick={() => void refresh()} disabled={busy}>
            {busy ? 'Revalidando…' : 'Revalidar acceso'}
          </Button>
        )}
        {onRetry && (
          <Button variant="ghost" onClick={onRetry}>
            Volver a cargar
          </Button>
        )}
      </div>
    </div>
  )
}
