import type { ReactNode } from 'react'
import { LoginScreen } from './LoginScreen'
import { useAuth } from './useAuth'

export function AuthGate({ children }: { children: ReactNode }) {
  const { phase, error } = useAuth()
  return phase === 'authenticated' ? <>{error && <p className="auth-error" role="alert">{error}</p>}{children}</> : <LoginScreen />
}
