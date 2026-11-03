import { useEffect, useState } from 'react'
export function useResource<T>(
  key: string,
  load: (signal: AbortSignal) => Promise<T>,
  active = true,
) {
  const [result, setResult] = useState<{
    key: string
    data?: T
    error?: unknown
  } | null>(null)
  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    load(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setResult({ key, data })
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setResult((previous) => ({ key, data: previous?.data, error }))
      })
    return () => controller.abort()
  }, [key, load, active])
  return {
    data: result?.data,
    error: result?.key === key ? result.error : undefined,
    loading: active && result?.key !== key,
  }
}
