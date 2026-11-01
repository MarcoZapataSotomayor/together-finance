import { useCallback, useId, useState } from 'react'
import type { FormEvent } from 'react'
import type { DebtApi, DebtFilters } from '../../api/debts'
import type { NamedRecord } from '../../api/types'
import { Button } from '../../components/ui/Button'
import { SelectField, TextField } from '../../components/ui/FormField'
import { usePov } from '../../theme/usePov'
import { themes } from '../../theme/themes'
import { LoadingNotice } from '../expenses/ApiFeedback'
import { useResource } from '../expenses/useResource'
import { useDebtDrafts } from './DebtDraftContext'
import {
  directionalFilters,
  formatDebtDate,
  formatPen,
  resolvePovPerson,
  validDate,
} from './debtModel'
import type { Direction } from './debtModel'
import { DebtBadges, DebtFeedback, DebtFrame, SummaryTotals } from './DebtUi'

function DebtListPanel({
  api,
  filters,
  title,
  version,
  loansOnly,
  histories,
}: {
  api: DebtApi
  filters: DebtFilters
  title: string
  version: number
  loansOnly: boolean
  histories: boolean
}) {
  const [number, setNumber] = useState(1),
    [pageSize, setPageSize] = useState(20),
    [retry, setRetry] = useState(0)
  const id = useId(),
    encoded = JSON.stringify(filters)
  const list = useCallback(
    (signal: AbortSignal) =>
      api.list(
        JSON.parse(encoded) as DebtFilters,
        number,
        pageSize,
        signal,
        loansOnly,
      ),
    [api, encoded, number, pageSize, loansOnly],
  )
  const summaryLoad = useCallback(
    (signal: AbortSignal) =>
      api.summary(JSON.parse(encoded) as DebtFilters, signal),
    [api, encoded],
  )
  const records = useResource(
    `list-${encoded}-${number}-${pageSize}-${version}-${retry}`,
    list,
  )
  const summary = useResource(
    `summary-${encoded}-${version}-${retry}`,
    summaryLoad,
  )
  const pages = Math.max(1, Math.ceil((records.data?.total ?? 0) / pageSize))
  return (
    <section className="debt-direction-panel" aria-labelledby={id}>
      <h2 className="debt-section-title" id={id}>
        {title}
      </h2>
      {summary.loading ? (
        <LoadingNotice text="Cargando los saldos confirmados…" />
      ) : summary.error ? (
        <DebtFeedback
          error={summary.error}
          onRetry={() => setRetry((value) => value + 1)}
        />
      ) : (
        summary.data && (
          <>
            <SummaryTotals
              totals={summary.data.totals}
              label={
                filters.deletionState === 'deleted'
                  ? 'Pendiente activo de estos registros'
                  : 'Pendiente total de esta vista'
              }
            />
            <dl className="debt-origin-totals">
              <div>
                <dt>Por consumos</dt>
                <dd>
                  {formatPen(summary.data.byOrigin.EXPENSE.outstandingAmount)}
                </dd>
              </div>
              <div>
                <dt>Por préstamos</dt>
                <dd>
                  {formatPen(summary.data.byOrigin.LOAN.outstandingAmount)}
                </dd>
              </div>
            </dl>
            {!!summary.data.byPerson.length && (
              <details className="debt-breakdown">
                <summary>Por persona y dirección</summary>
                <div className="debt-counterparties">
                  <section>
                    <h3>Personas que deben</h3>
                    <dl>
                      {summary.data.byDebtor.map((row) => (
                        <div key={row.person.id}>
                          <dt>{row.person.name}</dt>
                          <dd>{formatPen(row.outstandingAmount)}</dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                  <section>
                    <h3>Personas a quienes se debe</h3>
                    <dl>
                      {summary.data.byCreditor.map((row) => (
                        <div key={row.person.id}>
                          <dt>{row.person.name}</dt>
                          <dd>{formatPen(row.outstandingAmount)}</dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                </div>
              </details>
            )}
          </>
        )
      )}
      {records.loading ? (
        <LoadingNotice text="Cargando las deudas…" />
      ) : records.error ? (
        <DebtFeedback
          error={records.error}
          onRetry={() => setRetry((value) => value + 1)}
        />
      ) : (
        records.data && (
          <>
            <p className="debt-result-count">
              {records.data.total} obligaciones encontradas
            </p>
            {records.data.data.length ? (
              <ol className="debt-list">
                {records.data.data.map((row) => (
                  <li key={row.id}>
                    <article>
                      <DebtBadges record={row} />
                      <h3>
                        <a
                          href={`#/${row.origin === 'LOAN' ? 'loans' : 'debts'}/${row.id}`}
                        >
                          {row.debtor.name} debe a {row.creditor.name}
                        </a>
                      </h3>
                      <dl className="debt-entry-facts">
                        <div>
                          <dt>Pendiente activo</dt>
                          <dd>{formatPen(row.outstandingAmount)}</dd>
                        </div>
                        <div>
                          <dt>Original</dt>
                          <dd>{formatPen(row.originalAmount)}</dd>
                        </div>
                        <div>
                          <dt>Fecha</dt>
                          <dd>{formatDebtDate(row.incurredOn)}</dd>
                        </div>
                      </dl>
                      {row.source && (
                        <p className="field-hint">
                          Consumo: {row.source.merchant}
                        </p>
                      )}
                      {row.description && (
                        <p className="debt-description">{row.description}</p>
                      )}
                      <div className="workspace-actions">
                        <a
                          className="button"
                          data-variant="secondary"
                          href={
                            histories
                              ? `#/debts/${row.id}/repayments`
                              : `#/${row.origin === 'LOAN' ? 'loans' : 'debts'}/${row.id}`
                          }
                        >
                          {histories
                            ? `Ver historial de pagos (${row.repayments.length})`
                            : filters.deletionState === 'deleted'
                              ? 'Ver y restaurar'
                              : 'Ver detalle'}
                        </a>
                        {!histories && (
                          <a
                            className="button"
                            data-variant="ghost"
                            href={`#/debts/${row.id}/repayments`}
                          >
                            Historial de pagos
                          </a>
                        )}
                      </div>
                    </article>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="workspace-empty">
                <h3>
                  {records.data.total
                    ? 'Esta página ya no tiene registros'
                    : filters.deletionState === 'deleted'
                      ? 'Sin deudas eliminadas en esta vista'
                      : 'Sin deudas con estos filtros'}
                </h3>
                <p>
                  {records.data.total
                    ? 'Vuelve a la primera página para ver los registros actuales.'
                    : 'Puedes cambiar los filtros o registrar un préstamo. Los consumos generan sus deudas automáticamente.'}
                </p>
                {number > 1 && (
                  <Button onClick={() => setNumber(1)}>
                    Ir a la primera página
                  </Button>
                )}
              </div>
            )}
            <nav
              className="history-pagination"
              aria-label={`Páginas: ${title}`}
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
              <SelectField
                id={`${id}-size`}
                label="Por página"
                value={String(pageSize)}
                onChange={(event) => {
                  setPageSize(Number(event.target.value))
                  setNumber(1)
                }}
              >
                {[10, 20, 50, 100].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </SelectField>
            </nav>
          </>
        )
      )}
    </section>
  )
}

export function DebtOverview({
  api,
  people,
  version,
  mode,
}: {
  api: DebtApi
  people: NamedRecord[]
  version: number
  mode: 'debts' | 'loans' | 'repayments'
}) {
  const { pov } = usePov(),
    drafts = useDebtDrafts(),
    prefix = useId()
  const resolved = resolvePovPerson(pov, people, drafts.mappings[pov])
  const [personOverride, setPersonOverride] = useState<string | null>(null)
  const [direction, setDirection] = useState<Direction>('both')
  const [filterDraft, setFilterDraft] = useState<DebtFilters>({
    deletionState: 'active',
  })
  const [applied, setApplied] = useState<DebtFilters>({
    deletionState: 'active',
  })
  const [invalid, setInvalid] = useState(''),
    [revision, setRevision] = useState(0)
  const personId = personOverride ?? resolved?.id ?? ''
  const person = people.find((row) => row.id === personId)
  const unresolved = pov !== 'shared' && !resolved && personOverride === null
  const base = {
    ...applied,
    ...(mode === 'loans' ? { origin: 'LOAN' as const } : {}),
  }
  const scopes = directionalFilters(personId, direction, base)
  const name = person?.name ?? 'la persona seleccionada'
  function apply(event: FormEvent) {
    event.preventDefault()
    if (
      (filterDraft.incurredFrom && !validDate(filterDraft.incurredFrom)) ||
      (filterDraft.incurredTo && !validDate(filterDraft.incurredTo)) ||
      (filterDraft.incurredFrom &&
        filterDraft.incurredTo &&
        filterDraft.incurredFrom > filterDraft.incurredTo)
    ) {
      setInvalid('Usa fechas válidas y un inicio anterior o igual al fin.')
      return
    }
    setInvalid('')
    setApplied({
      ...filterDraft,
      ...(filterDraft.deletionState === 'deleted' ? { status: undefined } : {}),
    })
    setRevision((value) => value + 1)
  }
  const title =
    mode === 'loans'
      ? 'Préstamos'
      : mode === 'repayments'
        ? 'Historial de pagos'
        : 'Deudas'
  return (
    <DebtFrame title={title}>
      <div className="debt-page-actions">
        <p className="debt-intro">
          {mode === 'repayments'
            ? 'Elige una deuda para consultar sus pagos y recuperar registros eliminados.'
            : mode === 'loans'
              ? 'Dinero prestado, separado de los consumos. Cada compromiso conserva su dirección.'
              : 'Deudas de consumos y préstamos, con cada dirección por separado.'}
        </p>
        <a
          className="button debt-save-button"
          data-variant="primary"
          href="#/loans/new"
        >
          Nuevo préstamo
        </a>
      </div>
      <div className="debt-pov-notice" role="status">
        <p>
          Perspectiva: <strong>{themes[pov].label}</strong>.{' '}
          {unresolved
            ? 'Selecciona qué persona corresponde a esta perspectiva; no se eligió ninguna por aproximación.'
            : person
              ? `Mostrando las obligaciones de ${person.name}${direction === 'owed' ? ' como deudor' : direction === 'receivable' ? ' como acreedor' : ' en ambas direcciones'}.`
              : 'Mostrando todas las personas.'}{' '}
          Puedes cambiar el filtro sin cambiar las personas de tus formularios.
        </p>
      </div>
      {pov !== 'shared' && (
        <details className="debt-mapping" open={unresolved || undefined}>
          <summary>Persona asociada a {themes[pov].label}</summary>
          <SelectField
            id={`${prefix}-mapping`}
            label={`Persona para la perspectiva ${themes[pov].label}`}
            value={resolved?.id ?? ''}
            onChange={(event) => {
              drafts.mapPerson(pov, event.target.value)
              setPersonOverride(null)
            }}
            hint="La asociación solo controla el filtro de lectura en esta sesión."
          >
            <option value="">Selecciona una persona</option>
            {people.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </SelectField>
          {!people.length && (
            <p className="field-hint">
              No hay personas disponibles. Agrégalas desde Nuevo préstamo o
              desde el formulario de consumo.
            </p>
          )}
        </details>
      )}
      <details className="debt-filter-disclosure">
        <summary>
          Filtrar {mode === 'loans' ? 'préstamos' : 'deudas'} ·{' '}
          {applied.deletionState === 'deleted'
            ? 'Eliminados o inactivos'
            : 'Activos'}
          {applied.origin
            ? ` · ${applied.origin === 'LOAN' ? 'Préstamos' : 'Consumos'}`
            : ''}
          {applied.status
            ? ` · ${applied.status === 'pending' ? 'Pendientes' : 'Saldadas'}`
            : ''}
        </summary>
        <form className="debt-filters" onSubmit={apply} noValidate>
          <div className="filter-grid">
            <SelectField
              id={`${prefix}-person`}
              label="Persona de esta vista"
              value={personId}
              onChange={(event) => {
                setPersonOverride(event.target.value)
                setRevision((value) => value + 1)
              }}
            >
              <option value="">Todas las personas</option>
              {people.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </SelectField>
            <SelectField
              id={`${prefix}-direction`}
              label="Dirección"
              value={direction}
              disabled={!personId}
              onChange={(event) => {
                setDirection(event.target.value as Direction)
                setRevision((value) => value + 1)
              }}
            >
              <option value="both">Lo que debe y lo que le deben</option>
              <option value="owed">Lo que debe</option>
              <option value="receivable">Lo que le deben</option>
            </SelectField>
            {mode !== 'loans' && (
              <SelectField
                id={`${prefix}-origin`}
                label="Origen"
                value={filterDraft.origin ?? ''}
                onChange={(event) =>
                  setFilterDraft((current) => ({
                    ...current,
                    origin: event.target.value as DebtFilters['origin'],
                  }))
                }
              >
                <option value="">Consumos y préstamos</option>
                <option value="EXPENSE">Consumos</option>
                <option value="LOAN">Préstamos independientes</option>
              </SelectField>
            )}
            <SelectField
              id={`${prefix}-state`}
              label="Registros"
              value={filterDraft.deletionState}
              onChange={(event) =>
                setFilterDraft((current) => ({
                  ...current,
                  deletionState: event.target.value as 'active' | 'deleted',
                  status: undefined,
                }))
              }
            >
              <option value="active">Activos</option>
              <option value="deleted">Eliminados o inactivos</option>
            </SelectField>
            <SelectField
              id={`${prefix}-status`}
              label="Estado de la deuda"
              value={filterDraft.status ?? ''}
              disabled={filterDraft.deletionState === 'deleted'}
              onChange={(event) =>
                setFilterDraft((current) => ({
                  ...current,
                  status: event.target.value as DebtFilters['status'],
                }))
              }
            >
              <option value="">Pendientes y saldadas</option>
              <option value="pending">Pendientes</option>
              <option value="settled">Saldadas</option>
            </SelectField>
            <TextField
              id={`${prefix}-from`}
              label="Desde la fecha de deuda"
              type="date"
              min="0001-01-01"
              max="9999-12-31"
              value={filterDraft.incurredFrom ?? ''}
              onChange={(event) =>
                setFilterDraft((current) => ({
                  ...current,
                  incurredFrom: event.target.value,
                }))
              }
            />
            <TextField
              id={`${prefix}-to`}
              label="Hasta la fecha de deuda"
              type="date"
              min="0001-01-01"
              max="9999-12-31"
              value={filterDraft.incurredTo ?? ''}
              onChange={(event) =>
                setFilterDraft((current) => ({
                  ...current,
                  incurredTo: event.target.value,
                }))
              }
            />
          </div>
          {invalid && (
            <p role="alert" className="field-error">
              {invalid}
            </p>
          )}
          <div className="workspace-actions">
            <Button type="submit">Aplicar filtros</Button>
            <Button
              variant="ghost"
              onClick={() => {
                setFilterDraft({ deletionState: 'active' })
                setApplied({ deletionState: 'active' })
                setPersonOverride(null)
                setDirection('both')
                setRevision((value) => value + 1)
                setInvalid('')
              }}
            >
              Restablecer perspectiva
            </Button>
            <Button
              variant="ghost"
              onClick={() => setRevision((value) => value + 1)}
            >
              Actualizar saldos
            </Button>
          </div>
        </form>
      </details>
      {unresolved ? (
        <div className="workspace-empty">
          <h2>Elige una persona para continuar</h2>
          <p>
            Asocia esta perspectiva a un registro o elige explícitamente «Todas
            las personas» en el filtro.
          </p>
        </div>
      ) : (
        <div
          className={`debt-directions${scopes.length === 2 ? ' debt-directions-pair' : ''}`}
        >
          {scopes.map((scope) => (
            <DebtListPanel
              key={`${scope.key}-${JSON.stringify(scope.filters)}-${revision}`}
              api={api}
              filters={scope.filters}
              title={
                scope.key === 'owed'
                  ? `Lo que debe ${name}`
                  : scope.key === 'receivable'
                    ? `Lo que le deben a ${name}`
                    : 'Panorama compartido'
              }
              version={version}
              loansOnly={mode === 'loans'}
              histories={mode === 'repayments'}
            />
          ))}
        </div>
      )}
      <p className="field-hint">
        Los préstamos y los pagos no se suman a los gastos. Las deudas en ambas
        direcciones se conservan por separado.
      </p>
    </DebtFrame>
  )
}
