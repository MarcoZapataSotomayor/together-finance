import { createContext, useContext } from 'react'
import type { LoanPayload, RepaymentPayload } from '../../api/debts'
import type { LoanValues, RepaymentValues } from './debtModel'
import type { CreationSubmission } from './creationSubmission'

export interface DebtDraftState {
  loans: Record<string, LoanValues>
  payments: Record<string, RepaymentValues>
  mappings: Record<string, string>
  mapPerson: (pov: string, id: string) => void
  updateLoan: (key: string, values: LoanValues) => void
  updatePayment: (key: string, values: RepaymentValues) => void
  loanIntent: (key: string) => CreationSubmission<LoanPayload>
  paymentIntent: (key: string) => CreationSubmission<RepaymentPayload>
  clear: (key: string) => void
}
export const DebtDraftContext = createContext<DebtDraftState | undefined>(
  undefined,
)
export function useDebtDrafts() {
  const value = useContext(DebtDraftContext)
  if (!value) throw new Error('DebtDraftProvider is required')
  return value
}
