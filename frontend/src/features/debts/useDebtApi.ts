import { useMemo } from 'react'
import { createDebtApi } from '../../api/debts'
import { useAuth } from '../../auth/useAuth'
export function useDebtApi() {
  const { session, expireSession } = useAuth()
  return useMemo(
    () =>
      createDebtApi(
        import.meta.env.VITE_API_URL || '/api',
        session?.csrfToken ?? '',
        expireSession,
      ),
    [session?.csrfToken, expireSession],
  )
}
