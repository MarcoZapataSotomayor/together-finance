import { useMemo } from 'react'
import { useAuth } from '../../auth/useAuth'
import { createDataManagementApi } from '../../api/dataManagement'

export function useDataManagementApi() {
  const { expireSession } = useAuth()
  return useMemo(
    () =>
      createDataManagementApi(
        import.meta.env.VITE_API_URL || '/api',
        expireSession,
      ),
    [expireSession],
  )
}
