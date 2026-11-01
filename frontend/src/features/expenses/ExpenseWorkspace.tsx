import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react'
import type {
  CategoryRecord,
  PaymentMethodRecord,
  PersonRecord,
  References,
} from '../../api/types'
import { emptyReferences } from '../../api/types'
import { uuidPattern } from '../../api/finance'
import { ApiFeedback, LoadingNotice } from './ApiFeedback'
import { ExpenseDetailScreen } from './ExpenseDetailScreen'
import { ExpenseHistory } from './ExpenseHistory'
import { NewExpenseScreen } from './NewExpenseScreen'
import type { CreatedReference, ReferenceKind } from './ReferenceEditor'
import { useFinanceApi } from './useFinanceApi'
import { useResource } from './useResource'

function subscribe(listener: () => void) {
  window.addEventListener('hashchange', listener)
  return () => window.removeEventListener('hashchange', listener)
}
function snapshot() {
  return window.location.hash
}
function merge<T extends { id: string }>(original: T[], added: T[]): T[] {
  return [
    ...new Map([...original, ...added].map((row) => [row.id, row])).values(),
  ].sort((a, b) =>
    ('name' in a ? String(a.name) : '').localeCompare(
      'name' in b ? String(b.name) : '',
    ),
  )
}

export function ExpenseWorkspace() {
  const api = useFinanceApi()
  const hash = useSyncExternalStore(subscribe, snapshot)
  const [version, setVersion] = useState(0)
  const [referenceVersion, setReferenceVersion] = useState(0)
  const [created, setCreated] = useState<References>(emptyReferences)
  const load = useCallback(
    (signal: AbortSignal) => api.references(signal),
    [api],
  )
  const resource = useResource(`references-${referenceVersion}`, load)
  const references = useMemo(
    () => ({
      people: merge(resource.data?.people ?? [], created.people),
      categories: merge(resource.data?.categories ?? [], created.categories),
      methods: merge(resource.data?.methods ?? [], created.methods),
    }),
    [resource.data, created],
  )
  const route = hash.replace(/^#/, '') || '/expenses/new'
  const segments = route.split('/')
  const isNew = route === '/expenses/new'
  const isHistory = route === '/expenses'
  const id = segments[2]?.toLowerCase() ?? ''
  const isDetail =
    segments[1] === 'expenses' &&
    uuidPattern.test(id) &&
    (segments.length === 3 || (segments.length === 4 && segments[3] === 'edit'))
  const ready = !resource.loading && !resource.error && !!resource.data
  useEffect(() => {
    requestAnimationFrame(() =>
      document.getElementById('main-content')?.focus(),
    )
  }, [hash])
  function createdReference(kind: ReferenceKind, record: CreatedReference) {
    setCreated((current) =>
      kind === 'people'
        ? {
            ...current,
            people: merge(current.people, [record as PersonRecord]),
          }
        : kind === 'categories'
          ? {
              ...current,
              categories: merge(current.categories, [record as CategoryRecord]),
            }
          : {
              ...current,
              methods: merge(current.methods, [record as PaymentMethodRecord]),
            },
    )
  }
  function changed() {
    setVersion((value) => value + 1)
  }
  return (
    <div className="expense-workspace">
      <nav className="expense-navigation" aria-label="Navegación de consumos">
        <a href="#/expenses/new" aria-current={isNew ? 'page' : undefined}>
          Nuevo consumo
        </a>
        <a
          href="#/expenses"
          aria-current={isHistory || isDetail ? 'page' : undefined}
        >
          Historial
        </a>
      </nav>
      {resource.loading && (
        <LoadingNotice text="Cargando personas, categorías y medios de pago…" />
      )}
      {resource.error != null && (
        <ApiFeedback
          error={resource.error}
          onRetry={() => setReferenceVersion((value) => value + 1)}
        />
      )}
      <div className="workspace-page" hidden={!isNew}>
        <NewExpenseScreen
          api={api}
          references={references}
          ready={ready}
          active={isNew}
          onReferenceCreated={createdReference}
          onReloadReferences={() => setReferenceVersion((value) => value + 1)}
          onSaved={changed}
        />
      </div>
      <div className="workspace-page" hidden={!isHistory}>
        <ExpenseHistory
          api={api}
          references={references}
          active={isHistory}
          version={version}
        />
      </div>
      {isDetail && (
        <ExpenseDetailScreen
          key={id}
          id={id}
          editing={segments[3] === 'edit'}
          api={api}
          references={references}
          ready={ready}
          onReferenceCreated={createdReference}
          onReloadReferences={() => setReferenceVersion((value) => value + 1)}
          onChanged={changed}
          onDeleted={changed}
        />
      )}
      {!isNew && !isHistory && !isDetail && (
        <section className="workspace-empty">
          <h1>No encontramos esta página</h1>
          <a href="#/expenses">Volver al historial</a>
        </section>
      )}
    </div>
  )
}
