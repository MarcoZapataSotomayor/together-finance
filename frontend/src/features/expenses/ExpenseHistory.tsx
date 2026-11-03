import { useCallback, useState } from 'react'
import type { FormEvent } from 'react'
import type { FinanceApi } from '../../api/finance'
import { SegmentedControl } from '../../components/ui/SegmentedControl'
import type { ExpenseFilters, References } from '../../api/types'
import { FrameOrnaments } from '../../components/decorations/Ornaments'
import { Button } from '../../components/ui/Button'
import { SelectField, TextField } from '../../components/ui/FormField'
import { ApiFeedback, LoadingNotice } from './ApiFeedback'
import { ExpenseFrameTitle } from './ExpenseFrameTitle'
import { ExpenseSummary } from './ExpenseSummary'
import { useResource } from './useResource'

export function ExpenseHistory({
  api,
  references,
  active,
  version,
}: {
  api: FinanceApi
  references: References
  active: boolean
  version: number
}) {
  const [draft, setDraft] = useState<ExpenseFilters>({})
  const [filters, setFilters] = useState<ExpenseFilters>({})
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [refresh, setRefresh] = useState(0)
  const [validation, setValidation] = useState('')
  const load = useCallback(
    (signal: AbortSignal) => api.list(filters, page, pageSize, signal),
    [api, filters, page, pageSize],
  )
  const result = useResource(
    JSON.stringify({ filters, page, pageSize, refresh, version }),
    load,
    active,
  )
  function apply(event: FormEvent) {
    event.preventDefault()
    if (
      draft.purchasedFrom &&
      draft.purchasedTo &&
      draft.purchasedFrom > draft.purchasedTo
    ) {
      setValidation('La fecha inicial no puede ser posterior a la final.')
      return
    }
    setValidation('')
    setFilters(draft)
    setPage(1)
    setRefresh((value) => value + 1)
  }
  function change(key: keyof ExpenseFilters, value: string) {
    setDraft((current) => ({ ...current, [key]: value }))
  }
  const isDeleted = filters.deletionState === 'deleted'
  const hasFilters = Object.entries(filters).some(
    ([key, value]) => key !== 'deletionState' && !!value,
  )
  function changeState(value: 'active' | 'deleted') {
    setDraft((current) => ({ ...current, deletionState: value }))
    setFilters((current) => ({ ...current, deletionState: value }))
    setPage(1)
    setRefresh((current) => current + 1)
  }
  const pages = Math.max(1, Math.ceil((result.data?.total ?? 0) / pageSize))
  return (
    <section
      className="consumption-frame history-frame"
      aria-labelledby="history-title"
    >
      <FrameOrnaments />
      <ExpenseFrameTitle title="Nuestros consumos" id="history-title" />
      <SegmentedControl
        name="history-state"
        legend="Estado de los consumos"
        value={filters.deletionState ?? 'active'}
        options={[
          { value: 'active', label: 'Activos' },
          { value: 'deleted', label: 'Eliminados' },
        ]}
        onChange={changeState}
        className="history-state-control"
      />
      <form className="history-filters" onSubmit={apply}>
        <details>
          <summary>Filtrar consumos</summary>
          <div className="filter-grid">
            <TextField
              id="filter-from"
              label="Desde"
              type="date"
              value={draft.purchasedFrom ?? ''}
              onChange={(event) => change('purchasedFrom', event.target.value)}
            />
            <TextField
              id="filter-to"
              label="Hasta"
              type="date"
              value={draft.purchasedTo ?? ''}
              onChange={(event) => change('purchasedTo', event.target.value)}
            />
            <SelectField
              id="filter-category"
              label="Categoría"
              value={draft.categoryId ?? ''}
              onChange={(event) => change('categoryId', event.target.value)}
            >
              <option value="">Todas</option>
              {references.categories.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </SelectField>
            <SelectField
              id="filter-beneficiary"
              label="Beneficiario"
              value={draft.beneficiaryPersonId ?? ''}
              onChange={(event) =>
                change('beneficiaryPersonId', event.target.value)
              }
            >
              <option value="">Cualquier persona</option>
              {references.people.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </SelectField>
            <SelectField
              id="filter-funder"
              label="Aporta el dinero"
              value={draft.fundedByPersonId ?? ''}
              onChange={(event) =>
                change('fundedByPersonId', event.target.value)
              }
            >
              <option value="">Cualquier persona</option>
              {references.people.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </SelectField>
            <SelectField
              id="filter-classification"
              label="Tipo de gasto"
              value={draft.classification ?? ''}
              onChange={(event) => change('classification', event.target.value)}
            >
              <option value="">Todos</option>
              <option value="PERSONAL">Personal</option>
              <option value="SHARED">Compartido</option>
            </SelectField>
          </div>
          {validation && (
            <p className="field-error" role="alert">
              {validation}
            </p>
          )}
          <div className="workspace-actions">
            <Button type="submit">Aplicar filtros</Button>
            <Button
              variant="ghost"
              onClick={() => {
                setDraft({ deletionState: filters.deletionState ?? 'active' })
                setFilters({ deletionState: filters.deletionState ?? 'active' })
                setPage(1)
                setValidation('')
                setRefresh((value) => value + 1)
              }}
            >
              Limpiar filtros
            </Button>
          </div>
        </details>
      </form>
      <div className="history-toolbar">
        <p aria-live="polite">
          {result.loading
            ? 'Consultando…'
            : result.error
              ? 'No pudimos cargar los consumos.'
              : `${result.data?.total ?? 0} consumos encontrados`}
        </p>
        <Button
          variant="ghost"
          onClick={() => setRefresh((value) => value + 1)}
          disabled={result.loading}
        >
          Actualizar
        </Button>
      </div>
      {result.loading ? (
        <LoadingNotice />
      ) : result.error ? (
        <ApiFeedback
          error={result.error}
          onRetry={() => setRefresh((value) => value + 1)}
        />
      ) : (
        result.data && (
          <>
            {result.data.data.length ? (
              <ol className="expense-history-list">
                {result.data.data.map((expense) => (
                  <li key={expense.id}>
                    <article className="expense-history-entry">
                      <ExpenseSummary expense={expense} />
                      <div className="workspace-actions">
                        <a
                          className="button"
                          data-variant="ghost"
                          href={`#/expenses/${expense.id}`}
                        >
                          {expense.deletedAt
                            ? 'Ver y restaurar'
                            : 'Ver detalle'}
                        </a>
                        {!expense.deletedAt && (
                          <a
                            className="button"
                            data-variant="ghost"
                            href={`#/expenses/${expense.id}/edit`}
                          >
                            Editar
                          </a>
                        )}
                      </div>
                    </article>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="workspace-empty">
                <h2>
                  {result.data.total
                    ? 'Esta página ya no tiene consumos'
                    : isDeleted
                      ? 'Sin consumos eliminados'
                      : 'Aquí empieza su historia'}
                </h2>
                <p>
                  {hasFilters
                    ? 'No hay consumos con estos filtros. Puedes cambiarlos o limpiarlos.'
                    : isDeleted
                      ? 'Los consumos que eliminen aparecerán aquí y podrán restaurarlos.'
                      : 'Los consumos que guarden aparecerán aquí, con su reparto y quién aporta el dinero.'}
                </p>
                {page > 1 ? (
                  <Button onClick={() => setPage(1)}>
                    Ir a la primera página
                  </Button>
                ) : isDeleted ? (
                  <Button onClick={() => changeState('active')}>
                    Ver consumos activos
                  </Button>
                ) : (
                  <a
                    href="#/expenses/new"
                    className="button"
                    data-variant="primary"
                  >
                    Registrar un consumo
                  </a>
                )}
              </div>
            )}
            <nav
              className="history-pagination"
              aria-label="Páginas de consumos"
            >
              <Button
                variant="ghost"
                onClick={() => setPage((value) => Math.max(1, value - 1))}
                disabled={page === 1}
              >
                Anterior
              </Button>
              <span>
                Página {page} de {pages}
              </span>
              <Button
                variant="ghost"
                onClick={() => setPage((value) => value + 1)}
                disabled={page >= pages}
              >
                Siguiente
              </Button>
              <SelectField
                id="history-page-size"
                label="Por página"
                value={String(pageSize)}
                onChange={(event) => {
                  setPageSize(Number(event.target.value))
                  setPage(1)
                }}
              >
                {[10, 20, 50, 100].map((size) => (
                  <option key={size} value={size}>
                    {size}
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
