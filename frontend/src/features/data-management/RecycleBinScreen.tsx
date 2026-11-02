import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { FinanceApi } from '../../api/finance'
import type {
  BinFilters,
  DeletedRecord,
  RecordKind,
} from '../../api/dataManagement'
import { recordLabels } from '../../api/dataManagement'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { SelectField, TextField } from '../../components/ui/FormField'
import { DebtFeedback, DebtFrame } from '../debts/DebtUi'
import { formatDebtDate, formatPen, validDate } from '../debts/debtModel'
import { useDebtApi } from '../debts/useDebtApi'
import { ApiFeedback, LoadingNotice } from '../expenses/ApiFeedback'
import { useResource } from '../expenses/useResource'
import { useDataManagementApi } from './useDataManagementApi'

const recordLink = (kind: RecordKind, id: string) =>
  `#/${kind === 'expense' ? 'expenses' : kind === 'loan' ? 'loans' : 'repayments'}/${id}`
function deletionDate(value: string) {
  return (
    new Intl.DateTimeFormat('es-PE', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC',
    }).format(new Date(value)) + ' UTC'
  )
}

export function RecycleBinScreen({
  financeApi,
  onChanged,
}: {
  financeApi: FinanceApi
  onChanged: () => void
}) {
  const api = useDataManagementApi()
  const debts = useDebtApi()
  const [draft, setDraft] = useState<BinFilters>({})
  const [filters, setFilters] = useState<BinFilters>({})
  const [page, setPage] = useState(1)
  const [version, setVersion] = useState(0)
  const load = useCallback(
    (signal: AbortSignal) => api.list(filters, page, signal),
    [api, filters, page],
  )
  const resource = useResource(
    `bin-${JSON.stringify(filters)}-${page}-${version}`,
    load,
  )
  const [validation, setValidation] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const lock = useRef(false)
  const mounted = useRef(true)
  const noticeRef = useRef<HTMLParagraphElement>(null)
  const [notice, setNotice] = useState('')
  const [failure, setFailure] = useState<unknown>()
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  function apply(event: FormEvent) {
    event.preventDefault()
    if (
      (draft.deletedFrom && !validDate(draft.deletedFrom)) ||
      (draft.deletedTo && !validDate(draft.deletedTo)) ||
      (draft.deletedFrom &&
        draft.deletedTo &&
        draft.deletedFrom > draft.deletedTo)
    ) {
      setValidation('Usa fechas válidas y un inicio anterior o igual al fin.')
      return
    }
    setValidation('')
    setFailure(undefined)
    setNotice('')
    setPage(1)
    setFilters({ ...draft })
  }
  async function restore(row: DeletedRecord) {
    if (lock.current || !row.canRestore) return
    lock.current = true
    setBusy(row.id)
    setFailure(undefined)
    setNotice('')
    try {
      if (row.kind === 'expense') await financeApi.restore(row.id)
      else if (row.kind === 'loan') await debts.restoreLoan(row.id)
      else await debts.restoreRepayment(row.id)
      onChanged()
      if (mounted.current) {
        setNotice(
          `${recordLabels[row.kind]} restaurado. Los saldos se actualizarán con los registros activos.`,
        )
        setVersion((v) => v + 1)
        requestAnimationFrame(() => noticeRef.current?.focus())
      }
    } catch (error) {
      if (mounted.current) setFailure(error)
    } finally {
      lock.current = false
      if (mounted.current) setBusy(null)
    }
  }
  const ready = !resource.loading && !resource.error && resource.data
  return (
    <DebtFrame title="Eliminados">
      <div className="data-management">
        <p className="debt-intro">
          Un lugar para recuperar consumos, préstamos y pagos. Restaurar vuelve
          a aplicar las reglas financieras; nunca cambia al responsable según la
          vista.
        </p>
        <form onSubmit={apply} className="data-bin-filters">
          <fieldset
            disabled={!!busy}
            className="plain-fieldset data-filter-grid"
          >
            <SelectField
              id="bin-type"
              label="Tipo de registro"
              value={draft.type ?? ''}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  type: (e.target.value || undefined) as RecordKind | undefined,
                })
              }
            >
              <option value="">Todos</option>
              {Object.entries(recordLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </SelectField>
            <TextField
              id="bin-from"
              label="Eliminado desde (UTC)"
              type="date"
              value={draft.deletedFrom ?? ''}
              onChange={(e) =>
                setDraft({ ...draft, deletedFrom: e.target.value || undefined })
              }
            />
            <TextField
              id="bin-to"
              label="Eliminado hasta (UTC)"
              type="date"
              value={draft.deletedTo ?? ''}
              onChange={(e) =>
                setDraft({ ...draft, deletedTo: e.target.value || undefined })
              }
            />
            <div className="workspace-actions">
              <Button type="submit">Aplicar filtros</Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setDraft({})
                  setFilters({})
                  setPage(1)
                  setValidation('')
                }}
              >
                Limpiar
              </Button>
            </div>
          </fieldset>
        </form>
        {validation && (
          <p className="field-error" role="alert">
            {validation}
          </p>
        )}
        <p className="field-hint">
          Se muestran eliminaciones directas. Los pagos inactivos solo por su
          origen se conservan en el detalle del consumo o préstamo.
        </p>
        {notice && (
          <p
            className="workspace-notice"
            role="status"
            tabIndex={-1}
            ref={noticeRef}
          >
            {notice}
          </p>
        )}
        {failure != null && (
          <DebtFeedback error={failure} operation="restore" />
        )}
        {busy && <LoadingNotice text="Restaurando y verificando los saldos…" />}
        {resource.loading && (
          <LoadingNotice text="Cargando registros eliminados…" />
        )}
        {resource.error != null && (
          <ApiFeedback
            error={resource.error}
            onRetry={() => setVersion((v) => v + 1)}
          />
        )}
        {ready && (
          <>
            <p className="data-result-count" role="status">
              {ready.total}{' '}
              {ready.total === 1
                ? 'registro eliminado'
                : 'registros eliminados'}
            </p>
            {!ready.data.length && (
              <div className="workspace-empty">
                <h2>
                  {page === 1
                    ? 'No hay registros eliminados'
                    : 'Esta página está vacía'}
                </h2>
                <p>
                  {page === 1
                    ? 'Los registros que elimines aparecerán aquí. Si aplicaste filtros, prueba con otras fechas o tipos.'
                    : 'Los datos pueden haber cambiado. Vuelve a la página anterior.'}
                </p>
              </div>
            )}
            <ul className="data-bin-list">
              {ready.data.map((row) => (
                <li key={`${row.kind}-${row.id}`} className="data-bin-entry">
                  <div className="data-entry-heading">
                    <Badge tone="neutral">{recordLabels[row.kind]}</Badge>
                    <strong>{formatPen(row.amount)}</strong>
                  </div>
                  <h2>
                    <a href={recordLink(row.kind, row.id)}>
                      {row.description ||
                        `${recordLabels[row.kind]} sin descripción`}
                    </a>
                  </h2>
                  <dl className="data-entry-dates">
                    <div>
                      <dt>Fecha original</dt>
                      <dd>{formatDebtDate(row.transactionDate)}</dd>
                    </div>
                    <div>
                      <dt>Eliminado</dt>
                      <dd>{deletionDate(row.deletedAt)}</dd>
                    </div>
                  </dl>
                  <ul className="data-entry-people">
                    {row.people.map((p, index) => (
                      <li key={`${p.id}-${index}`}>
                        <span>{p.role}:</span> {p.name}
                      </li>
                    ))}
                  </ul>
                  {row.morePeople > 0 && (
                    <p className="field-hint">
                      Y {row.morePeople} personas más. Consulta el detalle
                      completo.
                    </p>
                  )}
                  <div className="workspace-actions">
                    <Button
                      disabled={!!busy || !row.canRestore}
                      onClick={() => void restore(row)}
                      aria-label={`Restaurar ${recordLabels[row.kind].toLowerCase()}: ${row.description || row.id}`}
                    >
                      {busy === row.id ? 'Restaurando…' : 'Restaurar'}
                    </Button>
                    <a href={recordLink(row.kind, row.id)}>Ver detalle</a>
                  </div>
                  {row.parent && !row.parent.active && (
                    <p className="field-hint">
                      Primero revisa y restaura el origen.{' '}
                      <a href={recordLink(row.parent.kind, row.parent.id)}>
                        Ver{' '}
                        {row.parent.kind === 'expense' ? 'consumo' : 'préstamo'}{' '}
                        de origen
                      </a>
                      . Si una asignación fue reemplazada, el pago puede
                      permanecer archivado.
                    </p>
                  )}
                </li>
              ))}
            </ul>
            <nav
              className="workspace-actions data-pagination"
              aria-label="Páginas de eliminados"
            >
              <Button
                variant="ghost"
                disabled={page <= 1 || !!busy}
                onClick={() => setPage((p) => p - 1)}
              >
                Anterior
              </Button>
              <span>
                Página {page} de{' '}
                {Math.max(1, Math.ceil(ready.total / ready.pageSize))}
              </span>
              <Button
                variant="ghost"
                disabled={page * ready.pageSize >= ready.total || !!busy}
                onClick={() => setPage((p) => p + 1)}
              >
                Siguiente
              </Button>
            </nav>
          </>
        )}
        <aside className="data-explanation">
          <h2>Tu historial permanece protegido</h2>
          <p>
            Restaurar un origen no recupera los pagos eliminados por separado.
            Si un pago supera el saldo pendiente o su origen ya no es válido, no
            se restaurará.
          </p>
          <p>
            La eliminación definitiva no está disponible: conservar el historial
            evita perder relaciones financieras y registros de pagos. No hay
            borrado automático.
          </p>
        </aside>
      </div>
    </DebtFrame>
  )
}
