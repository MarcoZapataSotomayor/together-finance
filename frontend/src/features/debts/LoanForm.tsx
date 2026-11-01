import { useId, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { DebtApi, DebtRecord } from '../../api/debts'
import type { FinanceApi } from '../../api/finance'
import type { References } from '../../api/types'
import { Button } from '../../components/ui/Button'
import { SelectField, TextField } from '../../components/ui/FormField'
import { LoadingNotice } from '../expenses/ApiFeedback'
import { localDate } from '../expenses/expenseModel'
import { ReferenceEditor } from '../expenses/ReferenceEditor'
import type {
  CreatedReference,
  ReferenceKind,
} from '../expenses/ReferenceEditor'
import { useDebtDrafts } from './DebtDraftContext'
import {
  loanChanges,
  loanPayload,
  loanValues,
  matchesLoan,
  validateLoan,
} from './debtModel'
import type { FieldErrors, LoanValues } from './debtModel'
import { DebtFeedback, DebtFrame } from './DebtUi'

export function LoanForm({
  api,
  financeApi,
  references,
  ready,
  record,
  onChanged,
  onReferenceCreated,
  onReloadReferences,
}: {
  api: DebtApi
  financeApi: FinanceApi
  references: References
  ready: boolean
  record?: DebtRecord
  onChanged: () => void
  onReferenceCreated: (kind: ReferenceKind, record: CreatedReference) => void
  onReloadReferences: () => void
}) {
  const drafts = useDebtDrafts(),
    prefix = useId(),
    key = `loan:${record?.id ?? 'new'}`
  const [initial] = useState<LoanValues>(() =>
    record
      ? loanValues(record)
      : {
          debtorPersonId: '',
          creditorPersonId: '',
          amount: '',
          incurredOn: localDate(),
          dueOn: '',
          description: '',
        },
  )
  const values = drafts.loans[key] ?? initial
  const [submission] = useState(() => drafts.loanIntent(key))
  const [errors, setErrors] = useState<FieldErrors<LoanValues>>({})
  const [failure, setFailure] = useState<unknown>(null)
  const [found, setFound] = useState<DebtRecord | null>(null)
  const [busy, setBusy] = useState(false),
    [saved, setSaved] = useState<DebtRecord | null>(null)
  const [addingPerson, setAddingPerson] = useState(false),
    [notice, setNotice] = useState('')
  const form = useRef<HTMLFormElement>(null),
    lock = useRef(false)
  const frozen = !!record?.repayments.length
  const people = references.people.filter((row) => row.isActive)
  const set = (field: keyof LoanValues, value: string) =>
    drafts.updateLoan(key, { ...values, [field]: value })
  function finish(result: DebtRecord) {
    setSaved(result)
    drafts.clear(key)
    onChanged()
  }
  async function save(event: FormEvent) {
    event.preventDefault()
    if (lock.current || submission.confirmed) return
    const validation =
      submission.uncertain && !submission.correcting
        ? {}
        : validateLoan(values, people)
    setErrors(validation)
    setNotice('')
    if (Object.keys(validation).length) {
      requestAnimationFrame(() =>
        form.current
          ?.querySelector<HTMLElement>('[aria-invalid="true"]')
          ?.focus(),
      )
      return
    }
    lock.current = true
    setBusy(true)
    setFailure(null)
    try {
      if (record) {
        const changes = loanChanges(values, record)
        if (!Object.keys(changes).length) {
          setNotice('No hay cambios para guardar.')
          return
        }
        const result = await api.updateLoan(record.id, changes)
        finish(result)
      } else {
        const result = await submission.submit(
          submission.uncertain && !submission.correcting
            ? submission.pendingPayload!
            : loanPayload(values),
          (id, payload) => api.createLoan(id, payload),
        )
        if (result) finish(result)
      }
    } catch (error) {
      setFailure(error)
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  async function inspect() {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setFailure(null)
    try {
      const result = await submission.inspect(async (id) => {
        const result = await api.get(id, undefined, true)
        setFound(result)
        return result
      }, matchesLoan)
      if (result) finish(result)
    } catch (error) {
      setFailure(error)
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  return (
    <DebtFrame title={record ? 'Editar préstamo' : 'Nuevo préstamo'}>
      <a
        href={record ? `#/loans/${record.id}` : '#/loans'}
        className="back-to-history"
      >
        {record ? 'Volver al préstamo' : 'Ver préstamos'}
      </a>
      {saved ? (
        <div className="workspace-empty">
          <h2>{record ? 'Cambios guardados' : 'Préstamo guardado'}</h2>
          <p role="status">
            El servidor confirmó el préstamo. No cuenta como un gasto.
          </p>
          <a
            href={`#/loans/${saved.id}`}
            className="button"
            data-variant="primary"
          >
            Ver préstamo guardado
          </a>
          <a href="#/loans" className="button" data-variant="ghost">
            Volver a préstamos
          </a>
        </div>
      ) : (
        <>
          <p className="debt-intro">
            Un préstamo es dinero que una persona entrega a otra y espera
            recuperar. Elige ambas personas; la perspectiva solo cambia la
            vista.
          </p>
          {frozen && (
            <p className="workspace-notice">
              Este préstamo tiene historial de pagos. El monto original, las
              personas y la fecha están protegidos, incluso si los pagos están
              eliminados. Puedes editar la descripción y el vencimiento.
            </p>
          )}
          {record &&
            (!people.some((row) => row.id === record.debtorPersonId) ||
              !people.some((row) => row.id === record.creditorPersonId)) &&
            ready && (
              <p className="workspace-notice">
                Una persona de este préstamo no está activa para nuevas
                selecciones. El servidor exige personas activas al editar; los
                saldos, los pagos y la restauración histórica se conservan.
              </p>
            )}
          {people.length < 2 && ready && (
            <p className="workspace-notice">
              Primero agrega al menos dos personas distintas para registrar un
              préstamo.
            </p>
          )}
          <div className="workspace-actions">
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => setAddingPerson((value) => !value)}
            >
              Agregar persona
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={onReloadReferences}
            >
              Actualizar personas
            </Button>
          </div>
          {addingPerson && (
            <ReferenceEditor
              idPrefix="loan-reference"
              kind="people"
              api={financeApi}
              references={references}
              onCreated={(kind, person) => {
                onReferenceCreated(kind, person)
                setAddingPerson(false)
              }}
              onCancel={() => setAddingPerson(false)}
            />
          )}
          <form
            ref={form}
            onSubmit={(event) => void save(event)}
            noValidate
            aria-busy={busy}
          >
            {Object.keys(errors).length > 0 && (
              <p className="form-message error-summary" role="alert">
                Revisa los campos marcados. Debe haber dos personas distintas y
                un monto válido.
              </p>
            )}
            <fieldset
              className="plain-fieldset debt-form-grid"
              disabled={
                !ready ||
                busy ||
                (submission.uncertain && !submission.correcting)
              }
            >
              <SelectField
                id={`${prefix}-debtor`}
                label="Quién debe el dinero"
                required
                value={values.debtorPersonId}
                disabled={frozen}
                error={errors.debtorPersonId}
                onChange={(event) => set('debtorPersonId', event.target.value)}
              >
                <option value="">Selecciona a quien recibe el préstamo</option>
                {record &&
                  !people.some((p) => p.id === record.debtorPersonId) && (
                    <option value={record.debtorPersonId}>
                      {record.debtor.name} (inactivo)
                    </option>
                  )}
                {people.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </SelectField>
              <SelectField
                id={`${prefix}-creditor`}
                label="Quién presta el dinero"
                required
                value={values.creditorPersonId}
                disabled={frozen}
                error={errors.creditorPersonId}
                onChange={(event) =>
                  set('creditorPersonId', event.target.value)
                }
              >
                <option value="">Selecciona a quien presta</option>
                {record &&
                  !people.some((p) => p.id === record.creditorPersonId) && (
                    <option value={record.creditorPersonId}>
                      {record.creditor.name} (inactivo)
                    </option>
                  )}
                {people.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </SelectField>
              <TextField
                id={`${prefix}-amount`}
                label="Monto del préstamo (S/)"
                required
                inputMode="decimal"
                maxLength={15}
                value={values.amount}
                disabled={frozen}
                error={errors.amount}
                onChange={(event) => set('amount', event.target.value)}
              />
              <TextField
                id={`${prefix}-date`}
                label="Fecha del préstamo"
                required
                type="date"
                min="0001-01-01"
                max="9999-12-31"
                value={values.incurredOn}
                disabled={frozen}
                error={errors.incurredOn}
                onChange={(event) => set('incurredOn', event.target.value)}
              />
              <TextField
                id={`${prefix}-due`}
                label="Vencimiento (opcional)"
                type="date"
                min={values.incurredOn || '0001-01-01'}
                max="9999-12-31"
                value={values.dueOn}
                error={errors.dueOn}
                onChange={(event) => set('dueOn', event.target.value)}
              />
              <div className="form-field debt-wide">
                <label htmlFor={`${prefix}-description`}>
                  Descripción (opcional)
                </label>
                <textarea
                  id={`${prefix}-description`}
                  maxLength={2000}
                  rows={3}
                  value={values.description}
                  aria-invalid={!!errors.description}
                  aria-describedby={
                    errors.description
                      ? `${prefix}-description-error`
                      : undefined
                  }
                  onChange={(event) => set('description', event.target.value)}
                />
                {errors.description && (
                  <p id={`${prefix}-description-error`} className="field-error">
                    {errors.description}
                  </p>
                )}
              </div>
            </fieldset>
            {notice && (
              <p role="status" className="workspace-notice">
                {notice}
              </p>
            )}
            {failure != null && (
              <DebtFeedback
                error={failure}
                operation={record ? 'edit' : 'create'}
              />
            )}
            {submission.uncertain && (
              <div className="workspace-notice">
                <p>
                  El resultado de este envío no está confirmado. Conservamos sus
                  campos e identificador; consulta el envío o reintenta
                  exactamente el mismo préstamo.
                </p>
                <Button onClick={() => void inspect()} disabled={busy}>
                  Consultar envío del préstamo
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    submission.allowCorrection()
                    setErrors({})
                    setFailure(null)
                  }}
                >
                  Corregir datos conservando el identificador
                </Button>
                {submission.correcting && (
                  <p>
                    Corrige los campos y vuelve a enviar con el mismo
                    identificador. Si el envío anterior ya existe, el servidor
                    rechazará otro contenido; podrás revisar ese registro.
                  </p>
                )}
                {found && (
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      drafts.clear(key)
                      window.location.hash = `/loans/${found.id}`
                    }}
                  >
                    Abrir registro existente y cerrar revisión
                  </Button>
                )}
                {submission.pendingId && (
                  <a
                    className="button"
                    data-variant="ghost"
                    href={`#/loans/${submission.pendingId}`}
                  >
                    Revisar registro del envío
                  </a>
                )}
              </div>
            )}
            {busy && <LoadingNotice text="Confirmando el préstamo…" />}
            <div className="workspace-actions">
              <Button
                type="submit"
                className="debt-save-button"
                disabled={busy || !ready}
              >
                {busy
                  ? 'Guardando…'
                  : submission.correcting
                    ? 'Enviar corrección con el mismo identificador'
                    : submission.uncertain
                      ? 'Reintentar el mismo préstamo'
                      : record
                        ? 'Guardar cambios'
                        : 'Guardar préstamo'}
              </Button>
              {!submission.uncertain && (
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    drafts.clear(key)
                    window.location.hash = record
                      ? `/loans/${record.id}`
                      : '/loans'
                  }}
                >
                  Cancelar formulario
                </Button>
              )}
            </div>
          </form>
        </>
      )}
    </DebtFrame>
  )
}
