import { createContext } from 'react'
import type { SessionResponse } from './api-client'

export interface AuthState {
  phase: 'checking' | 'anonymous' | 'authenticated' | 'error'
  session: SessionResponse | null
  operation: 'login' | 'logout' | null
  waking: boolean
  error: string
  notice: string
  login: (password: string) => Promise<void>
  logout: () => Promise<void>
  reconnect: () => void
}

export const AuthContext = createContext<AuthState | undefined>(undefined)
