import { useState } from 'react'
import type { ReactNode } from 'react'
import type { LoanPayload, RepaymentPayload } from '../../api/debts'
import { CreationSubmission } from './creationSubmission'
import { DebtDraftContext } from './DebtDraftContext'
import type { LoanValues, RepaymentValues } from './debtModel'

export function DebtDraftProvider({ children }: { children: ReactNode }) {
  const [loans, setLoans] = useState<Record<string, LoanValues>>({})
  const [payments, setPayments] = useState<Record<string, RepaymentValues>>({})
  const [mappings, setMappings] = useState<Record<string, string>>({})
  const [loanIntents] = useState(
    () => new Map<string, CreationSubmission<LoanPayload>>(),
  )
  const [paymentIntents] = useState(
    () => new Map<string, CreationSubmission<RepaymentPayload>>(),
  )
  return (
    <DebtDraftContext.Provider
      value={{
        loans,
        payments,
        mappings,
        mapPerson: (pov, id) =>
          setMappings((current) => ({ ...current, [pov]: id })),
        updateLoan: (key, values) =>
          setLoans((current) => ({ ...current, [key]: values })),
        updatePayment: (key, values) =>
          setPayments((current) => ({ ...current, [key]: values })),
        loanIntent: (key) => {
          if (!loanIntents.has(key))
            loanIntents.set(key, new CreationSubmission())
          return loanIntents.get(key)!
        },
        paymentIntent: (key) => {
          if (!paymentIntents.has(key))
            paymentIntents.set(key, new CreationSubmission())
          return paymentIntents.get(key)!
        },
        clear: (key) => {
          loanIntents.delete(key)
          paymentIntents.delete(key)
          setLoans((current) =>
            Object.fromEntries(
              Object.entries(current).filter(([id]) => id !== key),
            ),
          )
          setPayments((current) =>
            Object.fromEntries(
              Object.entries(current).filter(([id]) => id !== key),
            ),
          )
        },
      }}
    >
      {children}
    </DebtDraftContext.Provider>
  )
}
