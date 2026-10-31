import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { FrameOrnaments, OrnamentalDivider, RibbonBow, ScallopedPanel, StrawberrySprig } from '../../components/decorations/Ornaments'
import { Button } from '../../components/ui/Button'
import { SelectField, TextField } from '../../components/ui/FormField'
import { Icon } from '../../components/ui/Icon'
import { SegmentedControl } from '../../components/ui/SegmentedControl'
import { AddPaymentMethod } from './AddPaymentMethod'
import { ExpenseDetailsFields } from './ExpenseDetailsFields'
import { allocationInCents, amountInCents, createInitialValues, initialPaymentMethods, penFormatter, personLabels, validateExpense } from './expenseModel'
import type { ExpenseErrors, ExpenseValues, PaymentKind, Person } from './expenseModel'

export function NewExpenseScreen() {
  const [values, setValues] = useState(createInitialValues)
  const [methods, setMethods] = useState(initialPaymentMethods)
  const [addingMethod, setAddingMethod] = useState(false)
  const [errors, setErrors] = useState<ExpenseErrors>({})
  const [confirmation, setConfirmation] = useState('')
  const errorSummary = useRef<HTMLDivElement>(null)
  const confirmationPanel = useRef<HTMLDivElement>(null)
  const addMethodButton = useRef<HTMLButtonElement>(null)
  const payment = methods.find(method => method.id === values.paymentMethodId)
  const allocation = allocationInCents(values)
  const amount = amountInCents(values.amount)

  function update<K extends keyof ExpenseValues>(key: K, value: ExpenseValues[K]) {
    setValues(current => ({ ...current, [key]: value }))
    setErrors({})
    setConfirmation('')
  }

  function changePayment(id: string) {
    setValues(current => ({ ...current, paymentMethodId: id, cardType: '', payer: '' }))
    setErrors({})
    setConfirmation('')
  }

  function closeMethodPanel() {
    setAddingMethod(false)
    requestAnimationFrame(() => addMethodButton.current?.focus())
  }

  function addMethod(label: string, kind: PaymentKind) {
    const id = `custom-${methods.length + 1}`
    setMethods(current => [...current, { id, label, kind }])
    changePayment(id)
    closeMethodPanel()
  }

  function saveExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextErrors = validateExpense(values, methods)
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) {
      setConfirmation('')
      requestAnimationFrame(() => errorSummary.current?.focus())
      return
    }
    const total = penFormatter.format(amount! / 100)
    setConfirmation(`¡Consumo de ejemplo listo! ${total} en ${values.place.trim()}. ${personLabels[values.payer as Person]} aporta el dinero. Esta es una demostración: no se guardó ningún consumo.`)
    requestAnimationFrame(() => confirmationPanel.current?.focus())
  }

  return <form className="consumption-frame" onSubmit={saveExpense} noValidate aria-labelledby="expense-title">
    <FrameOrnaments />
    <div className="expense-title-wrap">
      <StrawberrySprig className="title-crest" />
      <div className="title-plaque">
        <svg className="plaque-shape" viewBox="0 0 600 120" preserveAspectRatio="none" aria-hidden="true"><path d="M42 19Q52 4 77 10H256Q300-2 344 10h179q25-6 35 9l4 12q33 5 29 30t-29 29l-4 12q-10 15-35 9H344q-44 12-88 0H77q-25 6-35-9l-4-12Q5 86 9 61t29-30Z" /></svg>
        <h1 id="expense-title">Nuevo consumo</h1>
      </div>
      <RibbonBow className="title-bow" />
    </div>

    <div ref={errorSummary} className="form-message error-summary" role="alert" tabIndex={-1} hidden={!Object.keys(errors).length}>
      <strong>Nos falta un detalle.</strong> Revisa los campos señalados antes de guardar.
    </div>
    <div ref={confirmationPanel} className="form-message confirmation-message" role="status" tabIndex={-1} hidden={!confirmation}><Icon name="check" /><p>{confirmation}</p></div>

    <div className="expense-columns">
      <div className="expense-details">
        <ExpenseDetailsFields values={values} errors={errors} onUpdate={update} />

        <OrnamentalDivider />
        <div className="payment-section">
          <div className="payment-row">
            <SelectField id="paymentMethodId" label="Medio de pago" icon="card" value={values.paymentMethodId} onChange={event => changePayment(event.target.value)} required error={errors.paymentMethodId}><option value="">Elige medio de pago</option>{methods.map(method => <option key={method.id} value={method.id}>{method.label}</option>)}</SelectField>
            <button ref={addMethodButton} className="add-method-button" type="button" aria-label={addingMethod ? 'Cerrar nuevo medio de pago' : 'Agregar medio de pago'} aria-expanded={addingMethod} aria-controls="add-payment-panel" onClick={() => { if (addingMethod) closeMethodPanel(); else { setAddingMethod(true); requestAnimationFrame(() => document.getElementById('new-method-name')?.focus()) } }}><Icon name="plus" /></button>
          </div>
          {addingMethod && <AddPaymentMethod methods={methods} onAdd={addMethod} onCancel={closeMethodPanel} />}
          {payment?.kind === 'card' && <SegmentedControl name="cardType" legend="Tipo de tarjeta" value={values.cardType} options={[{ value: 'credit', label: 'Crédito', icon: 'card' }, { value: 'debit', label: 'Débito', icon: 'card' }]} onChange={value => update('cardType', value)} error={errors.cardType} className="card-type-control" />}
          <SelectField id="payer" label={payment?.kind === 'card' ? 'Titular de la tarjeta' : '¿Quién aporta el dinero?'} icon="person" value={values.payer} onChange={event => update('payer', event.target.value as Person)} error={errors.payer} required><option value="">{payment?.kind === 'card' ? '¿Quién es el titular?' : 'Selecciona a una persona'}</option><option value="antonella">Antonella</option><option value="marco">Marco</option></SelectField>
        </div>
      </div>

      <div className="allocation-column">
        <section className="allocation-panel" aria-labelledby="allocation-title">
          <ScallopedPanel>
          <h2 id="allocation-title"><Icon name="people" />Tipo de gasto<span className="comic-burst" aria-hidden="true" /></h2>
          <SegmentedControl name="expenseType" legend="¿Para quién es este consumo?" value={values.expenseType} options={[{ value: 'personal', label: 'Personal', icon: 'person' }, { value: 'shared', label: 'Compartido', icon: 'people' }]} onChange={value => update('expenseType', value)} error={errors.expenseType} className="expense-type-control" />
          {!values.expenseType && <p className="allocation-prompt">¿Un gusto para ti o algo para los dos?<br />Tú eliges a quién pertenece.</p>}
          {values.expenseType === 'personal' && <SelectField id="owner" label="¿De quién es el consumo?" icon="heart" value={values.owner} onChange={event => update('owner', event.target.value as Person)} error={errors.owner} required><option value="">Selecciona a una persona</option><option value="antonella">Antonella</option><option value="marco">Marco</option></SelectField>}
          {values.expenseType === 'shared' && <div className="division-panel" aria-describedby={errors.allocation ? 'allocation-error' : undefined}>
            <h3><Icon name="pie" />División</h3>
            <SegmentedControl name="splitMode" legend="Cómo dividir el consumo" value={values.splitMode} options={[{ value: 'equal', label: '50/50' }, { value: 'custom', label: '% personalizado' }]} onChange={value => update('splitMode', value)} error={errors.splitMode} className="split-control" />
            {values.splitMode === 'custom' && <div className="percentage-fields"><TextField id="antonellaPercentage" label="Antonella (%)" inputMode="decimal" value={values.antonellaPercentage} onChange={event => update('antonellaPercentage', event.target.value)} error={errors.antonellaPercentage} placeholder="50" required /><TextField id="marcoPercentage" label="Marco (%)" inputMode="decimal" value={values.marcoPercentage} onChange={event => update('marcoPercentage', event.target.value)} error={errors.marcoPercentage} placeholder="50" required /></div>}
            {errors.allocation && <p id="allocation-error" className="field-error" role="alert">{errors.allocation}</p>}
            {values.splitMode === 'custom' && <p className="field-hint">Entre los dos debe sumar 100 %.</p>}
            {values.splitMode === 'equal' && amount !== null && amount % 2 === 1 && <p className="field-hint">Por redondeo, el céntimo de diferencia se asigna a Antonella.</p>}
          </div>}
          </ScallopedPanel>
        </section>
        <aside className="expense-receipt" aria-labelledby="receipt-title">
          <h2 id="receipt-title">Cada detalle cuenta</h2>
          <p>El estilo lo eliges arriba.<br />Quién paga y cómo se reparte, aquí.</p>
          {allocation && <dl><div><dt>Antonella</dt><dd>{penFormatter.format(allocation.antonella / 100)}</dd></div><div><dt>Marco</dt><dd>{penFormatter.format(allocation.marco / 100)}</dd></div><div className="receipt-total"><dt>Total de ejemplo</dt><dd>{penFormatter.format((amount ?? 0) / 100)}</dd></div></dl>}
          {!allocation && <span className="receipt-heart" aria-hidden="true"><Icon name="heart" /><Icon className="receipt-bolt" name="bolt" /></span>}
          <span className="receipt-caption">Vista previa · no es un registro real</span>
        </aside>
      </div>
    </div>

    <div className="save-area"><Button type="submit" className="save-expense-button"><span className="save-check"><Icon name="check" /></span><span>Guardar consumo</span><Icon name="arrow" className="save-arrow" /></Button><p>Solo una prueba: este consumo no se guardará.</p></div>
  </form>
}
