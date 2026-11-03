import { useId } from 'react'
import type { SpendingReport } from '../../api/analytics'
import { formatPen } from '../debts/debtModel'
import {
  barHeight,
  barPercent,
  maximumAmount,
  monthLabel,
} from './dashboardModel'

export function CategoryChart({
  categories,
}: {
  categories: SpendingReport['categories']
}) {
  const id = useId(),
    maximum = maximumAmount(categories.map((row) => row.amount))
  return (
    <section className="dashboard-section" aria-labelledby={id}>
      <h2 id={id}>¿En qué se fue?</h2>
      <p className="dashboard-caption">
        Gasto atribuido por categoría, en el período seleccionado.
      </p>
      {categories.length ? (
        <>
          <ul className="category-bars">
            {categories.slice(0, 8).map((row) => (
              <li key={row.category.id}>
                <div>
                  <span>{row.category.name}</span>
                  <strong>{formatPen(row.amount)}</strong>
                </div>
                <div className="category-track" aria-hidden="true">
                  <span style={{ width: barPercent(row.amount, maximum) }} />
                </div>
              </li>
            ))}
          </ul>
          {categories.length > 8 && (
            <details className="dashboard-data">
              <summary>Ver las {categories.length} categorías</summary>
              <dl>
                {categories.map((row) => (
                  <div key={row.category.id}>
                    <dt>{row.category.name}</dt>
                    <dd>{formatPen(row.amount)}</dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
        </>
      ) : (
        <p className="dashboard-empty">
          Todavía no hay gasto atribuido por categoría en este período.
        </p>
      )}
    </section>
  )
}
export function MonthlyChart({
  monthly,
  period,
}: {
  monthly: SpendingReport['monthly']
  period: SpendingReport['period']
}) {
  const id = useId(),
    maximum = maximumAmount(monthly.map((row) => row.amount))
  return (
    <section className="dashboard-section" aria-labelledby={id}>
      <h2 id={id}>Mes a mes</h2>
      <p className="dashboard-caption">
        Del {period.from.split('-').reverse().join('/')} al{' '}
        {period.to.split('-').reverse().join('/')}. Cada barra representa gasto
        atribuido; el último mes puede estar incompleto.
      </p>
      {maximum === '0.00' ? (
        <p className="dashboard-empty">
          No hay gasto atribuido en estos meses. Los meses sin consumos tienen
          un total de cero.
        </p>
      ) : (
        <div
          className="trend-scroll"
          tabIndex={0}
          role="region"
          aria-label="Gráfico mensual con desplazamiento horizontal"
        >
          <div
            className="monthly-bars"
            role="img"
            aria-label="Evolución mensual del gasto. Los montos exactos están en el desglose por mes."
          >
            {monthly.map((row) => (
              <div
                key={row.month}
                className="monthly-column"
                aria-hidden="true"
              >
                <div className="monthly-bar-area">
                  <span
                    className="monthly-bar"
                    style={{
                      height: `${barHeight(row.amount, maximum)}px`,
                      visibility: row.amount === '0.00' ? 'hidden' : 'visible',
                    }}
                  />
                </div>
                <span>{monthLabel(row.month, true)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {maximum !== '0.00' && (
        <p className="field-hint">
          Desliza el gráfico si no caben todos los meses. El desglose incluye
          los montos exactos.
        </p>
      )}
      <details className="dashboard-data">
        <summary>Ver montos exactos por mes</summary>
        <dl>
          {monthly.map((row) => (
            <div key={row.month}>
              <dt>{monthLabel(row.month)}</dt>
              <dd>{formatPen(row.amount)}</dd>
            </div>
          ))}
        </dl>
      </details>
    </section>
  )
}
export function SpendingDistribution({
  totals,
}: {
  totals: SpendingReport['totals']
}) {
  return (
    <div className="spending-distribution">
      <div className="distribution-track" aria-hidden="true">
        <span
          style={{ width: barPercent(totals.personalAmount, totals.amount) }}
        />
        <span
          style={{ width: barPercent(totals.sharedAmount, totals.amount) }}
        />
      </div>
      <dl>
        <div>
          <dt>Personal</dt>
          <dd>{formatPen(totals.personalAmount)}</dd>
        </div>
        <div>
          <dt>Compartido</dt>
          <dd>{formatPen(totals.sharedAmount)}</dd>
        </div>
      </dl>
    </div>
  )
}
