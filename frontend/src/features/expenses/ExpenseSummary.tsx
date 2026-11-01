import type { ExpenseRecord, References } from '../../api/types'
import { debtLabels, methodLabels } from '../../api/types'
import { penFormatter } from './expenseModel'

const formatDate = (date: string) =>
  new Intl.DateTimeFormat('es-PE', {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`))
export function ExpenseSummary({
  expense,
  detailed = false,
  references,
}: {
  expense: ExpenseRecord
  detailed?: boolean
  references?: References
}) {
  const allocations = detailed
    ? expense.allocations
    : expense.allocations.filter((row) =>
        expense.deletedAt ? !row.deletedAt : row.active,
      )
  const name = (id: string) =>
    references?.people.find((row) => row.id === id)?.name ??
    (expense.fundedBy.id === id
      ? expense.fundedBy.name
      : (expense.allocations.find((row) => row.personId === id)?.person.name ??
        'Persona no disponible'))
  return (
    <>
      <div className="expense-record-head">
        <div>
          <p className="record-classification">
            {expense.classification === 'PERSONAL' ? 'Personal' : 'Compartido'}
            {expense.deletedAt ? ' · Eliminado' : ''}
          </p>
          <h2>{expense.merchant}</h2>
        </div>
        <strong className="record-amount">
          {penFormatter.format(Number(expense.amount))}
        </strong>
      </div>
      <dl className="record-facts">
        <div>
          <dt>Fecha</dt>
          <dd>{formatDate(expense.purchasedOn)}</dd>
        </div>
        <div>
          <dt>Categoría</dt>
          <dd>{expense.category.name}</dd>
        </div>
        <div>
          <dt>Aporta el dinero</dt>
          <dd>{expense.fundedBy.name}</dd>
        </div>
        {detailed && (
          <>
            <div>
              <dt>Medio de pago</dt>
              <dd>
                {expense.paymentMethod.name} ·{' '}
                {methodLabels[expense.paymentMethod.type]}
              </dd>
            </div>
            <div>
              <dt>Descripción</dt>
              <dd>{expense.description || 'Sin descripción'}</dd>
            </div>
          </>
        )}
      </dl>
      <ul className="record-shares" aria-label="Reparto financiero">
        {allocations.map((row) => (
          <li key={row.id}>
            <div>
              <span>
                {row.person.name}
                {!row.active ? ' (retirado o inactivo)' : ''}
              </span>
              <strong>{penFormatter.format(Number(row.amount))}</strong>
              <small>
                {Number(row.percentage).toLocaleString('es-PE', {
                  maximumFractionDigits: 4,
                })}{' '}
                %
              </small>
            </div>
            {detailed && row.debt && (
              <div className="record-debt">
                <p>
                  {name(row.debt.debtorPersonId)} debe a{' '}
                  {name(row.debt.creditorPersonId)} ·{' '}
                  {debtLabels[row.debt.status]}
                </p>
                <dl>
                  <div>
                    <dt>Deuda original</dt>
                    <dd>
                      {penFormatter.format(Number(row.debt.originalAmount))}
                    </dd>
                  </div>
                  <div>
                    <dt>Pendiente activo</dt>
                    <dd>
                      {penFormatter.format(Number(row.debt.outstandingAmount))}
                    </dd>
                  </div>
                  <div>
                    <dt>Desde</dt>
                    <dd>{formatDate(row.debt.incurredOn)}</dd>
                  </div>
                </dl>
                {row.debt.repayments.length > 0 && (
                  <details>
                    <summary>
                      Ver pagos registrados ({row.debt.repayments.length})
                    </summary>
                    <ul>
                      {row.debt.repayments.map((payment) => (
                        <li key={payment.id}>
                          {formatDate(payment.paidOn)} ·{' '}
                          {penFormatter.format(Number(payment.amount))}
                          {!payment.active ? ' · Inactivo' : ''}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  )
}
