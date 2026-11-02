import { useCallback, useId, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ApiError } from '../../api/client'
import { createAnalyticsApi } from '../../api/analytics'
import type {
  AnalyticsApi,
  SpendingFilters,
  SpendingReport,
} from '../../api/analytics'
import type { DebtSummary } from '../../api/debts'
import { useAuth } from '../../auth/useAuth'
import { Button } from '../../components/ui/Button'
import { SelectField, TextField } from '../../components/ui/FormField'
import { OrnamentalDivider } from '../../components/decorations/Ornaments'
import { usePov } from '../../theme/usePov'
import { themes } from '../../theme/themes'
import type { Pov } from '../../theme/themes'
import { ApiFeedback, LoadingNotice } from '../expenses/ApiFeedback'
import { localDate } from '../expenses/expenseModel'
import { useResource } from '../expenses/useResource'
import { useDebtDrafts } from '../debts/DebtDraftContext'
import { DebtFrame } from '../debts/DebtUi'
import { formatDebtDate, formatPen, resolvePovPerson } from '../debts/debtModel'
import { useDebtApi } from '../debts/useDebtApi'
import {
  CategoryChart,
  MonthlyChart,
  SpendingDistribution,
} from './SpendingCharts'
import {
  monthLabel,
  monthRange,
  trendRange,
  validatePeriod,
} from './dashboardModel'

function AnalyticsFeedback({
  error,
  onRetry,
}: {
  error: unknown
  onRetry: () => void
}) {
  const message =
    error instanceof ApiError && error.status === 400
      ? 'Revisa el período y la persona seleccionada. Usa fechas válidas dentro de 24 meses calendario.'
      : error instanceof ApiError && error.status === 409
        ? 'Los repartos de algún consumo necesitan revisión. No mostramos totales parciales; revisa los consumos antes de actualizar el resumen.'
        : error instanceof ApiError && error.status === 401
          ? 'Tu sesión terminó. Ingresa de nuevo para consultar el resumen.'
          : error instanceof ApiError && error.status === 403
            ? 'No pudimos verificar el acceso. Revalida la sesión y vuelve a cargar el resumen.'
            : 'No pudimos cargar el resumen. El servidor puede estar despertando o la conexión falló. Vuelve a intentarlo; no se modificó ningún registro.'
  return <ApiFeedback error={error} errorMessage={message} onRetry={onRetry} />
}

