import { useContext, useRef, useState } from 'react'
import type { FormEvent, SetStateAction } from 'react'
import type { FinanceApi } from '../../api/finance'
import { ApiError } from '../../api/client'
import type { ExpenseRecord, References } from '../../api/types'
import { methodLabels } from '../../api/types'
import {
  FrameOrnaments,
  OrnamentalDivider,
  ScallopedPanel,
} from '../../components/decorations/Ornaments'
import { Button } from '../../components/ui/Button'
import { SelectField, TextField } from '../../components/ui/FormField'
import { Icon } from '../../components/ui/Icon'
import { SegmentedControl } from '../../components/ui/SegmentedControl'
import { ApiFeedback, LoadingNotice } from './ApiFeedback'
import { ExpenseDetailsFields } from './ExpenseDetailsFields'
import { ExpenseFrameTitle } from './ExpenseFrameTitle'
import { ReferenceEditor } from './ReferenceEditor'
import type { CreatedReference, ReferenceKind } from './ReferenceEditor'
import { ExpenseDraftContext } from './ExpenseDraftContext'
import {
  allocationInCents,
  createInitialValues,
  expensePayload,
  penFormatter,
  validateExpense,
  valuesFromExpense,
} from './expenseModel'
import type { ExpenseErrors, ExpenseValues } from './expenseModel'

