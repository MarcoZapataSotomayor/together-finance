import { useCallback, useState } from 'react'
import type { ReactNode, SetStateAction } from 'react'
import { ExpenseDraftContext } from './ExpenseDraftContext'
import { ExpenseSubmission } from './expenseSubmission'
import type { ExpenseValues } from './expenseModel'

// Only unsaved input and the pending request controller outlive the auth gate.
export function ExpenseDraftProvider({ children }: { children: ReactNode }) {
  const [values, setValues] = useState<Record<string, ExpenseValues>>({})
  const [submission, setSubmission] = useState(() => new ExpenseSubmission())
  const update = useCallback(
    (
      key: string,
      action: SetStateAction<ExpenseValues>,
      initial: ExpenseValues,
    ) => {
      setValues((current) => ({
        ...current,
        [key]:
          typeof action === 'function'
            ? action(current[key] ?? initial)
            : action,
      }))
    },
    [],
  )
  const clear = useCallback((key: string) => {
    setValues((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([entry]) => entry !== key),
      ),
    )
  }, [])
  const resetNew = useCallback(() => {
    const fresh = new ExpenseSubmission()
    clear('new')
    setSubmission(fresh)
    return fresh
  }, [clear])
  return (
    <ExpenseDraftContext.Provider
      value={{ values, submission, update, clear, resetNew }}
    >
      {children}
    </ExpenseDraftContext.Provider>
  )
}
