import { useMemo } from 'react'
import { createFinanceApi } from '../../api/finance'
import { useAuth } from '../../auth/useAuth'
export function useFinanceApi() {
  const { session, expireSession } = useAuth()
  return useMemo(
    () =>
      createFinanceApi(
        import.meta.env.VITE_API_URL || '/api',
        session?.csrfToken ?? '',
        expireSession,
      ),
    [session?.csrfToken, expireSession],
  )
}
