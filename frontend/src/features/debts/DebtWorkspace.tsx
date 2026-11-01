import { useCallback, useMemo, useState } from 'react'
import type { FinanceApi } from '../../api/finance'
import { uuidPattern } from '../../api/finance'
import type { References } from '../../api/types'
import { usePov } from '../../theme/usePov'
import type {
  CreatedReference,
  ReferenceKind,
} from '../expenses/ReferenceEditor'
import { useResource } from '../expenses/useResource'
import { DebtDetails, RepaymentDetails } from './DebtDetails'
import { DebtOverview } from './DebtOverview'
import { LoanForm } from './LoanForm'
import { useDebtApi } from './useDebtApi'
import { DebtFeedback } from './DebtUi'
import { LoadingNotice } from '../expenses/ApiFeedback'

export function DebtWorkspace({
  route,
  financeApi,
  references,
  ready,
  version,
  onChanged,
  onReferenceCreated,
  onReloadReferences,
}: {
  route: string
  financeApi: FinanceApi
  references: References
  ready: boolean
  version: number
  onChanged: () => void
  onReferenceCreated: (kind: ReferenceKind, record: CreatedReference) => void
  onReloadReferences: () => void
}) {
  const api = useDebtApi(),
    { pov } = usePov()
  const [retry, setRetry] = useState(0)
  const load = useCallback(
    (signal: AbortSignal) => api.summary({}, signal),
    [api],
  )
  const discovery = useResource(`people-${version}-${retry}`, load)
  const people = useMemo(
    () =>
      [
        ...new Map([
          ...(discovery.data?.byPerson.map(
            (row) => [row.person.id, row.person] as const,
          ) ?? []),
          ...references.people.map((row) => [row.id, row] as const),
        ]).values(),
      ].sort((a, b) => a.name.localeCompare(b.name)),
    [discovery.data, references.people],
  )
  const shared = {
    api,
    financeApi,
    references,
    ready,
    onChanged,
    onReferenceCreated,
    onReloadReferences,
  }
  if (route === '/loans/new') return <LoanForm {...shared} />
  if (['/debts', '/loans', '/repayments'].includes(route))
    return (
      <>
        {discovery.error != null && (
          <DebtFeedback
            error={discovery.error}
            onRetry={() => setRetry((value) => value + 1)}
          />
        )}
        {discovery.loading ? (
          <LoadingNotice text="Cargando las personas de las deudas…" />
        ) : (
          <DebtOverview
            key={`${pov}-${route}`}
            api={api}
            people={people}
            version={version}
            mode={route.slice(1) as 'debts' | 'loans' | 'repayments'}
          />
        )}
      </>
    )
  const parts = route.split('/'),
    id = parts[2]?.toLowerCase() ?? ''
  if (uuidPattern.test(id) && parts[1] === 'repayments' && parts.length === 3)
    return <RepaymentDetails key={id} id={id} api={api} onChanged={onChanged} />
  const validSuffix =
    parts.length === 3 ||
    (parts.length === 4 &&
      (parts[1] === 'loans'
        ? parts[3] === 'edit'
        : ['pay', 'repayments'].includes(parts[3])))
  if (
    uuidPattern.test(id) &&
    ['debts', 'loans'].includes(parts[1]) &&
    validSuffix
  )
    return <DebtDetails key={route} {...shared} id={id} route={route} />
  return (
    <section className="workspace-empty">
      <h1>No encontramos esta página</h1>
      <a href="#/debts">Volver a deudas</a>
    </section>
  )
}
