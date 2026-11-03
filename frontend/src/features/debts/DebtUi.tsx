import { useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { debtError } from './debtErrors'
import type { DebtRecord, DebtTotals } from '../../api/debts'
import { debtLabels } from '../../api/types'
import {
  FrameOrnaments,
  OrnamentalDivider,
} from '../../components/decorations/Ornaments'
import { Button } from '../../components/ui/Button'
import { ConfirmedMark } from '../../components/ui/ConfirmedMark'
import { Badge } from '../../components/ui/Badge'
import { ApiFeedback, LoadingNotice } from '../expenses/ApiFeedback'
import { ExpenseFrameTitle } from '../expenses/ExpenseFrameTitle'
import { formatDebtDate, formatPen } from './debtModel'

export function DebtFrame({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  const id = useId()
  return (
    <section
      className="consumption-frame history-frame debt-frame"
      aria-labelledby={id}
    >
      <FrameOrnaments />
      <ExpenseFrameTitle title={title} id={id} />
      {children}
    </section>
  )
}
export function DebtFeedback({
  error,
  operation,
  onRetry,
}: {
  error: unknown
  operation?: string
  onRetry?: () => void
}) {
  return (
    <ApiFeedback
      error={error}
      errorMessage={debtError(error, operation)}
      onRetry={onRetry}
    />
  )
}
export function DebtBadges({ record }: { record: DebtRecord }) {
  return (
    <div className="debt-badges">
      <Badge tone={record.origin === 'LOAN' ? 'info' : 'neutral'}>
        {record.origin === 'LOAN' ? 'Préstamo independiente' : 'Consumo'}
      </Badge>
      <Badge
        tone={
          record.status === 'PAID'
            ? 'success'
            : record.active
              ? 'warning'
              : 'neutral'
        }
      >
        {debtLabels[record.status]}
      </Badge>
    </div>
  )
}
export function DebtBalances({
  record,
}: {
  record: Pick<
    DebtRecord,
    'originalAmount' | 'repaidAmount' | 'outstandingAmount'
  >
}) {
  return (
    <dl className="debt-balances">
      <div>
        <dt>Deuda original</dt>
        <dd>{formatPen(record.originalAmount)}</dd>
      </div>
      <div>
        <dt>Pagado activo</dt>
        <dd>{formatPen(record.repaidAmount)}</dd>
      </div>
      <div>
        <dt>Pendiente activo</dt>
        <dd>{formatPen(record.outstandingAmount)}</dd>
      </div>
    </dl>
  )
}
export function DebtFacts({ record }: { record: DebtRecord }) {
  return (
    <>
      <DebtBadges record={record} />
      <h2 className="debt-parties">
        {record.debtor.name} debe a {record.creditor.name}
      </h2>
      <DebtBalances record={record} />
      <dl className="record-facts">
        <div>
          <dt>Fecha de la deuda</dt>
          <dd>{formatDebtDate(record.incurredOn)}</dd>
        </div>
        <div>
          <dt>Vencimiento</dt>
          <dd>
            {record.dueOn ? formatDebtDate(record.dueOn) : 'Sin vencimiento'}
          </dd>
        </div>
        <div>
          <dt>Descripción</dt>
          <dd>{record.description || 'Sin descripción'}</dd>
        </div>
      </dl>
      {record.source && (
        <p className="debt-source">
          Nació del consumo{' '}
          <a href={`#/expenses/${record.source.expenseId}`}>
            {record.source.merchant}
          </a>
          . Su reparto y sus personas se corrigen desde el consumo.
        </p>
      )}
      {!record.active && (
        <p className="workspace-notice">
          Registro inactivo: no contribuye a los saldos activos. Conserva su
          deuda original y su historial de pagos.
          {record.source &&
            ' Revisa el consumo de origen para restaurar su cadena de registros.'}
        </p>
      )}
    </>
  )
}
export function SummaryTotals({
  totals,
  label,
}: {
  totals: DebtTotals
  label: string
}) {
  return (
    <div className="debt-total-strip">
      <h3>{label}</h3>
      <strong>{formatPen(totals.outstandingAmount)}</strong>
      <p>
        {totals.pendingCount} pendientes · {totals.settledCount} saldadas
        {totals.inactiveCount > 0 ? ` · ${totals.inactiveCount} inactivas` : ''}
      </p>
    </div>
  )
}
export function DebtDivider() {
  return <OrnamentalDivider />
}

export function RecordActions({
  kind,
  deleted,
  canRestore = true,
  remove,
  restore,
  onChanged,
}: {
  kind: 'loan' | 'payment'
  deleted: boolean
  canRestore?: boolean
  remove: () => Promise<void>
  restore: () => Promise<unknown>
  onChanged: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [notice, setNotice] = useState('')
  const lock = useRef(false),
    panel = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null)
  const id = useId(),
    label = kind === 'loan' ? 'préstamo' : 'pago'
  async function execute(restoring: boolean) {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError(null)
    setNotice('')
    try {
      if (restoring) await restore()
      else await remove()
      setConfirming(false)
      setNotice(
        `${kind === 'loan' ? 'Préstamo' : 'Pago'} ${restoring ? 'restaurado' : 'eliminado'}. Cambio confirmado por el servidor.`,
      )
      onChanged()
    } catch (failure) {
      setError(failure)
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  return (
    <div className="debt-record-actions">
      {notice && (
        <p className="form-message confirmation-message" role="status">
          <ConfirmedMark />
          {notice}
        </p>
      )}
      {error != null && (
        <DebtFeedback
          error={error}
          operation={
            deleted ? 'restore' : kind === 'payment' ? 'payment' : 'edit'
          }
          onRetry={onChanged}
        />
      )}
      {busy && <LoadingNotice text={`Confirmando el cambio del ${label}…`} />}
      {deleted ? (
        <>
          <Button
            onClick={() => void execute(true)}
            disabled={busy || !canRestore}
          >
            Restaurar {label}
          </Button>
          {!canRestore && (
            <p className="field-hint">
              Primero restaura la deuda o su consumo de origen.
            </p>
          )}
        </>
      ) : (
        <Button
          ref={trigger}
          variant="ghost"
          disabled={busy || confirming}
          onClick={() => {
            setConfirming(true)
            requestAnimationFrame(() => panel.current?.focus())
          }}
        >
          Eliminar {label}
        </Button>
      )}
      {confirming && (
        <div
          ref={panel}
          className="delete-confirmation"
          role="group"
          aria-labelledby={id}
          tabIndex={-1}
          onKeyDown={event => {
            if (event.key === 'Escape' && !busy) {
              event.preventDefault()
              setConfirming(false)
              requestAnimationFrame(() => trigger.current?.focus())
            }
          }}
        >
          <h3 id={id}>¿Eliminar este {label}?</h3>
          <p>
            {kind === 'loan'
              ? 'Dejará de contribuir a los saldos activos. Sus pagos e historial se conservarán.'
              : 'Se conservará el historial, pero este pago dejará de reducir la deuda activa.'}{' '}
            Podrás restaurarlo si las reglas financieras lo permiten.
          </p>
          <div className="workspace-actions">
            <Button disabled={busy} onClick={() => void execute(false)}>
              Sí, eliminar {label}
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setConfirming(false)
                requestAnimationFrame(() => trigger.current?.focus())
              }}
            >
              Cancelar eliminación
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
