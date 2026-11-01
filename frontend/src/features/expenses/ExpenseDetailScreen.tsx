import { useCallback, useRef, useState } from 'react'
import type { FinanceApi } from '../../api/finance'
import type { ExpenseRecord, References } from '../../api/types'
import { FrameOrnaments } from '../../components/decorations/Ornaments'
import { Button } from '../../components/ui/Button'
import { ApiFeedback, LoadingNotice } from './ApiFeedback'
import { ExpenseFrameTitle } from './ExpenseFrameTitle'
import { ExpenseSummary } from './ExpenseSummary'
import { NewExpenseScreen } from './NewExpenseScreen'
import type { CreatedReference, ReferenceKind } from './ReferenceEditor'
import { useResource } from './useResource'

export function ExpenseDetailScreen({
  id,
  editing,
  api,
  references,
  ready,
  onChanged,
  onDeleted,
  onReferenceCreated,
  onReloadReferences,
}: {
  id: string
  editing: boolean
  api: FinanceApi
  references: References
  ready: boolean
  onChanged: () => void
  onDeleted: (record: ExpenseRecord) => void
  onReferenceCreated: (kind: ReferenceKind, record: CreatedReference) => void
  onReloadReferences: () => void
}) {
  const [revision, setRevision] = useState(0)
  const [override, setOverride] = useState<ExpenseRecord | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<unknown>(null)
  const [operation, setOperation] = useState<'delete' | 'restore'>('delete')
  const [notice, setNotice] = useState('')
  const lock = useRef(false)
  const confirmPanel = useRef<HTMLDivElement>(null)
  const load = useCallback(
    (signal: AbortSignal) => api.get(id, signal),
    [api, id],
  )
  const resource = useResource(`${id}-${revision}`, load)
  const record = override ?? resource.data
  function reload() {
    setOverride(null)
    setRevision((value) => value + 1)
    setFailure(null)
    setConfirming(false)
  }
  async function remove() {
    if (lock.current || !record) return
    lock.current = true
    setBusy(true)
    setFailure(null)
    setOperation('delete')
    try {
      await api.remove(id)
      onDeleted(record)
      setNotice(
        'Consumo eliminado. Su historial y sus pagos se conservan; puedes restaurarlo desde este detalle.',
      )
      reload()
    } catch (error) {
      setFailure(error)
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  async function restore() {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setFailure(null)
    setOperation('restore')
    try {
      const restored = await api.restore(id)
      setOverride(restored)
      setNotice('Consumo restaurado y confirmado.')
      onChanged()
    } catch (error) {
      setFailure(error)
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  if (
    editing &&
    record &&
    !record.deletedAt &&
    !resource.loading &&
    !resource.error
  )
    return (
      <NewExpenseScreen
        key={id}
        initialExpense={record}
        api={api}
        references={references}
        ready={ready}
        onReferenceCreated={onReferenceCreated}
        onReloadReferences={onReloadReferences}
        onSaved={(saved) => {
          setOverride(saved)
          onChanged()
          setNotice('Cambios guardados y confirmados.')
          window.location.hash = `/expenses/${id}`
        }}
        onCancel={() => {
          window.location.hash = `/expenses/${id}`
        }}
      />
    )
  return (
    <section
      className="consumption-frame history-frame detail-frame"
      aria-labelledby="detail-title"
    >
      <FrameOrnaments />
      <ExpenseFrameTitle title="Detalle del consumo" id="detail-title" />
      <a href="#/expenses" className="back-to-history">
        Volver al historial
      </a>
      {notice && (
        <p role="status" className="form-message confirmation-message">
          {notice}
        </p>
      )}
      {resource.loading ? (
        <LoadingNotice text="Cargando el detalle…" />
      ) : resource.error ? (
        <ApiFeedback error={resource.error} onRetry={reload} />
      ) : (
        record && (
          <>
            {record.deletedAt && (
              <p className="workspace-notice">
                Este consumo está eliminado. Sus deudas no contribuyen a los
                saldos activos. Los pagos se conservan.
              </p>
            )}
            <ExpenseSummary expense={record} detailed references={references} />
            <details className="record-identifier">
              <summary>Enlace e identificador</summary>
              <p>
                Conserva este enlace para volver al consumo, incluso si se
                elimina.
              </p>
              <a href={`#/expenses/${id}`}>Abrir enlace permanente</a>
              <code>{id}</code>
            </details>
            {record.allocations.some(
              (row) => !!row.debt?.repayments.length,
            ) && (
              <p className="workspace-notice">
                Hay pagos registrados. Se pueden corregir detalles, pero cambiar
                el monto de una deuda, sus personas o su fecha requiere
                revisión.
              </p>
            )}
            {failure != null && (
              <ApiFeedback
                error={failure}
                context={operation}
                onRetry={reload}
              />
            )}
            {busy && (
              <LoadingNotice
                text={
                  operation === 'delete'
                    ? 'Confirmando la eliminación…'
                    : 'Restaurando el consumo…'
                }
              />
            )}
            <div className="workspace-actions">
              {record.deletedAt ? (
                <Button onClick={() => void restore()} disabled={busy}>
                  Restaurar consumo
                </Button>
              ) : (
                <>
                  <a
                    data-variant="primary"
                    className={`button${busy ? ' disabled-link' : ''}`}
                    href={`#/expenses/${id}/edit`}
                    aria-disabled={busy}
                    onClick={(event) => {
                      if (busy) event.preventDefault()
                    }}
                  >
                    Editar consumo
                  </a>
                  <Button
                    id="delete-expense-button"
                    variant="ghost"
                    disabled={busy || confirming}
                    onClick={() => {
                      setConfirming(true)
                      requestAnimationFrame(() => confirmPanel.current?.focus())
                    }}
                  >
                    Eliminar consumo
                  </Button>
                </>
              )}
            </div>
            {confirming && (
              <div
                ref={confirmPanel}
                className="delete-confirmation"
                role="group"
                aria-labelledby="delete-question"
                tabIndex={-1}
              >
                <h2 id="delete-question">¿Eliminar este consumo?</h2>
                <p>
                  Dejará de contar en los saldos activos. Sus pagos e historial
                  se conservan y podrás restaurarlo.
                </p>
                <div className="workspace-actions">
                  <Button disabled={busy} onClick={() => void remove()}>
                    Sí, eliminar consumo
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      setConfirming(false)
                      requestAnimationFrame(() =>
                        document
                          .getElementById('delete-expense-button')
                          ?.focus(),
                      )
                    }}
                  >
                    Cancelar eliminación
                  </Button>
                </div>
              </div>
            )}
          </>
        )
      )}
    </section>
  )
}
