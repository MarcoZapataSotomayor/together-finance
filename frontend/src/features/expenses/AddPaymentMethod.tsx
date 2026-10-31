import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { SelectField, TextField } from '../../components/ui/FormField'
import type { PaymentKind, PaymentMethod } from './expenseModel'

interface AddPaymentMethodProps {
  methods: PaymentMethod[]
  onAdd: (label: string, kind: PaymentKind) => void
  onCancel: () => void
}

export function AddPaymentMethod({ methods, onAdd, onCancel }: AddPaymentMethodProps) {
  const [label, setLabel] = useState('')
  const [kind, setKind] = useState<PaymentKind | ''>('')
  const [error, setError] = useState('')

  function addMethod() {
    const name = label.trim()
    if (name.length < 2 || name.length > 40) return setError('Escribe un nombre de 2 a 40 caracteres.')
    if (!kind) return setError('Selecciona el tipo de medio de pago.')
    if (methods.some(method => method.label.toLocaleLowerCase('es') === name.toLocaleLowerCase('es'))) return setError('Ya existe un medio de pago con ese nombre.')
    onAdd(name, kind)
  }

  return <section id="add-payment-panel" className="add-payment-panel" aria-labelledby="add-payment-title" onKeyDown={event => { if (event.key === 'Enter' && event.target instanceof HTMLInputElement) { event.preventDefault(); addMethod() } }}>
    <h3 id="add-payment-title">Agregar medio de pago</h3>
    <p className="field-hint">Solo estará disponible durante esta prueba.</p>
    <TextField id="new-method-name" label="Nombre" value={label} maxLength={40} placeholder="Ej. Tarjeta del día a día" onChange={event => { setLabel(event.target.value); setError('') }} />
    <SelectField id="new-method-kind" label="Tipo de medio" value={kind} onChange={event => { setKind(event.target.value as PaymentKind); setError('') }}>
      <option value="">Selecciona un tipo</option><option value="card">Tarjeta</option><option value="cash">Efectivo</option><option value="transfer">Transferencia</option><option value="wallet">Billetera digital</option>
    </SelectField>
    {error && <p role="alert" className="field-error">{error}</p>}
    <div className="add-method-actions"><Button onClick={addMethod}>Añadir y usar</Button><Button variant="ghost" onClick={onCancel}>Cancelar</Button></div>
  </section>
}
