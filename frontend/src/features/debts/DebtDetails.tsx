import { useCallback, useState } from 'react'
import type { DebtApi } from '../../api/debts'
import type { FinanceApi } from '../../api/finance'
import type { References } from '../../api/types'
import { LoadingNotice } from '../expenses/ApiFeedback'
import type {
  CreatedReference,
  ReferenceKind,
} from '../expenses/ReferenceEditor'
import { useResource } from '../expenses/useResource'
import {
  DebtFacts,
  DebtFeedback,
  DebtFrame,
  DebtDivider,
  RecordActions,
} from './DebtUi'
import { LoanForm } from './LoanForm'
import { RepaymentForm } from './RepaymentForm'
import { RepaymentHistory } from './RepaymentHistory'
import { formatDebtDate, formatPen } from './debtModel'

export function DebtDetails({
  id,
  route,
  api,
  financeApi,
  references,
  ready,
  onChanged,
  onReferenceCreated,
  onReloadReferences,
}: {
  id: string
  route: string
  api: DebtApi
  financeApi: FinanceApi
  references: References
  ready: boolean
  onChanged: () => void
  onReferenceCreated: (kind: ReferenceKind, record: CreatedReference) => void
  onReloadReferences: () => void
}) {
  const [revision, setRevision] = useState(0)
  const [notice, setNotice] = useState('')
  const loanOnly = route.startsWith('/loans/'),
    editing = route.endsWith('/edit'),
    paying = route.endsWith('/pay')
  const load = useCallback(
    (signal: AbortSignal) => api.get(id, signal, loanOnly),
    [api, id, loanOnly],
  )
  const resource = useResource(`${id}-${revision}`, load)
  const record = resource.data
  function changed() {
    setNotice(
      'Cambio confirmado por el servidor. Los saldos se vuelven a consultar.',
    )
    setRevision((value) => value + 1)
    onChanged()
  }
  // Keep a successful payment receipt mounted; detail balances reload when revisited.
  if (
    editing &&
    record?.origin === 'LOAN' &&
    record.active &&
    !resource.loading &&
    !resource.error
  )
    return (
      <LoanForm
        api={api}
        financeApi={financeApi}
        references={references}
        ready={ready}
        record={record}
        onChanged={onChanged}
        onReferenceCreated={onReferenceCreated}
        onReloadReferences={onReloadReferences}
      />
    )
  return (
    <DebtFrame
      title={
        paying
          ? 'Nuevo pago'
          : route.endsWith('/repayments')
            ? 'Pagos de la deuda'
            : loanOnly
              ? 'Detalle del préstamo'
              : 'Detalle de deuda'
      }
    >
      <a href={loanOnly ? '#/loans' : '#/debts'} className="back-to-history">
        {loanOnly ? 'Volver a préstamos' : 'Volver a deudas'}
      </a>
      {notice && (
        <p role="status" className="form-message confirmation-message">
          {notice}
        </p>
      )}
      {resource.loading ? (
        <LoadingNotice text="Cargando la deuda y su historial…" />
      ) : resource.error ? (
        <DebtFeedback
          error={resource.error}
          onRetry={() => setRevision((value) => value + 1)}
        />
      ) : (
        record && (
          <>
            {paying ? (
              <RepaymentForm api={api} debt={record} onChanged={onChanged} />
            ) : (
              <>
                <DebtFacts record={record} />
                <nav
                  className="workspace-actions"
                  aria-label="Acciones de esta deuda"
                >
                  {record.active && record.status !== 'PAID' && (
                    <a
                      className="button debt-save-button"
                      data-variant="primary"
                      href={`#/debts/${id}/pay`}
                    >
                      Registrar pago
                    </a>
                  )}
                  {record.origin === 'LOAN' && record.active && (
                    <a
                      className="button"
                      data-variant="secondary"
                      href={`#/loans/${id}/edit`}
                    >
                      Editar préstamo
                    </a>
                  )}
                  <a
                    className="button"
                    data-variant="ghost"
                    href={`#/debts/${id}/repayments`}
                  >
                    Ver historial de pagos
                  </a>
                  <a
                    className="button"
                    data-variant="ghost"
                    href={`#/debts/${id}/pay`}
                  >
                    Consultar formulario o envío pendiente
                  </a>
                </nav>
                {record.origin === 'LOAN' && (
                  <RecordActions
                    kind="loan"
                    deleted={!!record.deletedAt}
                    remove={() => api.deleteLoan(id)}
                    restore={() => api.restoreLoan(id)}
                    onChanged={changed}
                  />
                )}
                {!!record.repayments.length && (
                  <p className="workspace-notice">
                    El historial de pagos protege el monto original, las
                    personas y la fecha, incluso si algún pago está eliminado.
                    No se compensan deudas en sentido contrario.
                  </p>
                )}
                <DebtDivider />
                <RepaymentHistory
                  api={api}
                  debt={record}
                  version={revision}
                  onChanged={changed}
                />
              </>
            )}
          </>
        )
      )}
    </DebtFrame>
  )
}

export function RepaymentDetails({
  id,
  api,
  onChanged,
}: {
  id: string
  api: DebtApi
  onChanged: () => void
}) {
  const [revision, setRevision] = useState(0)
  const [notice, setNotice] = useState('')
  const load = useCallback(
    (signal: AbortSignal) => api.getRepayment(id, signal),
    [api, id],
  )
  const resource = useResource(`${id}-${revision}`, load)
  const record = resource.data
  function changed() {
    setNotice(
      'Cambio confirmado por el servidor. Los saldos se vuelven a consultar.',
    )
    setRevision((value) => value + 1)
    onChanged()
  }
  return (
    <DebtFrame title="Detalle del pago">
      <a
        href={record ? `#/debts/${record.debtId}/repayments` : '#/repayments'}
        className="back-to-history"
      >
        Volver al historial de pagos
      </a>
      {notice && (
        <p role="status" className="form-message confirmation-message">
          {notice}
        </p>
      )}
      {resource.loading ? (
        <LoadingNotice text="Cargando el pago…" />
      ) : resource.error ? (
        <DebtFeedback
          error={resource.error}
          onRetry={() => setRevision((value) => value + 1)}
        />
      ) : (
        record && (
          <>
            <h2 className="debt-section-title">{formatPen(record.amount)}</h2>
            <dl className="record-facts">
              <div>
                <dt>Fecha del pago</dt>
                <dd>{formatDebtDate(record.paidOn)}</dd>
              </div>
              <div>
                <dt>Estado</dt>
                <dd>
                  {record.deletedAt
                    ? 'Eliminado'
                    : record.active
                      ? 'Activo'
                      : 'Inactivo por la deuda o su origen'}
                </dd>
              </div>
              <div>
                <dt>Descripción</dt>
                <dd>{record.description || 'Sin descripción'}</dd>
              </div>
            </dl>
            <RecordActions
              kind="payment"
              deleted={!!record.deletedAt}
              canRestore={record.debt.active}
              remove={() => api.deleteRepayment(id)}
              restore={() => api.restoreRepayment(id)}
              onChanged={changed}
            />
            <DebtDivider />
            <DebtFacts record={{ ...record.debt, repayments: [] }} />
            <a
              className="button"
              data-variant="secondary"
              href={`#/debts/${record.debtId}`}
            >
              Ver deuda y saldo actual
            </a>
          </>
        )
      )}
    </DebtFrame>
  )
}