interface Props {
  api: FinanceApi
  references: References
  ready: boolean
  active?: boolean
  initialExpense?: ExpenseRecord
  onReferenceCreated: (kind: ReferenceKind, record: CreatedReference) => void
  onSaved: (expense: ExpenseRecord) => void
  onCancel?: () => void
  onReloadReferences: () => void
}
export function NewExpenseScreen({
  api,
  references,
  ready,
  active = true,
  initialExpense,
  onReferenceCreated,
  onSaved,
  onCancel,
  onReloadReferences,
}: Props) {
  const drafts = useContext(ExpenseDraftContext)
  if (!drafts) throw new Error('Expense form requires ExpenseDraftProvider')
  const cacheKey = initialExpense?.id ?? 'new'
  const [initialValues] = useState(() =>
    initialExpense ? valuesFromExpense(initialExpense) : createInitialValues(),
  )
  const values = drafts.values[cacheKey] ?? initialValues
  const setValues = (action: SetStateAction<ExpenseValues>) =>
    drafts.update(cacheKey, action, initialValues)
  const [errors, setErrors] = useState<ExpenseErrors>({})
  const [failure, setFailure] = useState<unknown>(null)
  const [saved, setSaved] = useState<ExpenseRecord | null>(null)
  const [busy, setBusy] = useState(false)
  const [editor, setEditor] = useState<ReferenceKind | null>(null)
  const [notice, setNotice] = useState('')
  const [pendingLink, setPendingLink] = useState<string | null>(null)
  const [uncertain, setUncertain] = useState(
    () => !initialExpense && drafts.submission.uncertain,
  )
  const submission = useRef(drafts.submission)
  const lock = useRef(false)
  const errorSummary = useRef<HTMLDivElement>(null)
  const confirmation = useRef<HTMLDivElement>(null)
  const prefix = initialExpense ? 'edit' : 'new'
  const payment =
    references.methods.find((method) => method.id === values.paymentMethodId) ??
    (initialExpense?.paymentMethod.id === values.paymentMethodId
      ? initialExpense.paymentMethod
      : undefined)
  const allocations = allocationInCents(values)
  const disabled = busy || !!saved || uncertain || !ready || !!editor
  const personName = (id: string) =>
    references.people.find((person) => person.id === id)?.name ??
    (initialExpense?.fundedBy.id === id
      ? initialExpense.fundedBy.name
      : undefined) ??
    initialExpense?.allocations.find((row) => row.personId === id)?.person
      .name ??
    'Persona no disponible'
  function update<K extends keyof ExpenseValues>(
    key: K,
    value: ExpenseValues[K],
  ) {
    setValues((current) => ({ ...current, [key]: value }))
    setErrors({})
    setFailure(null)
    setNotice('')
  }
  function changePayment(id: string) {
    // Method ownership is metadata. A changed method requires a fresh, explicit funder choice.
    setValues((current) => ({ ...current, paymentMethodId: id, payer: '' }))
    setErrors({})
    setFailure(null)
  }
  function share(
    index: number,
    field: 'personId' | 'percentage',
    value: string,
  ) {
    update(
      'shares',
      values.shares.map((row, current) =>
        current === index ? { ...row, [field]: value } : row,
      ),
    )
  }
  function finish(result: ExpenseRecord) {
    if (initialExpense) drafts.clear(cacheKey)
    else drafts.resetNew()
    setSaved(result)
    setFailure(null)
    setNotice('')
    setUncertain(false)
    onSaved(result)
    requestAnimationFrame(() => confirmation.current?.focus())
  }
  async function saveExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (lock.current || saved || !ready || editor) return
    const nextErrors = validateExpense(values, references)
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) {
      requestAnimationFrame(() => errorSummary.current?.focus())
      return
    }
    lock.current = true
    setBusy(true)
    setFailure(null)
    try {
      const payload = expensePayload(values)
      const result = initialExpense
        ? await api.update(initialExpense.id, payload)
        : await submission.current.submit(payload, api.create)
      if (result) finish(result)
    } catch (error) {
      setFailure(error)
      setUncertain(submission.current.uncertain && !initialExpense)
      if (!initialExpense && !submission.current.pendingId)
        setNotice(
          'No se envió el consumo. Para guardar, usa un navegador actual en HTTPS o localhost.',
        )
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  async function inspectPending() {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setFailure(null)
    try {
      const result = await submission.current.inspect(api.get)
      if (result) finish(result)
    } catch (error) {
      setFailure(error)
      if (error instanceof ApiError && error.status === 409) {
        setPendingLink(submission.current.pendingId)
        setNotice(
          'Encontramos el registro, pero sus datos cambiaron o está eliminado. Revisa su detalle antes de volver a guardar.',
        )
      } else
        setNotice(
          'Si aún no aparece, reintenta guardar el mismo consumo. Conservaremos su identificador y sus campos.',
        )
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  function newExpense() {
    submission.current = drafts.resetNew()
    setValues(createInitialValues())
    setSaved(null)
    setErrors({})
    setFailure(null)
    setNotice('')
    setUncertain(false)
    setPendingLink(null)
    requestAnimationFrame(() =>
      document.getElementById(`${prefix}-place`)?.focus(),
    )
  }
  function referenceCreated(kind: ReferenceKind, record: CreatedReference) {
    onReferenceCreated(kind, record)
    if (kind === 'categories') update('category', record.id)
    if (kind === 'methods') changePayment(record.id)
    setEditor(null)
    setNotice(
      kind === 'people'
        ? 'Persona guardada. Ahora puedes seleccionarla en el formulario.'
        : 'Opción guardada y seleccionada.',
    )
    requestAnimationFrame(() =>
      document
        .getElementById(
          `${prefix}-${kind === 'categories' ? 'category' : kind === 'methods' ? 'payment' : 'payer'}`,
        )
        ?.focus(),
    )
  }
  function personOptions(current: string) {
    return (
      <>
        {current && !references.people.some((row) => row.id === current) && (
          <option value={current} disabled>
            {personName(current)} (inactiva)
          </option>
        )}
        {references.people.map((person) => (
          <option key={person.id} value={person.id}>
            {person.name}
          </option>
        ))}
      </>
    )
  }
  return (
    <form
      className="consumption-frame"
      onSubmit={(event) => void saveExpense(event)}
      noValidate
      aria-labelledby={`${prefix}-expense-title`}
      aria-busy={busy}
    >
      <FrameOrnaments />
      <ExpenseFrameTitle
        title={initialExpense ? 'Editar consumo' : 'Nuevo consumo'}
        id={`${prefix}-expense-title`}
      />
      <div
        ref={errorSummary}
        className="form-message error-summary"
        role="alert"
        tabIndex={-1}
        hidden={!Object.keys(errors).length}
      >
        <strong>Nos falta un detalle.</strong> Revisa los campos señalados antes
        de guardar.
      </div>
      {failure != null && (
        <ApiFeedback
          error={failure}
          context={initialExpense ? 'edit' : 'create'}
        />
      )}
      {notice && (
        <p className="workspace-notice" role="status">
          {notice}
        </p>
      )}
      {busy && (
        <LoadingNotice
          text={
            initialExpense
              ? 'Guardando los cambios…'
              : 'Confirmando el guardado…'
          }
        />
      )}
      {uncertain && (
        <div className="workspace-notice">
          <p>
            No sabemos si llegó a guardarse. Los campos quedan protegidos:
            consulta el resultado o reintenta este mismo consumo.
          </p>
          <Button onClick={() => void inspectPending()} disabled={busy}>
            Comprobar guardado
          </Button>
          {pendingLink && (
            <a href={`#/expenses/${pendingLink}`}>
              Revisar el registro encontrado
            </a>
          )}
        </div>
      )}
      <div
        ref={confirmation}
        className="form-message confirmation-message"
        role="status"
        tabIndex={-1}
        hidden={!saved}
      >
        {saved && (
          <>
            <Icon name="check" />
            <div>
              <p>
                Consumo guardado: {penFormatter.format(Number(saved.amount))} en{' '}
                {saved.merchant}.
              </p>
              <a href={`#/expenses/${saved.id}`}>Ver el consumo guardado</a>
              {!initialExpense && (
                <Button onClick={newExpense}>Registrar otro consumo</Button>
              )}
            </div>
          </>
        )}
      </div>
      {!saved && (
        <details
          className="reference-shortcuts"
          open={
            !references.people.length ||
            !references.categories.length ||
            !references.methods.length
          }
        >
          <summary>Personas y opciones del formulario</summary>
          <p>
            {!references.people.length ||
            !references.categories.length ||
            !references.methods.length
              ? 'Antes de guardar, crea las personas, categorías y medios de pago que usarán. No agregamos ejemplos automáticamente.'
              : 'Tus opciones, compartidas entre los dos.'}
          </p>
          <div className="workspace-actions">
            {(['people', 'categories', 'methods'] as const).map((kind) => (
              <Button
                key={kind}
                variant="ghost"
                disabled={busy || uncertain || !ready}
                onClick={() => setEditor(kind)}
              >
                {kind === 'people'
                  ? 'Agregar persona'
                  : kind === 'categories'
                    ? 'Agregar categoría'
                    : 'Agregar medio'}
              </Button>
            ))}
            <Button
              variant="ghost"
              disabled={busy || uncertain}
              onClick={onReloadReferences}
            >
              Actualizar opciones
            </Button>
          </div>
        </details>
      )}
      {active && editor && (
        <ReferenceEditor
          key={editor}
          kind={editor}
          api={api}
          references={references}
          onCreated={referenceCreated}
          onCancel={() => setEditor(null)}
        />
      )}
      <fieldset disabled={disabled} className="plain-fieldset">
        <div className="expense-columns">
          <div className="expense-details">
            <ExpenseDetailsFields
              idPrefix={prefix}
              values={values}
              errors={errors}
              onUpdate={update}
              categories={references.categories}
            />
            <OrnamentalDivider />
            <div className="payment-section">
              <div className="payment-row">
                <SelectField
                  id={`${prefix}-payment`}
                  label="Medio de pago"
                  icon="card"
                  value={values.paymentMethodId}
                  onChange={(event) => changePayment(event.target.value)}
                  required
                  error={errors.paymentMethodId}
                >
                  <option value="">Elige medio de pago</option>
                  {values.paymentMethodId &&
                    !references.methods.some(
                      (row) => row.id === values.paymentMethodId,
                    ) && (
                      <option value={values.paymentMethodId} disabled>
                        Medio inactivo
                      </option>
                    )}
                  {references.methods.map((method) => (
                    <option key={method.id} value={method.id}>
                      {method.name}
                    </option>
                  ))}
                </SelectField>
                <button
                  className="add-method-button"
                  type="button"
                  aria-label="Agregar medio de pago"
                  onClick={() => setEditor('methods')}
                >
                  <Icon name="plus" />
                </button>
              </div>
              {payment &&
                ['CREDIT_CARD', 'DEBIT_CARD'].includes(payment.type) && (
                  <TextField
                    id={`${prefix}-card-type`}
                    label="Tipo de tarjeta"
                    value={methodLabels[payment.type]}
                    readOnly
                    hint="El tipo corresponde al medio de pago seleccionado."
                  />
                )}
              <SelectField
                id={`${prefix}-payer`}
                label="¿Quién aporta el dinero?"
                icon="person"
                value={values.payer}
                onChange={(event) => update('payer', event.target.value)}
                required
                error={errors.payer}
                hint={
                  payment?.ownerPersonId
                    ? `Titular registrado: ${personName(payment.ownerPersonId)}. Elige por separado quién aporta el dinero.`
                    : undefined
                }
              >
                <option value="">Selecciona a una persona</option>
                {personOptions(values.payer)}
              </SelectField>
            </div>
          </div>
          <div className="allocation-column">
            <section
              className="allocation-panel"
              aria-labelledby={`${prefix}-allocation-title`}
            >
              <ScallopedPanel>
                <h2 id={`${prefix}-allocation-title`}>
                  <Icon name="people" />
                  Tipo de gasto
                  <span className="comic-burst" aria-hidden="true" />
                </h2>
                <SegmentedControl
                  name={`${prefix}-expenseType`}
                  legend="¿Para quién es este consumo?"
                  value={values.expenseType}
                  options={[
                    { value: 'personal', label: 'Personal', icon: 'person' },
                    { value: 'shared', label: 'Compartido', icon: 'people' },
                  ]}
                  onChange={(value) => update('expenseType', value)}
                  error={errors.expenseType}
                  className="expense-type-control"
                />
                {!values.expenseType && (
                  <p className="allocation-prompt">
                    ¿Un gusto para ti o algo para compartir?
                    <br />
                    Tú eliges a quién pertenece.
                  </p>
                )}
                {values.expenseType === 'personal' && (
                  <SelectField
                    id={`${prefix}-owner`}
                    label="¿De quién es el consumo?"
                    icon="heart"
                    value={values.owner}
                    onChange={(event) => update('owner', event.target.value)}
                    error={errors.owner}
                    required
                  >
                    <option value="">Selecciona a una persona</option>
                    {personOptions(values.owner)}
                  </SelectField>
                )}
                {values.expenseType === 'shared' && (
                  <div className="division-panel">
                    <h3>
                      <Icon name="pie" />
                      División
                    </h3>
                    <SegmentedControl
                      name={`${prefix}-splitMode`}
                      legend="Cómo dividir el consumo"
                      value={values.splitMode}
                      options={[
                        { value: 'equal', label: '50/50' },
                        { value: 'custom', label: '% personalizado' },
                      ]}
                      onChange={(value) => update('splitMode', value)}
                      error={errors.splitMode}
                      className="split-control"
                    />
                    <div className="beneficiary-fields">
                      {values.shares.map((row, index) => (
                        <div className="beneficiary-row" key={index}>
                          <SelectField
                            id={`${prefix}-beneficiary-${index}`}
                            label={`Beneficiario ${index + 1}`}
                            value={row.personId}
                            onChange={(event) =>
                              share(index, 'personId', event.target.value)
                            }
                            required
                          >
                            <option value="">Selecciona a una persona</option>
                            {personOptions(row.personId)}
                          </SelectField>
                          {values.splitMode === 'custom' && (
                            <TextField
                              id={`${prefix}-percentage-${index}`}
                              label="Porcentaje (%)"
                              inputMode="decimal"
                              value={row.percentage}
                              onChange={(event) =>
                                share(index, 'percentage', event.target.value)
                              }
                              placeholder="50"
                              maxLength={8}
                              required
                            />
                          )}
                          {values.shares.length > 2 && (
                            <Button
                              variant="ghost"
                              onClick={() =>
                                update(
                                  'shares',
                                  values.shares.filter(
                                    (_, current) => current !== index,
                                  ),
                                )
                              }
                              aria-label={`Quitar beneficiario ${index + 1}`}
                            >
                              Quitar
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                    {values.splitMode === 'custom' &&
                      values.shares.length < 20 && (
                        <Button
                          variant="ghost"
                          onClick={() =>
                            update('shares', [
                              ...values.shares,
                              { personId: '', percentage: '' },
                            ])
                          }
                        >
                          Agregar beneficiario
                        </Button>
                      )}
                    {errors.allocation && (
                      <p className="field-error" role="alert">
                        {errors.allocation}
                      </p>
                    )}
                    <p className="field-hint">
                      Usa porcentajes positivos que sumen 100 %. El reparto
                      redondeado conserva el total exacto y no depende de la
                      perspectiva.
                    </p>
                  </div>
                )}
              </ScallopedPanel>
            </section>
            <aside
              className="expense-receipt"
              aria-labelledby={`${prefix}-receipt-title`}
            >
              <h2 id={`${prefix}-receipt-title`}>Cada detalle cuenta</h2>
              <p>
                El estilo lo eliges arriba.
                <br />
                Quién paga y cómo se reparte, aquí.
              </p>
              {allocations ? (
                <dl>
                  {allocations.map((row) => (
                    <div key={row.personId}>
                      <dt>{personName(row.personId)}</dt>
                      <dd>{penFormatter.format(row.cents / 100)}</dd>
                    </div>
                  ))}
                  <div className="receipt-total">
                    <dt>Total previsto</dt>
                    <dd>
                      {penFormatter.format(
                        Number(expensePayload(values).amount),
                      )}
                    </dd>
                  </div>
                </dl>
              ) : (
                <span className="receipt-heart" aria-hidden="true">
                  <Icon name="heart" />
                  <Icon className="receipt-bolt" name="bolt" />
                </span>
              )}
              <span className="receipt-caption">
                Vista previa del reparto · se confirma al guardar
              </span>
            </aside>
          </div>
        </div>
      </fieldset>
      <div className="save-area">
        <Button
          type="submit"
          className="save-expense-button"
          disabled={busy || !!saved || !ready || !!editor}
        >
          <span className="save-check">
            <Icon name="check" />
          </span>
          <span>
            {busy
              ? 'Guardando…'
              : uncertain
                ? 'Reintentar el mismo consumo'
                : initialExpense
                  ? 'Guardar cambios'
                  : 'Guardar consumo'}
          </span>
          <Icon name="arrow" className="save-arrow" />
        </Button>
        <p>
          {saved
            ? 'Guardado confirmado por el servidor.'
            : 'Se guardará en el espacio compartido. Revisa quién paga y quién participa.'}
        </p>
        {onCancel && (
          <Button
            variant="ghost"
            onClick={() => {
              drafts.clear(cacheKey)
              onCancel()
            }}
            disabled={busy}
          >
            Volver sin guardar
          </Button>
        )}
      </div>
    </form>
  )
}
