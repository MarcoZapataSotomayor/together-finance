import { Fragment } from 'react'
import { usePov } from '../../theme/usePov'
import { SelectField, TextField } from '../../components/ui/FormField'
import { Icon } from '../../components/ui/Icon'
import { categories } from './expenseModel'
import type { ExpenseErrors, ExpenseValues } from './expenseModel'

interface ExpenseDetailsFieldsProps {
  values: ExpenseValues
  errors: ExpenseErrors
  onUpdate: <K extends keyof ExpenseValues>(key: K, value: ExpenseValues[K]) => void
}

export function ExpenseDetailsFields({ values, errors, onUpdate }: ExpenseDetailsFieldsProps) {
  const { pov } = usePov()
  const fields = {
    place: <TextField id="place" label="Lugar de compra" icon="store" value={values.place} onChange={event => onUpdate('place', event.target.value)} placeholder="Ej. Tottus, Metro…" maxLength={80} autoComplete="off" required error={errors.place} fieldClassName="place-field" />,
    date: <TextField id="date" label="Fecha" icon="calendar" type="date" value={values.date} onChange={event => onUpdate('date', event.target.value)} required error={errors.date} fieldClassName="date-field" />,
    amount: <div className="amount-field"><TextField id="amount" label="Monto" aria-label="Monto en soles (PEN)" icon="coins" inputMode="decimal" value={values.amount} onChange={event => onUpdate('amount', event.target.value)} placeholder="0.00" maxLength={12} required error={errors.amount} /><span className="currency-prefix" aria-hidden="true">S/</span></div>,
    category: <SelectField id="category" label="Categoría" icon="tag" value={values.category} onChange={event => onUpdate('category', event.target.value)} required error={errors.category} fieldClassName="category-field"><option value="">Elige una</option>{categories.map(category => <option key={category}>{category}</option>)}</SelectField>,
    description: <div className="form-field description-field"><label htmlFor="description"><Icon name="note" />Descripción <span className="optional-label">(opcional)</span></label><textarea id="description" value={values.description} onChange={event => onUpdate('description', event.target.value)} rows={2} maxLength={240} placeholder="Ej. Compras del supermercado…" aria-invalid={!!errors.description} aria-describedby={errors.description ? 'description-error' : undefined} />{errors.description && <p id="description-error" className="field-error">{errors.description}</p>}</div>,
  }
  // Match each reference's reading order without changing any financial values.
  const order: (keyof typeof fields)[] = pov === 'marco'
    ? ['place', 'amount', 'date', 'description', 'category']
    : ['place', 'date', 'amount', 'category', 'description']

  return <div className="details-grid">{order.map(name => <Fragment key={name}>{fields[name]}</Fragment>)}</div>
}
