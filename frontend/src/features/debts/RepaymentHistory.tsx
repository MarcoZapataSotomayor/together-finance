import { useCallback, useId, useState } from 'react'
import type { DebtApi, DebtRecord } from '../../api/debts'
import { Button } from '../../components/ui/Button'
import { SelectField } from '../../components/ui/FormField'
import { LoadingNotice } from '../expenses/ApiFeedback'
import { useResource } from '../expenses/useResource'
import { formatDebtDate, formatPen } from './debtModel'
import { DebtFeedback, RecordActions } from './DebtUi'

export function RepaymentHistory({
  api,
  debt,
  version,
  onChanged,
}: {
  api: DebtApi
  debt: DebtRecord
  version: number
  onChanged: () => void
}) {
  const [state, setState] = useState<'all' | 'active' | 'deleted'>('all'),
    [number, setNumber] = useState(1),
    [retry, setRetry] = useState(0)
  const prefix = useId()
  const load = useCallback(
    (signal: AbortSignal) => api.repayments(debt.id, state, number, 20, signal),
    [api, debt.id, state, number],
  )
  const result = useResource(
    `${debt.id}-${state}-${number}-${version}-${retry}`,
    load,
  )
  const pages = Math.max(1, Math.ceil((result.data?.total ?? 0) / 20))
  return (
    <section
      className="debt-payment-history"
      aria-labelledby={`${prefix}-title`}
    >
      <h2 className="debt-section-title" id={`${prefix}-title`}>
        Historial de pagos
      </h2>
      <SelectField
        id={`${prefix}-state`}
        label="Pagos que quieres ver"
        value={state}
        onChange={(event) => {
          setState(event.target.value as typeof state)
          setNumber(1)
        }}
      >
        <option value="all">Todo el historial</option>
        <option value="active">Activos</option>
        <option value="deleted">Eliminados o inactivos</option>
      </SelectField>
      {result.loading ? (
        <LoadingNotice text="Cargando los pagos…" />
      ) : result.error ? (
        <DebtFeedback
          error={result.error}
          onRetry={() => setRetry((value) => value + 1)}
        />
      ) : (
        result.data && (
          <>
            {result.data.data.length ? (
              <ol className="debt-list">
                {result.data.data.map((row) => (
                  <li key={row.id}>
                    <article>
                      <h3>
                        <a href={`#/repayments/${row.id}`}>
                          {formatPen(row.amount)} · {formatDebtDate(row.paidOn)}
                        </a>
                      </h3>
                      <p>
                        {row.deletedAt
                          ? 'Pago eliminado'
                          : row.active
                            ? 'Pago activo'
                            : 'Pago inactivo por su deuda u origen'}
                      </p>
                      <p className="debt-description">
                        {row.description || 'Sin descripción'}
                      </p>
                      <a
                        className="back-to-history"
                        href={`#/repayments/${row.id}`}
                      >
                        Ver detalle del pago
                      </a>
                      <RecordActions
                        kind="payment"
                        deleted={!!row.deletedAt}
                        canRestore={debt.active}
                        remove={() => api.deleteRepayment(row.id)}
                        restore={() => api.restoreRepayment(row.id)}
                        onChanged={onChanged}
                      />
                    </article>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="workspace-notice">
                {number > 1
                  ? 'Esta página ya no tiene pagos. Vuelve a la anterior.'
                  : 'No hay pagos en esta vista. El historial conservará también los pagos eliminados.'}
              </p>
            )}
            <nav
              className="history-pagination"
              aria-label="Páginas del historial de pagos"
            >
              <Button
                variant="ghost"
                disabled={number === 1}
                onClick={() => setNumber((value) => value - 1)}
              >
                Anterior
              </Button>
              <span>
                Página {number} de {pages}
              </span>
              <Button
                variant="ghost"
                disabled={number >= pages}
                onClick={() => setNumber((value) => value + 1)}
              >
                Siguiente
              </Button>
            </nav>
          </>
        )
      )}
    </section>
  )
}
