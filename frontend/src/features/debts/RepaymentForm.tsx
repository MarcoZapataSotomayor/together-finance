import { useId, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { DebtApi, DebtRecord, DebtRepayment } from '../../api/debts'
import { Button } from '../../components/ui/Button'
import { ConfirmedMark } from '../../components/ui/ConfirmedMark'
import { SelectField, TextField } from '../../components/ui/FormField'
import { LoadingNotice } from '../expenses/ApiFeedback'
import { localDate } from '../expenses/expenseModel'
import { useDebtDrafts } from './DebtDraftContext'
import {
  formatPen,
  matchesPayment,
  repaymentPayload,
  validatePayment,
} from './debtModel'
import type { FieldErrors, RepaymentValues } from './debtModel'
import { DebtBalances, DebtFeedback } from './DebtUi'

export function RepaymentForm({
  api,
  debt,
  onChanged,
}: {
  api: DebtApi
  debt: DebtRecord
  onChanged: () => void
}) {
  const drafts = useDebtDrafts(),
    key = `payment:${debt.id}`,
    prefix = useId()
  const [initial] = useState<RepaymentValues>(() => ({
    payer: '',
    recipient: '',
    amount: '',
    paidOn: localDate(),
    description: '',
  }))
  const values = drafts.payments[key] ?? initial
  const [submission] = useState(() => drafts.paymentIntent(key))
  const [errors, setErrors] = useState<FieldErrors<RepaymentValues>>({})
  const [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState<DebtRepayment | null>(null)
  const [found, setFound] = useState<DebtRepayment | null>(null)
  const lock = useRef(false),
    form = useRef<HTMLFormElement>(null)
  const confirmation = useRef<HTMLDivElement>(null)
  const set = (field: keyof RepaymentValues, value: string) =>
    drafts.updatePayment(key, { ...values, [field]: value })
  function finish(record: DebtRepayment) {
    setSaved(record)
    drafts.clear(key)
    onChanged()
    requestAnimationFrame(() => confirmation.current?.focus())
  }
  async function save(event: FormEvent) {
    event.preventDefault()
    if (lock.current || submission.confirmed) return
    const validation =
      submission.uncertain && !submission.correcting
        ? {}
        : validatePayment(values, debt)
    setErrors(validation)
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
    setError(null)
    try {
      const result = await submission.submit(
        submission.uncertain && !submission.correcting
          ? submission.pendingPayload!
          : repaymentPayload(values),
        (id, payload) => api.createRepayment(debt.id, id, payload),
      )
      if (result) finish(result)
    } catch (failure) {
      setError(failure)
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  async function inspect() {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError(null)
    try {
      const result = await submission.inspect(
        async (id) => {
          const result = await api.getRepayment(id)
          setFound(result)
          return result
        },
        (record, payload) => matchesPayment(record, payload, debt.id),
      )
      if (result) finish(result)
    } catch (failure) {
      setError(failure)
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  if (saved)
    return (
      <div className="workspace-empty" ref={confirmation} tabIndex={-1}>
        <h2 className="motion-confirmed-heading"><ConfirmedMark />Pago guardado</h2>
        <p role="status">
          El servidor confirmó {formatPen(saved.amount)} para esta deuda.
          Consulta el saldo actualizado en el detalle.
        </p>
        <a
          className="button"
          data-variant="primary"
          href={`#/repayments/${saved.id}`}
        >
          Ver pago guardado
        </a>
        <a className="button" data-variant="ghost" href={`#/debts/${debt.id}`}>
          Volver a la deuda
        </a>
      </div>
    )
  return (
    <section className="repayment-form" aria-labelledby={`${prefix}-title`}>
      <h2 id={`${prefix}-title`} className="debt-section-title">
        Registrar un pago
      </h2>
      <p className="debt-intro">
        Este pago corresponde a la deuda de {debt.debtor.name} hacia{' '}
        {debt.creditor.name}. Confirma ambas personas antes de enviarlo. No
        cuenta como un gasto.
      </p>
      <DebtBalances record={debt} />
      {(!debt.active || debt.status === 'PAID') && (
        <p className="workspace-notice">
          {!debt.active
            ? 'La deuda está inactiva. Debes restaurar su origen antes de registrar pagos.'
            : 'Esta deuda ya está saldada.'}{' '}
          Puedes revisar el historial y sus envíos anteriores.
        </p>
      )}
      <form
        ref={form}
        noValidate
        onSubmit={(event) => void save(event)}
        aria-busy={busy}
      >
        {Object.keys(errors).length > 0 && (
          <p className="form-message error-summary" role="alert">
            Revisa los campos marcados. Confirma las personas y un monto que no
            supere el pendiente.
          </p>
        )}
        <fieldset
          className="plain-fieldset debt-form-grid"
          disabled={
            busy ||
            (submission.uncertain && !submission.correcting) ||
            !debt.active ||
            debt.status === 'PAID'
          }
        >
          <SelectField
            id={`${prefix}-payer`}
            label="Persona que paga"
            required
            value={values.payer}
            error={errors.payer}
            onChange={(event) => set('payer', event.target.value)}
          >
            <option value="">Confirma quién paga</option>
            <option value={debt.debtorPersonId}>{debt.debtor.name}</option>
          </SelectField>
          <SelectField
            id={`${prefix}-recipient`}
            label="Persona que recibe"
            required
            value={values.recipient}
            error={errors.recipient}
            onChange={(event) => set('recipient', event.target.value)}
          >
            <option value="">Confirma quién recibe</option>
            <option value={debt.creditorPersonId}>{debt.creditor.name}</option>
          </SelectField>
          <TextField
            id={`${prefix}-amount`}
            label="Monto del pago (S/)"
            required
            inputMode="decimal"
            maxLength={15}
            value={values.amount}
            error={errors.amount}
            onChange={(event) => set('amount', event.target.value)}
          />
          <TextField
            id={`${prefix}-date`}
            label="Fecha del pago"
            required
            type="date"
            min={debt.incurredOn}
            max="9999-12-31"
            value={values.paidOn}
            error={errors.paidOn}
            onChange={(event) => set('paidOn', event.target.value)}
          />
          <div className="debt-wide">
            <Button
              variant="secondary"
              onClick={() => set('amount', debt.outstandingAmount)}
            >
              Usar pendiente completo: {formatPen(debt.outstandingAmount)}
            </Button>
          </div>
          <TextField
            id={`${prefix}-description`}
            label="Descripción (opcional)"
            fieldClassName="debt-wide"
            maxLength={2000}
            value={values.description}
            error={errors.description}
            onChange={(event) => set('description', event.target.value)}
          />
        </fieldset>
        {error != null && <DebtFeedback error={error} operation="payment" />}
        {submission.uncertain && (
          <div className="workspace-notice">
            <p>
              Este envío no está confirmado. No registres otro pago para
              reemplazarlo: consulta el envío o reintenta con su mismo
              identificador y monto.
            </p>
            <Button disabled={busy} onClick={() => void inspect()}>
              Consultar envío del pago
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                submission.allowCorrection()
                setErrors({})
                setError(null)
              }}
            >
              Corregir datos conservando el identificador
            </Button>
            {submission.correcting && (
              <p>
                Corrige el monto o la fecha y vuelve a enviar con el mismo
                identificador. Un envío anterior confirmado nunca se reemplaza
                automáticamente.
              </p>
            )}
            {found && (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  drafts.clear(key)
                  window.location.hash = `/repayments/${found.id}`
                }}
              >
                Abrir registro existente y cerrar revisión
              </Button>
            )}
            {submission.pendingId && (
              <a
                className="button"
                data-variant="ghost"
                href={`#/repayments/${submission.pendingId}`}
              >
                Revisar registro del envío
              </a>
            )}
          </div>
        )}
        {busy && <LoadingNotice text="Confirmando el pago…" />}
        <div className="workspace-actions">
          <Button
            type="submit"
            className="debt-save-button"
            disabled={
              busy ||
              (!submission.uncertain &&
                (!debt.active || debt.status === 'PAID'))
            }
          >
            {busy
              ? 'Guardando…'
              : submission.correcting
                ? 'Enviar corrección con el mismo identificador'
                : submission.uncertain
                  ? 'Reintentar el mismo pago'
                  : 'Guardar pago'}
          </Button>
          {!submission.uncertain && (
            <Button
              disabled={busy}
              variant="ghost"
              onClick={() => {
                drafts.clear(key)
                window.location.hash = `/debts/${debt.id}`
              }}
            >
              Cancelar formulario
            </Button>
          )}
        </div>
      </form>
    </section>
  )
}
