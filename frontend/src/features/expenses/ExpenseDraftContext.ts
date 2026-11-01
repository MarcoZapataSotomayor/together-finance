import { createContext } from 'react'
import type { SetStateAction } from 'react'
import type { ExpenseValues } from './expenseModel'
import type { ExpenseSubmission } from './expenseSubmission'

export interface ExpenseDraftState {
  values: Record<string, ExpenseValues>
  submission: ExpenseSubmission
  update: (
    key: string,
    action: SetStateAction<ExpenseValues>,
    initial: ExpenseValues,
  ) => void
  clear: (key: string) => void
  resetNew: () => ExpenseSubmission
}
export const ExpenseDraftContext = createContext<ExpenseDraftState | undefined>(
  undefined,
)
