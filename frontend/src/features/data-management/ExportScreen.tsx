import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ApiError } from '../../api/client'
import { exportLabels } from '../../api/dataManagement'
import type { ExportDataset, ExportFilters } from '../../api/dataManagement'
import { Button } from '../../components/ui/Button'
import { SelectField, TextField } from '../../components/ui/FormField'
import { DebtFrame } from '../debts/DebtUi'
import { ApiFeedback, LoadingNotice } from '../expenses/ApiFeedback'
import { useResource } from '../expenses/useResource'
import { localDate } from '../expenses/expenseModel'
import { monthRange, validatePeriod } from '../dashboard/dashboardModel'
import { useDataManagementApi } from './useDataManagementApi'

export function ExportScreen() {
  const api = useDataManagementApi()
  const [filters, setFilters] = useState<ExportFilters>(() => ({
    ...monthRange(localDate().slice(0, 7)),
    scope: 'active',
  }))
  const [dataset, setDataset] = useState<ExportDataset>('expenses')
  const [version, setVersion] = useState(0)
  const load = useCallback((signal: AbortSignal) => api.people(signal), [api])
  const people = useResource(`export-people-${version}`, load)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>()
  const [notice, setNotice] = useState('')
  const [validation, setValidation] = useState('')
  const controller = useRef<AbortController | null>(null)
  const url = useRef<string | null>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      controller.current?.abort()
      if (url.current) URL.revokeObjectURL(url.current)
    }
  }, [])
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (controller.current) return
    const invalid = validatePeriod(filters.from, filters.to)
    setValidation(invalid)
    setError(undefined)
    setNotice('')
    if (invalid) return
    const request = new AbortController()
    controller.current = request
    setBusy(true)
    try {
      const result = await api.export(dataset, filters, request.signal)
      request.signal.throwIfAborted()
      if (url.current) URL.revokeObjectURL(url.current)
      url.current = URL.createObjectURL(result.blob)
      const link = document.createElement('a')
      link.href = url.current
      link.download = result.filename
      document.body.append(link)
      link.click()
      link.remove()
      setNotice('Archivo CSV preparado. Revisa las descargas de tu navegador.')
    } catch (failure) {
      if (mounted.current && !request.signal.aborted) setError(failure)
    } finally {
      controller.current = null
      if (mounted.current) setBusy(false)
    }
  }
  return (
    <DebtFrame title="Exportar datos">
      <div className="data-management">
        <p className="debt-intro">
          Tus registros, en un archivo para revisar. Elige qué incluir; la vista
          seleccionada no cambia los datos ni su propietario.
        </p>
        <form onSubmit={(event) => void submit(event)}>
          <fieldset disabled={busy} className="plain-fieldset data-filter-grid">
            <SelectField
              id="export-dataset"
              label="Registros"
              value={dataset}
              onChange={(e) => setDataset(e.target.value as ExportDataset)}
            >
              {Object.entries(exportLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </SelectField>
            <SelectField
              id="export-scope"
              label="Estado de los registros"
              value={filters.scope}
              onChange={(e) =>
                setFilters({
                  ...filters,
                  scope: e.target.value as ExportFilters['scope'],
                })
              }
            >
              <option value="active">Solo activos</option>
              <option value="deleted">
                Solo eliminados o inactivos por su origen
              </option>
              <option value="all">Todos</option>
            </SelectField>
            <TextField
              id="export-from"
              label="Desde"
              type="date"
              required
              value={filters.from}
              onChange={(e) => setFilters({ ...filters, from: e.target.value })}
            />
            <TextField
              id="export-to"
              label="Hasta"
              type="date"
              required
              value={filters.to}
              onChange={(e) => setFilters({ ...filters, to: e.target.value })}
            />
            <SelectField
              id="export-person"
              label="Persona involucrada"
              value={filters.personId ?? ''}
              onChange={(e) =>
                setFilters({
                  ...filters,
                  personId: e.target.value || undefined,
                })
              }
              disabled={people.loading || !!people.error}
            >
              <option value="">Todas las personas</option>
              {people.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.isActive ? '' : ' (inactiva)'}
                </option>
              ))}
            </SelectField>
            <div className="data-filter-note">
              <p>
                Fechas de compra para consumos y asignaciones; de origen para
                deudas y préstamos; de pago para pagos.
              </p>
              <p>Hasta 24 meses, 10 000 filas y 8 MiB por archivo.</p>
            </div>
          </fieldset>
          {validation && (
            <p className="field-error" role="alert">
              {validation}
            </p>
          )}
          {people.loading && (
            <LoadingNotice text="Cargando personas para los filtros…" />
          )}
          {people.error != null && (
            <ApiFeedback
              error={people.error}
              onRetry={() => setVersion((v) => v + 1)}
            />
          )}
          <div className="workspace-actions">
            <Button type="submit" disabled={busy}>
              {busy ? 'Preparando archivo…' : 'Descargar CSV'}
            </Button>
            {busy && (
              <Button
                variant="ghost"
                onClick={() => {
                  controller.current?.abort()
                  setNotice('Descarga cancelada.')
                }}
              >
                Cancelar descarga
              </Button>
            )}
          </div>
        </form>
        {busy && <LoadingNotice text="Preparando tu archivo CSV…" />}
        {error != null && (
          <ApiFeedback
            error={error}
            errorMessage={
              error instanceof ApiError && error.status === 413
                ? 'El archivo supera el límite. Reduce las fechas o filtra por persona.'
                : undefined
            }
          />
        )}
        {notice && (
          <p className="workspace-notice" role="status">
            {notice}
          </p>
        )}
        <aside className="data-explanation">
          <h2>Un archivo por tipo de registro</h2>
          <p>
            Los consumos aparecen una sola vez. Las asignaciones contienen la
            responsabilidad de cada persona, sin repetir el total del consumo.
            Las deudas muestran su principal original, no un saldo actual.
          </p>
          <p>
            Préstamos y pagos no son nuevos gastos. No sumes estos archivos
            entre sí.
          </p>
          <p>
            El CSV puede estar vacío y contener solo encabezados. Incluye
            información financiera privada: guárdalo con cuidado. No reemplaza
            una copia de seguridad de la base de datos.
          </p>
        </aside>
      </div>
    </DebtFrame>
  )
}