function CurrentDebts({
  summary,
  personId,
}: {
  summary: DebtSummary
  personId: string
}) {
  const selected = summary.byPerson.find((row) => row.person.id === personId)
  const rows = personId
    ? summary.byPerson.filter((row) => row.person.id === personId)
    : summary.byPerson
  return (
    <section
      className="dashboard-section dashboard-obligations"
      aria-labelledby="dashboard-debts-title"
    >
      <h2 id="dashboard-debts-title">Compromisos pendientes</h2>
      <p className="dashboard-caption">
        Deudas vigentes de todas las fechas, con los pagos activos descontados.
        Son obligaciones, no gasto adicional. Las direcciones no se compensan.
      </p>
      {personId ? (
        <dl className="dashboard-direction-totals">
          <div>
            <dt>Debe pagar</dt>
            <dd>{formatPen(selected?.owed.outstandingAmount ?? '0.00')}</dd>
          </div>
          <div>
            <dt>Le deben pagar</dt>
            <dd>
              {formatPen(selected?.receivable.outstandingAmount ?? '0.00')}
            </dd>
          </div>
        </dl>
      ) : (
        <dl className="dashboard-direction-totals">
          <div>
            <dt>Pendiente total entre personas</dt>
            <dd>{formatPen(summary.totals.outstandingAmount)}</dd>
          </div>
        </dl>
      )}
      {rows.length ? (
        <dl className="dashboard-person-ledger">
          {rows.map((row) => (
            <div key={row.person.id}>
              <dt>{row.person.name}</dt>
              <dd>
                <span>Debe</span>
                <strong>{formatPen(row.owed.outstandingAmount)}</strong>
              </dd>
              <dd>
                <span>Le deben</span>
                <strong>{formatPen(row.receivable.outstandingAmount)}</strong>
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="dashboard-empty">
          No hay obligaciones registradas para esta vista.
        </p>
      )}
      <a className="button" data-variant="secondary" href="#/debts">
        Ver deudas y pagos
      </a>
    </section>
  )
}

function DashboardScope({
  api,
  base,
  period,
  version,
  debtResource,
  refresh,
  override,
  setOverride,
}: {
  api: AnalyticsApi
  base: SpendingReport
  period: SpendingFilters
  version: number
  debtResource: { loading: boolean; data?: DebtSummary; error?: unknown }
  refresh: () => void
  override: string | null
  setOverride: (id: string | null) => void
}) {
  const { pov } = usePov(),
    drafts = useDebtDrafts(),
    id = useId()
  const resolved = resolvePovPerson(pov, base.people, drafts.mappings[pov])
  const personId = override ?? resolved?.id ?? ''
  const selected = base.people.find((row) => row.id === personId)
  const unresolved = pov !== 'shared' && !resolved && override === null
  const filters = useMemo(
    () => ({ ...period, ...(personId ? { personId } : {}) }),
    [period, personId],
  )
  const load = useCallback(
    (signal: AbortSignal) => api.spending(filters, signal),
    [api, filters],
  )
  const result = useResource(
    `scope-${JSON.stringify(filters)}-${version}`,
    load,
    !!personId && !unresolved,
  )
  const report = personId ? result.data : base
  const trendFilters = useMemo(() => trendRange(filters), [filters])
  const needsTrend = trendFilters.from !== filters.from
  const loadTrend = useCallback(
    (signal: AbortSignal) => api.spending(trendFilters, signal),
    [api, trendFilters],
  )
  const trend = useResource(
    `trend-${JSON.stringify(trendFilters)}-${version}`,
    loadTrend,
    needsTrend && !unresolved,
  )
  const monthly = needsTrend ? trend.data : report
  return (
    <>
      <div className="dashboard-scope" role="status">
        <p>
          Perspectiva: <strong>{themes[pov].label}</strong>.{' '}
          {unresolved
            ? 'Asocia una persona a esta perspectiva o elige explícitamente todas las personas.'
            : selected
              ? `Gasto atribuido a ${selected.name}, según sus repartos.`
              : 'Gasto conjunto: cada consumo se cuenta una sola vez.'}{' '}
        </p>
      </div>
      <details
        className="dashboard-scope-options"
        open={unresolved || undefined}
      >
        <summary>
          {selected ? selected.name : 'Todas las personas'} · Cambiar vista
        </summary>
        <div className="dashboard-view-controls">
          <SelectField
            id={`${id}-person`}
            label="Persona del resumen"
            value={unresolved ? 'unresolved' : personId}
            onChange={(event) => setOverride(event.target.value)}
          >
            {unresolved && (
              <option value="unresolved" disabled>
                Selecciona la persona o toda la vista
              </option>
            )}
            <option value="">Todas las personas</option>
            {base.people.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
                {!row.isActive ? ' (inactivo)' : ''}
              </option>
            ))}
          </SelectField>
          {pov !== 'shared' && (
            <details className="dashboard-data" open={unresolved || undefined}>
              <summary>Persona asociada a {themes[pov].label}</summary>
              <SelectField
                id={`${id}-mapping`}
                label={`Persona para la perspectiva ${themes[pov].label}`}
                value={resolved?.id ?? ''}
                onChange={(event) => {
                  drafts.mapPerson(pov, event.target.value)
                  setOverride(null)
                }}
              >
                <option value="">Selecciona una persona</option>
                {base.people.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </SelectField>
              <p className="field-hint">
                Solo cambia el filtro de lectura. No es una identidad ni un
                permiso.
              </p>
            </details>
          )}
        </div>
        <p className="field-hint">
          Esta selección solo filtra la lectura; no asigna personas a tus
          formularios.
        </p>
      </details>
      {unresolved ? (
        <div className="workspace-empty">
          <h2>Elige una persona para continuar</h2>
          <p>
            No elegimos registros por aproximación. Puedes crear personas desde
            Nuevo consumo o Nuevo préstamo.
          </p>
        </div>
      ) : (
        <>
          {personId && result.loading ? (
            <LoadingNotice text="Cargando el gasto atribuido…" />
          ) : personId && result.error ? (
            <AnalyticsFeedback error={result.error} onRetry={refresh} />
          ) : (
            report && (
              <>
                <section
                  className="dashboard-spending"
                  aria-labelledby="dashboard-spending-title"
                >
                  <div>
                    <h2 id="dashboard-spending-title">
                      Gasto {selected ? 'atribuido' : 'conjunto'} del período
                    </h2>
                    <p>
                      {formatDebtDate(period.from)} —{' '}
                      {formatDebtDate(period.to)}
                    </p>
                    <strong className="dashboard-spending-amount">
                      {formatPen(report.totals.amount)}
                    </strong>
                    <p className="dashboard-caption">
                      {report.totals.expenseCount} consumos{' '}
                      {selected
                        ? 'con una parte atribuida a esta persona'
                        : 'contados una sola vez'}
                    </p>
                  </div>
                  <div>
                    <h3>Personal y compartido</h3>
                    <SpendingDistribution totals={report.totals} />
                  </div>
                </section>
                {report.totals.expenseCount === 0 && (
                  <p className="workspace-notice">
                    No hay gasto atribuido en este período. Puedes cambiar las
                    fechas o registrar un consumo. Los aportes para otras
                    personas se muestran aparte.
                  </p>
                )}
                <section
                  className="dashboard-section"
                  aria-labelledby="dashboard-contributions-title"
                >
                  <h2 id="dashboard-contributions-title">
                    Responsabilidad y aportes
                  </h2>
                  <p className="dashboard-caption">
                    «Le corresponde» viene del reparto. «Aportó el dinero» viene
                    de quién financió el consumo; puede haber aportado para otra
                    persona.
                  </p>
                  <dl className="dashboard-person-ledger">
                    {report.byPerson.map((row) => (
                      <div key={row.person.id}>
                        <dt>{row.person.name}</dt>
                        <dd>
                          <span>Le corresponde</span>
                          <strong>{formatPen(row.allocatedAmount)}</strong>
                        </dd>
                        <dd>
                          <span>Aportó el dinero</span>
                          <strong>{formatPen(row.fundedAmount)}</strong>
                        </dd>
                      </div>
                    ))}
                  </dl>
                  {!report.byPerson.length && (
                    <p className="dashboard-empty">
                      Sin repartos ni aportes en estas fechas.
                    </p>
                  )}
                </section>
                <OrnamentalDivider />
                <div className="dashboard-chart-grid">
                  <CategoryChart categories={report.categories} />
                  {needsTrend && trend.loading ? (
                    <LoadingNotice text="Cargando la evolución mensual…" />
                  ) : needsTrend && trend.error ? (
                    <AnalyticsFeedback error={trend.error} onRetry={refresh} />
                  ) : (
                    monthly && (
                      <MonthlyChart
                        monthly={monthly.monthly}
                        period={monthly.period}
                      />
                    )
                  )}
                </div>
                <section
                  className="dashboard-section"
                  aria-labelledby="dashboard-recent-title"
                >
                  <h2 id="dashboard-recent-title">
                    Últimos consumos del período
                  </h2>
                  {report.recentExpenses.length ? (
                    <ol className="dashboard-recent">
                      {report.recentExpenses.map((row) => (
                        <li key={row.id}>
                          <div>
                            <a href={`#/expenses/${row.id}`}>{row.merchant}</a>
                            <p>
                              {formatDebtDate(row.purchasedOn)} ·{' '}
                              {row.category.name} ·{' '}
                              {row.classification === 'SHARED'
                                ? 'Compartido'
                                : 'Personal'}
                            </p>
                            <p>Aportó el dinero: {row.fundedBy.name}</p>
                          </div>
                          <dl>
                            <div>
                              <dt>
                                {selected
                                  ? 'Parte atribuida'
                                  : 'Monto del consumo'}
                              </dt>
                              <dd>{formatPen(row.attributedAmount)}</dd>
                            </div>
                            {selected && (
                              <div>
                                <dt>Consumo completo</dt>
                                <dd>{formatPen(row.expenseAmount)}</dd>
                              </div>
                            )}
                          </dl>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="dashboard-empty">
                      Aún no hay consumos para mostrar en esta vista.
                    </p>
                  )}
                  <a className="button" data-variant="ghost" href="#/expenses">
                    Ver historial de consumos
                  </a>
                </section>
              </>
            )
          )}
          <OrnamentalDivider />
          {debtResource.loading ? (
            <LoadingNotice text="Cargando las obligaciones vigentes…" />
          ) : debtResource.error ? (
            <AnalyticsFeedback error={debtResource.error} onRetry={refresh} />
          ) : (
            debtResource.data && (
              <CurrentDebts summary={debtResource.data} personId={personId} />
            )
          )}
        </>
      )}
    </>
  )
}

export function Dashboard({ version }: { version: number }) {
  const { expireSession } = useAuth(),
    { pov } = usePov(),
    debtApi = useDebtApi()
  const api = useMemo(
    () =>
      createAnalyticsApi(import.meta.env.VITE_API_URL || '/api', expireSession),
    [expireSession],
  )
  const currentMonth = localDate().slice(0, 7)
  const [month, setMonth] = useState(currentMonth),
    [mode, setMode] = useState('month')
  const [period, setPeriod] = useState<SpendingFilters>(() =>
    monthRange(currentMonth),
  )
  const [from, setFrom] = useState(period.from),
    [to, setTo] = useState(period.to)
  const [error, setError] = useState(''),
    [retry, setRetry] = useState(0)
  const [overrides, setOverrides] = useState<Record<Pov, string | null>>({
    antonella: null,
    marco: null,
    shared: null,
  })
  const id = useId(),
    form = useRef<HTMLFormElement>(null)
  const load = useCallback(
    (signal: AbortSignal) => api.spending(period, signal),
    [api, period],
  )
  const resource = useResource(
    `dashboard-${JSON.stringify(period)}-${version}-${retry}`,
    load,
  )
  const loadDebts = useCallback(
    (signal: AbortSignal) => debtApi.summary({}, signal),
    [debtApi],
  )
  const debts = useResource(`dashboard-debts-${version}-${retry}`, loadDebts)
  function apply(event: FormEvent) {
    event.preventDefault()
    let next: SpendingFilters
    try {
      next = mode === 'month' ? monthRange(month) : { from, to }
    } catch {
      setError('Selecciona un mes válido.')
      requestAnimationFrame(() =>
        form.current
          ?.querySelector<HTMLElement>('[aria-invalid="true"]')
          ?.focus(),
      )
      return
    }
    const failure = validatePeriod(next.from, next.to)
    setError(failure)
    if (failure) {
      requestAnimationFrame(() =>
        form.current
          ?.querySelector<HTMLElement>('[aria-invalid="true"]')
          ?.focus(),
      )
      return
    }
    setPeriod(next)
  }
  return (
    <div className="dashboard">
      <DebtFrame title="Nuestro resumen">
        <div className="dashboard-heading">
          <p>
            Gastos, repartos y compromisos, en un mismo lugar. Todo en soles.
          </p>
        </div>
        <details className="dashboard-period">
          <summary>
            {period.from.slice(0, 7) === period.to.slice(0, 7)
              ? monthLabel(period.from.slice(0, 7))
              : `${formatDebtDate(period.from)} — ${formatDebtDate(period.to)}`}{' '}
            · Cambiar período
          </summary>
          <form ref={form} onSubmit={apply} noValidate>
            <div className="filter-grid">
              <SelectField
                id={`${id}-mode`}
                label="Cómo elegir el período"
                value={mode}
                onChange={(event) => {
                  setMode(event.target.value)
                  setError('')
                }}
              >
                <option value="month">Un mes</option>
                <option value="range">Rango de fechas</option>
              </SelectField>
              {mode === 'month' ? (
                <TextField
                  id={`${id}-month`}
                  label="Mes"
                  type="month"
                  min="0001-01"
                  max="9999-12"
                  required
                  value={month}
                  error={error || undefined}
                  onChange={(event) => setMonth(event.target.value)}
                />
              ) : (
                <>
                  <TextField
                    id={`${id}-from`}
                    label="Desde"
                    type="date"
                    min="0001-01-01"
                    max="9999-12-31"
                    required
                    value={from}
                    error={error || undefined}
                    onChange={(event) => setFrom(event.target.value)}
                  />
                  <TextField
                    id={`${id}-to`}
                    label="Hasta"
                    type="date"
                    min="0001-01-01"
                    max="9999-12-31"
                    required
                    value={to}
                    onChange={(event) => setTo(event.target.value)}
                  />
                </>
              )}
            </div>
            <div className="workspace-actions">
              <Button type="submit">Aplicar período</Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setMonth(currentMonth)
                  setMode('month')
                  setPeriod(monthRange(currentMonth))
                  setError('')
                }}
              >
                Este mes
              </Button>
            </div>
          </form>
        </details>
        <div className="workspace-actions dashboard-refresh">
          <a
            href="#/expenses/new"
            className="button debt-save-button"
            data-variant="primary"
          >
            Nuevo consumo
          </a>
          <Button
            variant="ghost"
            onClick={() => setRetry((value) => value + 1)}
          >
            Actualizar resumen
          </Button>
        </div>
        {resource.loading ? (
          <LoadingNotice text="Cargando el resumen financiero…" />
        ) : resource.error ? (
          <AnalyticsFeedback
            error={resource.error}
            onRetry={() => setRetry((value) => value + 1)}
          />
        ) : (
          resource.data && (
            <DashboardScope
              key={pov}
              api={api}
              base={resource.data}
              period={period}
              version={version + retry}
              debtResource={debts}
              refresh={() => setRetry((value) => value + 1)}
              override={overrides[pov]}
              setOverride={(value) =>
                setOverrides((current) => ({ ...current, [pov]: value }))
              }
            />
          )
        )}
      </DebtFrame>
    </div>
  )
}
